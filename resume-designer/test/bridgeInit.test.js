import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storage: new Map(),
  flush: vi.fn(async () => true),
  writesSuspended: vi.fn(() => false),
  listen: vi.fn(async () => () => {}),
  invoke: vi.fn(async () => {}),
  getVersion: vi.fn(async () => '1.0.0'),
  onOpenUrl: vi.fn(async () => () => {}),
  getCurrent: vi.fn(async () => []),
  confirm: vi.fn(async () => false),
  show: vi.fn(async () => {}),
  unminimize: vi.fn(async () => {}),
  setFocus: vi.fn(async () => {}),
}));
vi.mock('../src/appStorage.js', () => ({
  appStorage: {
    getItem: (key) => mocks.storage.get(key) ?? null,
    setItem: (key, value) => mocks.storage.set(key, value),
    flush: mocks.flush,
  },
}));
vi.mock('../src/store.js', () => ({ store: { areSavesSuspended: mocks.writesSuspended } }));
vi.mock('../src/persistence.js', () => ({
  generateUniqueVariantName: vi.fn(), getSettings: vi.fn(), getVariants: vi.fn(),
  getUserProfile: vi.fn(), saveVariant: vi.fn(),
}));
vi.mock('../src/applications.js', () => ({ addApplication: vi.fn(), getCompanionApplication: vi.fn(() => null) }));
vi.mock('../src/learnedAnswers.js', () => ({ getAllLearnedAnswers: vi.fn(), saveLearnedAnswer: vi.fn() }));
vi.mock('../src/aiService.js', () => ({
  analyzeResumeDataAgainstJobs: vi.fn(), completeForBridge: vi.fn(),
  generateResumeChangesForData: vi.fn(), getDefaultModelId: vi.fn(),
  getAllModels: vi.fn(), getCustomModels: vi.fn(), getSelectableChatModels: vi.fn(),
  isSafeModelSlug: vi.fn(), validateModelId: vi.fn(),
}));
vi.mock('../src/companionJobActions.js', () => ({ createCompanionJobActions: () => ({}) }));
vi.mock('../src/variantManager.js', () => ({ loadVariant: vi.fn() }));
vi.mock('../src/pdf.js', () => ({ exportVariantPdfBase64: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: mocks.getVersion }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: mocks.onOpenUrl, getCurrent: mocks.getCurrent }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: mocks.confirm }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ show: mocks.show, unminimize: mocks.unminimize, setFocus: mocks.setFocus }) }));

const TOKEN_KEY = 'resume-designer-bridge-token';

beforeEach(() => {
  vi.resetModules();
  mocks.storage.clear();
  mocks.flush.mockReset().mockResolvedValue(true);
  mocks.writesSuspended.mockReset().mockReturnValue(false);
  vi.stubGlobal('window', { isTauri: true });
  vi.stubGlobal('navigator', { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 });
});
afterEach(() => vi.unstubAllGlobals());

describe('bridge platform initialization', () => {
  it.each([
    { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 },
    { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 },
  ])('skips desktop plugins and token creation on iOS: %j', async (navigator) => {
    vi.stubGlobal('navigator', navigator);
    await (await import('../src/bridge.js')).initBridge();
    expect(mocks.storage.size).toBe(0);
    expect(mocks.getVersion).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(mocks.onOpenUrl).not.toHaveBeenCalled();
  });

  it('initializes the native bridge on a desktop Mac', async () => {
    await (await import('../src/bridge.js')).initBridge();
    expect(mocks.getVersion).toHaveBeenCalledOnce();
    expect(mocks.listen).toHaveBeenCalledWith('bridge:request', expect.any(Function));
    expect(mocks.storage.get(TOKEN_KEY)).toEqual(expect.any(String));
  });

  it('skips initialization outside Tauri', async () => {
    vi.stubGlobal('window', {});
    await (await import('../src/bridge.js')).initBridge();
    expect(mocks.storage.size).toBe(0);
    expect(mocks.getVersion).not.toHaveBeenCalled();
  });
});

