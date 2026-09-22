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
