import { afterEach, describe, expect, it, vi } from 'vitest';
import * as shell from '../src/iosShell.js';

afterEach(() => {
  vi.useRealTimers();
  delete window.webkit;
  delete window.__opAIConsent;
});

describe('native AI consent presentation', () => {
  it('fails closed when there is no native presenter', async () => {
    expect(await shell.requestNativeAIConsent({ title: 'Share data?', message: 'Sent to a provider.' })).toBe(false);
  });

  it('accepts only the matching native decision, with the offline policy available', async () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { opShell: { postMessage } } };
    const answer = shell.requestNativeAIConsent({ title: 'Share data?', message: 'Sent to a provider.' });
    const request = postMessage.mock.calls[0][0];
    expect(request.kind).toBe('aiConsent');
    expect(request.policy.sections.length).toBeGreaterThan(0);
    let settled = false;
    answer.then(() => { settled = true; });
    window.__opAIConsent.answer('an-old-page-request', true);
    await Promise.resolve();
    expect(settled).toBe(false);
    window.__opAIConsent.answer(request.requestId, true);
    expect(await answer).toBe(true);
  });

  it('refuses non-boolean approvals and dismisses a cancelled native prompt', async () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { opShell: { postMessage } } };
    const first = shell.requestNativeAIConsent({ title: 'Share?', message: 'Data sharing.' });
    window.__opAIConsent.answer(postMessage.mock.calls[0][0].requestId, 'true');
    expect(await first).toBe(false);
    const controller = new AbortController();
    const second = shell.requestNativeAIConsent({ title: 'Share?', message: 'Data sharing.', signal: controller.signal });
    const requestId = postMessage.mock.calls.at(-1)[0].requestId;
    controller.abort();
    expect(await second).toBe(false);
    expect(postMessage.mock.calls.at(-1)[0]).toEqual({ kind: 'aiConsentCancel', requestId });
  });

  it('projects permission independently of whether a key exists', () => {
    expect(shell.buildSettings({ hasApiKey: true }).aiSharingAllowed).toBe(false);
    expect(shell.buildSettings({ aiSharingAllowed: true }).aiSharingAllowed).toBe(true);
    expect(shell.buildSettings().privacyPolicy.sections.length).toBeGreaterThan(0);
  });

  it('distinguishes an unsaved revocation from permission that is durably off', () => {
    expect(shell.buildSettings({ aiSharingAllowed: false, aiSharingRevocationPending: true }))
      .toMatchObject({ aiSharingAllowed: false, aiSharingRevocationPending: true });
    expect(shell.buildSettings().aiSharingRevocationPending).toBe(false);
    expect(shell.buildSettings({ aiSharingRevocationPending: 'true' }).aiSharingRevocationPending).toBe(false);
  });

  it('publishes failed native revocation and lets the stop command retry its durable deletion', async () => {
    vi.resetModules();
    const storage = await import('../src/appStorage.js');
    storage.__resetAppStorageForTests();
    const consent = await import('../src/aiConsent.js');
    const nativeShell = await import('../src/iosShell.js');
    const key = 'resume-designer-ai-sharing-consent';
    const files = new Map([['marker', 'present']]);
    let refuseDelete = false;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const posted = [];
    window.webkit = { messageHandlers: { opShell: { postMessage: (value) => posted.push(value) } } };
    try {
      await storage.initAppStorage({ backend: {
        loadAll: async () => Object.fromEntries(files),
        write: async (name, value) => files.set(name, value),
        delete: async name => {
          if (refuseDelete) throw new Error('disk unavailable');
          files.delete(name);
        },
      } });
      consent.setAIConsentPresenter(async () => true);
      await consent.requestAIConsent();
      nativeShell.initIOSShell({
        subscribeVariants: () => {}, subscribeDocument: () => {},
        getVariantsSnapshot: () => ({ currentId: null, list: [] }),
        getZoom: () => 1, getSettings: () => ({}), getTheme: () => 'system',
        getAppInfo: async () => ({ version: '1.0.0' }),
        getDocument: () => null, getLibrary: () => null, getPendingChanges: () => [],
      });
      await Promise.resolve();
      const settings = () => posted.filter(message => message.kind === 'snapshot').at(-1).settings;
      expect(settings().aiSharingAllowed).toBe(true);
      refuseDelete = true;
      const failure = await window.__opShell.commandAsync({ type: 'setAISharing', value: 'false' });
      expect(failure.ok).toBe(true);
      expect(failure.result).toMatch(/could not be saved/i);
      expect(settings()).toMatchObject({ aiSharingAllowed: false, aiSharingRevocationPending: true });
      expect(files.has(key)).toBe(true);

      refuseDelete = false;
      expect(await window.__opShell.commandAsync({ type: 'setAISharing', value: 'false' }))
        .toEqual({ ok: true, result: '' });
      expect(settings()).toMatchObject({ aiSharingAllowed: false, aiSharingRevocationPending: false });
      expect(files.has(key)).toBe(false);
    } finally {
      refuseDelete = false;
      await consent.revokeAIConsent();
      consent.setAIConsentPresenter(null);
      storage.__resetAppStorageForTests();
      log.mockRestore();
      delete window.__opShell;
    }
  });

  it('fails closed after five minutes without a native decision and allows a fresh request', async () => {
    vi.useFakeTimers();
    const posted = [];
    window.webkit = { messageHandlers: { opShell: { postMessage: (value) => posted.push(value) } } };
    const answer = shell.requestNativeAIConsent({ title: 'Share?', message: 'Data sharing.' });
    const firstId = posted[0].requestId;
    let result = 'pending';
    answer.then((allowed) => { result = allowed; });
    await vi.advanceTimersByTimeAsync(299999);
    expect(result).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(false);
    expect(posted.at(-1)).toEqual({ kind: 'aiConsentCancel', requestId: firstId });
    expect(window.__opAIConsent).toBeUndefined();
    const next = shell.requestNativeAIConsent({ title: 'Share?', message: 'Data sharing.' });
    const nextId = posted.at(-1).requestId;
    window.__opAIConsent.answer(firstId, true);
    window.__opAIConsent.answer(nextId, true);
    expect(await next).toBe(true);
  });

  it('cancels a native prompt when its document is replaced', async () => {
    const posted = [];
    window.webkit = { messageHandlers: { opShell: { postMessage: (value) => posted.push(value) } } };
    const answer = shell.requestNativeAIConsent({ title: 'Share?', message: 'Data sharing.' });
    const oldEndpoint = window.__opAIConsent;
    const requestId = posted[0].requestId;
    let result = 'pending';
    answer.then((allowed) => { result = allowed; });
    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    expect(result).toBe(false);
    expect(posted.at(-1)).toEqual({ kind: 'aiConsentCancel', requestId });
    expect(window.__opAIConsent).toBeUndefined();
    oldEndpoint.answer(requestId, true);
    expect(await answer).toBe(false);
  });

  it('retires the timeout and page listener when an answer has already arrived', async () => {
    vi.useFakeTimers();
    const posted = [];
    window.webkit = { messageHandlers: { opShell: { postMessage: (value) => posted.push(value) } } };
    const answer = shell.requestNativeAIConsent({ title: 'Share?', message: 'Data sharing.' });
    window.__opAIConsent.answer(posted[0].requestId, true);
    expect(await answer).toBe(true);
    await vi.advanceTimersByTimeAsync(300000);
    window.dispatchEvent(new Event('pagehide'));
    expect(posted).toHaveLength(1);
  });
});