describe('bridge token revocation', () => {
  it('rotates the install token and invalidates pending grants before reporting durable success', async () => {
    mocks.storage.set(TOKEN_KEY, 'old-token');
    let release;
    mocks.flush.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const revokeAll = vi.fn();
    const { revokeBridgePairing, getBridgeToken } = await import('../src/bridge.js');
    let settled = false;
    const operation = revokeBridgePairing(revokeAll).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(getBridgeToken()).not.toBe('old-token');
    expect(revokeAll).toHaveBeenCalledOnce();
    release(true);
    await operation;
    expect(revokeAll).toHaveBeenCalledTimes(2);
  });

  it.each([false, 'throw'])('does not report success and restores the current pairing after failed persistence: %s', async (failure) => {
    mocks.storage.set(TOKEN_KEY, 'old-token');
    if (failure === 'throw') mocks.flush.mockRejectedValueOnce(new Error('disk full'));
    else mocks.flush.mockResolvedValueOnce(false);
    const { revokeBridgePairing, getBridgeToken } = await import('../src/bridge.js');
    await expect(revokeBridgePairing(vi.fn())).rejects.toMatchObject({
      status: 503, code: 'pairing_unavailable',
    });
    expect(getBridgeToken()).toBe('old-token');
  });

  it('refuses token rotation during a destructive import', async () => {
    mocks.storage.set(TOKEN_KEY, 'old-token');
    mocks.writesSuspended.mockReturnValue(true);
    const { revokeBridgePairing, getBridgeToken } = await import('../src/bridge.js');
    await expect(revokeBridgePairing(vi.fn())).rejects.toMatchObject({ status: 503 });
    expect(getBridgeToken()).toBe('old-token');
    expect(mocks.flush).not.toHaveBeenCalled();
  });
});


describe('native pairing request wiring', () => {
  it('foregrounds the app for explicit approval and returns only pending before the decision', async () => {
    await (await import('../src/bridge.js')).initBridge();
    const handler = mocks.listen.mock.calls.find(([event]) => event === 'bridge:request')[1];
    await handler({ payload: { id: 1, method: 'POST', path: '/pairing/request', body: JSON.stringify({
      protocolVersion: '2', requestId: 'a'.repeat(32), challenge: 'A'.repeat(43), clientId: 'keggfbelidgpjiapcbgkjidenhdjmega',
    }) } });
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.show).toHaveBeenCalledOnce();
    expect(mocks.unminimize).toHaveBeenCalledOnce();
    expect(mocks.setFocus).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith('bridge_respond', { id: 1, status: 202, body: '{"pending":true}' });
  });
});

describe('native save durability wiring', () => {
  it.each([
    ['/applications', { requestId: '550e8400-e29b-41d4-a716-446655440000', variantId: 'v-1', title: 'Engineer' }],
    ['/profile/answers', { question: 'Notice period?', answer: 'Two weeks' }],
  ])('does not send a successful native response for %s when disk flush fails', async (path, payload) => {
    const { getVariants } = await import('../src/persistence.js');
    getVariants.mockReturnValue({ 'v-1': { id: 'v-1', name: 'Resume' } });
    const { addApplication } = await import('../src/applications.js');
    const { saveLearnedAnswer } = await import('../src/learnedAnswers.js');
    addApplication.mockReturnValue({ id: 'app-1' });
    saveLearnedAnswer.mockReturnValue({ id: 'answer-1' });
    await (await import('../src/bridge.js')).initBridge();
    const handler = mocks.listen.mock.calls.find(([event]) => event === 'bridge:request')[1];
    const authorization = `Bearer ${mocks.storage.get(TOKEN_KEY)}`;
    await handler({ payload: { id: 1, method: 'GET', path: '/resumes', authorization } });
    const { profileContextId } = JSON.parse(mocks.invoke.mock.calls.at(-1)[1].body);
    mocks.flush.mockResolvedValueOnce(false);
    await handler({ payload: {
      id: 2, method: 'POST', path, authorization,
      body: JSON.stringify({ profileContextId, ...payload }),
    } });
    const [command, response] = mocks.invoke.mock.calls.at(-1);
    expect(command).toBe('bridge_respond');
    expect(response).toMatchObject({ id: 2, status: 507 });
    expect(JSON.parse(response.body)).toMatchObject({ code: 'storage_full' });
  });
});
