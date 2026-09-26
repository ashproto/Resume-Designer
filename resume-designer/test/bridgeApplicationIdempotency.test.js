// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBridgeRouter } from '../src/bridgeRoutes.js';
import { appStorage, initAppStorage, __resetAppStorageForTests, setProfileMapping } from '../src/appStorage.js';
import { addApplication, getCompanionApplication, getAllApplications, initApplications, updateApplication } from '../src/applications.js';

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';
const NEXT_REQUEST_ID = '550e8400-e29b-41d4-a716-446655440001';
const KEY = 'resume-designer-applications';
const payload = { requestId: REQUEST_ID, variantId: 'v-1', title: 'Engineer', company: 'Example', notes: 'Sent application' };
function request(patch = {}, profileContextId = 'context-1') {
  return { method: 'POST', path: '/applications', authorization: 'Bearer token',
    body: JSON.stringify({ profileContextId, ...payload, ...patch }) };
}
function router(overrides = {}) {
  return createBridgeRouter({ getToken: () => 'token', profileContextId: 'context-1',
    getVariants: () => ({ 'v-1': { id: 'v-1', name: 'Resume' }, 'v-2': { id: 'v-2', name: 'Other resume' } }),
    addApplication, getCompanionApplication, flush: () => appStorage.flush(), ...overrides });
}
function backend(write = async (files, key, value) => files.set(key, value)) {
  const files = new Map();
  return { files, loadAll: async () => Object.fromEntries(files),
    write: (key, value) => write(files, key, value), delete: async (key) => files.delete(key), clear: async () => files.clear() };
}
beforeEach(() => { __resetAppStorageForTests(); localStorage.clear(); initApplications(); });
afterEach(() => { __resetAppStorageForTests(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Companion application request identity', () => {
  it('reuses the record when a timed-out client retries while the original disk write is unfinished', async () => {
    vi.useFakeTimers();
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    let writeStarted;
    const started = new Promise((resolve) => { writeStarted = resolve; });
    const disk = backend(async (files, key, value) => { writeStarted(); await pending; files.set(key, value); });
    await initAppStorage({ backend: disk });
    const handle = router();
    const first = handle(request());
    await started;
    await vi.advanceTimersByTimeAsync(30_001);
    const retry = handle(request());
    release();
    const [saved, retried] = await Promise.all([first, retry]);
    expect(saved.status).toBe(201);
    expect(retried.status).toBe(201);
    expect(retried.body.application.id).toBe(saved.body.application.id);
    expect(JSON.parse(disk.files.get(KEY))).toEqual([saved.body.application]);
  });
  it('retains request identity across a desktop storage/cache restart and new profile context nonce', async () => {
    const disk = backend();
    await initAppStorage({ backend: disk });
    const first = await router()(request());
    __resetAppStorageForTests();
    await initAppStorage({ backend: disk });
    initApplications();
    const retry = await router({ profileContextId: 'new-context' })(request({}, 'new-context'));
    expect(retry.status).toBe(201);
    expect(retry.body.application).toEqual(first.body.application);
    expect(getAllApplications()).toHaveLength(1);
  });
  it.each(['variantId', 'title', 'company', 'notes'])('rejects changed %s for an accepted request without altering its record', async (field) => {
    const disk = backend();
    await initAppStorage({ backend: disk });
    const handle = router();
    const first = await handle(request());
    const conflict = await handle(request({ [field]: field === 'variantId' ? 'v-2' : 'Changed' }));
    expect(conflict).toMatchObject({ status: 409, body: { code: 'idempotency_conflict' } });
    expect(conflict.body.application).toBeUndefined();
    expect(JSON.parse(disk.files.get(KEY))).toEqual([first.body.application]);
  });
  it('allows a new request ID to log a later application with the same details', async () => {
    const handle = router();
    const first = await handle(request());
    const later = await handle(request({ requestId: NEXT_REQUEST_ID }));
    expect(later.status).toBe(201);
    expect(later.body.application.id).not.toBe(first.body.application.id);
    expect(getAllApplications()).toHaveLength(2);
  });
  it('retries a rejected disk write without reserving a phantom application', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const disk = backend(async (files, key, value) => { if (fail) throw new Error('Disk full'); files.set(key, value); });
    await initAppStorage({ backend: disk });
    const handle = router();
    expect((await handle(request())).status).toBe(507);
    expect(getAllApplications()).toEqual([]);
    fail = false;
    const retry = await handle(request());
    expect(retry.status).toBe(201);
    expect(JSON.parse(disk.files.get(KEY))).toEqual([retry.body.application]);
    expect((await handle(request())).body.application.id).toBe(retry.body.application.id);
    expect(getAllApplications()).toHaveLength(1);
  });
  it('checks durability again before acknowledging an already accepted request', async () => {
    const flush = vi.fn(() => appStorage.flush());
    const handle = router({ flush });
    const first = await handle(request());
    flush.mockResolvedValueOnce(false);
    expect(await handle(request())).toMatchObject({ status: 507, body: { code: 'storage_full' } });
    expect(getAllApplications()).toEqual([first.body.application]);
    expect(flush).toHaveBeenCalledTimes(2);
  });
  it('keeps request identity scoped to the active profile', async () => {
    const disk = backend();
    await initAppStorage({ backend: disk });
    setProfileMapping('one'); initApplications();
    const first = await router()(request());
    setProfileMapping('two'); initApplications();
    const second = await router({ profileContextId: 'context-2' })(request({}, 'context-2'));
    expect(second.body.application.id).not.toBe(first.body.application.id);
    setProfileMapping('one'); initApplications();
    const retry = await router({ profileContextId: 'context-3' })(request({}, 'context-3'));
    expect(retry.body.application.id).toBe(first.body.application.id);
    expect(JSON.parse(disk.files.get('resume-p--one--resume-designer-applications'))).toHaveLength(1);
    expect(JSON.parse(disk.files.get('resume-p--two--resume-designer-applications'))).toHaveLength(1);
  });
  it('preserves newer native edits while matching the original request payload', async () => {
    const handle = router();
    const first = await handle(request());
    updateApplication(first.body.application.id, { notes: 'Edited in On Paper' });
    const retry = await handle(request());
    expect(retry.body.application.id).toBe(first.body.application.id);
    expect(retry.body.application.notes).toBe('Edited in On Paper');
    expect(getAllApplications()).toHaveLength(1);
  });
  it.each([undefined, null, '', 'not-an-id', '550e8400-e29b-11d4-a716-446655440000', '550e8400-e29b-41d4-0716-446655440000', 5])('rejects invalid requestId %s before creating a record', async (requestId) => {
    expect(await router()(request({ requestId }))).toMatchObject({ status: 400, body: { code: 'invalid_request_id' } });
    expect(getAllApplications()).toEqual([]);
  });
  it('returns an accepted retry even if its resume was subsequently deleted', async () => {
    const first = await router()(request());
    const retry = await router({ getVariants: () => ({}) })(request());
    expect(retry.status).toBe(201);
    expect(retry.body.application.id).toBe(first.body.application.id);
    expect(getAllApplications()).toHaveLength(1);
  });
  it('normalizes UUID case and optional values before matching an accepted request', async () => {
    const handle = router();
    const first = await handle(request({ requestId: REQUEST_ID.toUpperCase(), notes: undefined, title: null, variantId: ' v-1 ' }));
    const retry = await handle(request({ notes: '', title: '' }));
    expect(retry.body.application.id).toBe(first.body.application.id);
    expect(getAllApplications()).toHaveLength(1);
  });
});
