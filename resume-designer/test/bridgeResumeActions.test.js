import { describe, expect, it, vi } from 'vitest';
import { createBridgeRouter } from '../src/bridgeRoutes.js';
const authorization = 'Bearer token';
const request = (method, path, payload) => ({ method, path, authorization, body: payload ? JSON.stringify(payload) : '' });
const preview = { imageBase64: 'aW1hZ2U=', mimeType: 'image/png', width: 480, height: 622, pageCount: 2 };
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function dependencies(overrides = {}) {
  return { getToken: () => 'token', profileId: 'profile', profileContextId: 'context',
    getVariants: () => ({ resume: { id: 'resume', name: 'Tailored resume', updatedAt: 'today' } }), writesSuspended: () => false,
    exportVariantPdf: vi.fn(async () => 'pdf-data'), renderResumeThumbnail: vi.fn(async () => preview),
    openVariant: vi.fn(async (_id, { assertCurrentContext }) => { assertCurrentContext(); }), ...overrides };
}
describe('saved-resume preview', () => {
  it('renders the exact saved variant and returns PNG document metadata', async () => {
    const deps = dependencies();
    expect(await createBridgeRouter(deps)(request('GET', '/resumes/resume/preview'))).toEqual({ status: 200, body: { profileId: 'profile', profileContextId: 'context', id: 'resume', name: 'Tailored resume', updatedAt: 'today', ...preview } });
    expect(deps.exportVariantPdf).toHaveBeenCalledExactlyOnceWith('resume');
    expect(deps.renderResumeThumbnail).toHaveBeenCalledExactlyOnceWith('pdf-data');
  });
  it.each(['absent', '__proto__', 'constructor'])('does not render a missing or inherited variant: %s', async (id) => {
    const deps = dependencies();
    expect(await createBridgeRouter(deps)(request('GET', `/resumes/${id}/preview`))).toMatchObject({ status: 404 });
    expect(deps.exportVariantPdf).not.toHaveBeenCalled();
  });
  it('rejects overlapping previews and releases the guard after completion', async () => {
    const pending = deferred(); const deps = dependencies({ exportVariantPdf: () => pending.promise }); const handle = createBridgeRouter(deps);
    const first = handle(request('GET', '/resumes/resume/preview'));
    expect(await handle(request('GET', '/resumes/resume/preview'))).toMatchObject({ status: 503, body: { code: 'bridge_busy' } });
    pending.resolve('pdf-data'); expect(await first).toMatchObject({ status: 200 });
    expect(await handle(request('GET', '/resumes/resume/preview'))).toMatchObject({ status: 200 });
  });
  it('does not send private preview bytes after pairing is revoked during rasterization', async () => {
    const pending = deferred(); const deps = dependencies({ renderResumeThumbnail: () => pending.promise, revokePairing: async () => {} }); const handle = createBridgeRouter(deps);
    const first = handle(request('GET', '/resumes/resume/preview'));
    await vi.waitFor(() => expect(deps.exportVariantPdf).toHaveBeenCalledOnce());
    await handle(request('POST', '/pairing/revoke', {})); pending.resolve(preview);
    expect(await first).toMatchObject({ status: 401, body: { code: 'unauthorized' } });
  });
  it('checks import suspension after PDF generation before rasterization', async () => {
    const pending = deferred(); let suspended = false;
    const deps = dependencies({ exportVariantPdf: () => pending.promise, writesSuspended: () => suspended });
    const operation = createBridgeRouter(deps)(request('GET', '/resumes/resume/preview'));
    suspended = true; pending.resolve('pdf-data');
    expect(await operation).toMatchObject({ status: 503, body: { code: 'profile_changed' } });
    expect(deps.renderResumeThumbnail).not.toHaveBeenCalled();
  });
  it('does not leak an old profile preview if the context changes during rendering', async () => {
    const pending = deferred(); const deps = dependencies({ renderResumeThumbnail: () => pending.promise });
    const operation = createBridgeRouter(deps)(request('GET', '/resumes/resume/preview'));
    await vi.waitFor(() => expect(deps.exportVariantPdf).toHaveBeenCalledOnce());
    deps.profileContextId = 'new-context'; pending.resolve(preview);
    expect(await operation).toMatchObject({ status: 409, body: { code: 'profile_changed' } });
  });
});
describe('open saved resume', () => {
  it('opens the selected saved resume with a guard at the activation boundary', async () => {
    const deps = dependencies();
    expect(await createBridgeRouter(deps)(request('POST', '/resumes/resume/open', { profileContextId: 'context' }))).toEqual({ status: 200, body: { opened: true, profileId: 'profile', profileContextId: 'context', id: 'resume' } });
    expect(deps.openVariant).toHaveBeenCalledWith('resume', { assertCurrentContext: expect.any(Function) });
  });
  it.each([{}, { profileContextId: 'wrong' }])('requires the originating profile context: %j', async (payload) => {
    const deps = dependencies();
    expect(await createBridgeRouter(deps)(request('POST', '/resumes/resume/open', payload))).toMatchObject({ status: 409, body: { code: 'profile_changed' } });
    expect(deps.openVariant).not.toHaveBeenCalled();
  });
  it('rejects delayed activation after token revocation', async () => {
    const ready = deferred(); const activate = vi.fn();
    const deps = dependencies({ openVariant: async (_id, { assertCurrentContext }) => { await ready.promise; assertCurrentContext(); activate(); }, revokePairing: async () => {} });
    const handle = createBridgeRouter(deps); const operation = handle(request('POST', '/resumes/resume/open', { profileContextId: 'context' }));
    await handle(request('POST', '/pairing/revoke', {})); ready.resolve();
    expect(await operation).toMatchObject({ status: 401 }); expect(activate).not.toHaveBeenCalled();
  });
  it('blocks opening during a destructive import', async () => {
    const deps = dependencies({ writesSuspended: () => true });
    expect(await createBridgeRouter(deps)(request('POST', '/resumes/resume/open', { profileContextId: 'context' }))).toMatchObject({ status: 503 });
    expect(deps.openVariant).not.toHaveBeenCalled();
  });
});
