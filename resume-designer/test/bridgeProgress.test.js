import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBridgeRouter } from '../src/bridgeRoutes.js';
import { createBridgeProgress } from '../src/bridgeProgress.js';

const operationId = '550e8400-e29b-41d4-a716-446655440000';
const profileContextId = 'context';
const payload = { operationId, profileContextId, messages: [{ role: 'user', content: 'Help' }] };
function setup() {
  let finish;
  const complete = vi.fn((_messages, options) => {
    options.hooks?.onReasoning('Considering experience', 'Considering experience');
    return new Promise((resolve) => { finish = resolve; });
  });
  let token = 'token';
  const router = createBridgeRouter({ getToken: () => token, profileId: 'profile', profileContextId,
    complete, getAiModels: () => ({ models: [] }) });
  const request = (path, data = payload, authorization = 'Bearer token') => router({ method: 'POST', path,
    authorization, body: JSON.stringify(data) });
  return { request, complete, finish: () => finish('Result'), revoke: () => { token = 'new'; } };
}

describe('recoverable companion AI operations', () => {
  it('acknowledges immediately, streams progress, and reuses an in-flight operation', async () => {
    const service = setup();
    const started = await service.request('/ai/complete');
    expect(started).toMatchObject({ status: 202, body: { operationId, state: 'running' } });
    const progress = await service.request('/ai/progress');
    expect(progress.body.progress).toMatchObject({ kind: 'reasoning', message: 'Considering experience' });
    await service.request('/ai/complete');
    expect(service.complete).toHaveBeenCalledTimes(1);
    service.finish();
    await vi.waitFor(async () => {
      expect(await service.request('/ai/progress')).toMatchObject({ body: { state: 'complete', result: { status: 200, body: { text: 'Result' } } } });
    });
  });

  it('rejects changed payload reuse and never leaks progress to another context or token', async () => {
    const service = setup();
    await service.request('/ai/complete');
    expect((await service.request('/ai/complete', { ...payload, messages: [{ role: 'user', content: 'Changed' }] })).status).toBe(409);
    expect((await service.request('/ai/progress', { ...payload, profileContextId: 'other' })).status).toBe(409);
    service.revoke();
    expect((await service.request('/ai/progress')).status).toBe(401);
    expect((await service.request('/ai/progress', payload, 'Bearer new')).status).toBe(404);
    service.finish();
  });
});

describe('bounded companion AI operations', () => {
  const deadlineMs = 15 * 60_000;
  const response = { status: 200, body: { text: 'Result' } };
  const idAt = (index) => `550e8400-e29b-41d4-a716-${String(index).padStart(12, '0')}`;

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('times out hung work, aborts it, and preserves its result against late provider events', async () => {
    const progress = createBridgeProgress();
    let hooks;
    let finish;
    const execute = vi.fn((callbacks) => {
      hooks = callbacks;
      return new Promise((resolve) => { finish = resolve; });
    });
    progress.start(operationId, 'owner', 'input', execute);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(deadlineMs);
    const timedOut = progress.read(operationId, 'owner');
    expect(timedOut).toMatchObject({ status: 200, body: { state: 'complete', result: { status: 504, body: { code: 'ai_failed' } } } });
    expect(hooks.signal.aborted).toBe(true);
    hooks.onReasoning('Late reasoning');
    hooks.onContent('Late output');
    finish(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(progress.read(operationId, 'owner')).toEqual(timedOut);
    expect(progress.start(operationId, 'owner', 'input', execute)).toEqual(timedOut);
    expect(execute).toHaveBeenCalledOnce();
    expect(progress.start(operationId, 'other-owner', 'input', execute).status).toBe(409);
    expect(progress.start(operationId, 'owner', 'changed-input', execute).status).toBe(409);
  });

  it.each([true, false])('frees capacity after timeout even when upstream acknowledges cancellation=%s', async (acknowledgesAbort) => {
    const progress = createBridgeProgress();
    const execute = vi.fn(({ signal }) => new Promise((_resolve, reject) => {
      if (acknowledgesAbort) signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    for (let index = 0; index < 32; index += 1) progress.start(idAt(index), 'owner', `input-${index}`, execute);
    await Promise.resolve();
    expect(progress.start(idAt(32), 'owner', 'new-input', execute)).toMatchObject({ status: 503, body: { code: 'bridge_busy' } });
    await vi.advanceTimersByTimeAsync(deadlineMs);
    expect(progress.start(idAt(32), 'owner', 'new-input', execute)).toMatchObject({ status: 202, body: { state: 'running' } });
    if (!acknowledgesAbort) {
      expect(progress.start(idAt(0), 'owner', 'input-0', execute)).toMatchObject({ body: { result: { status: 504 } } });
      expect(execute).toHaveBeenCalledTimes(32);
    }
  });

  it('retains completed work for fifteen minutes from completion and clears its deadline timer', async () => {
    const progress = createBridgeProgress();
    let finish;
    const execute = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    progress.start(operationId, 'owner', 'input', execute);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(deadlineMs - 1);
    finish(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(progress.read(operationId, 'owner')).toMatchObject({ body: { state: 'complete', result: response } });
    expect(progress.start(operationId, 'owner', 'input', execute).status).toBe(200);
    expect(execute).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(deadlineMs - 2);
    expect(progress.read(operationId, 'owner').status).toBe(404);
  });

  it('replays an abort-ignoring operation until its terminal retention window expires', async () => {
    const progress = createBridgeProgress();
    const execute = vi.fn(() => new Promise(() => {}));
    progress.start(operationId, 'owner', 'input', execute);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(deadlineMs * 2 - 1);
    expect(progress.start(operationId, 'owner', 'input', execute)).toMatchObject({ body: { state: 'complete', result: { status: 504 } } });
    expect(execute).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(progress.read(operationId, 'owner').status).toBe(404);
    expect(progress.start(operationId, 'owner', 'input', execute).status).toBe(202);
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('expires old timeout payloads across batches of abort-ignoring requests', async () => {
    const progress = createBridgeProgress();
    const execute = vi.fn(() => new Promise(() => {}));
    for (let batch = 0; batch < 4; batch += 1) {
      for (let index = 0; index < 32; index += 1) {
        const id = idAt(batch * 32 + index);
        expect(progress.start(id, 'owner', `input-${id}`, execute).status).toBe(202);
      }
      await vi.advanceTimersByTimeAsync(deadlineMs);
      for (let index = 0; index < 32; index += 1) {
        expect(progress.read(idAt(batch * 32 + index), 'owner')).toMatchObject({ body: { result: { status: 504 } } });
      }
      if (batch > 0) {
        for (let index = 0; index < batch * 32; index += 1) {
          expect(progress.read(idAt(index), 'owner').status).toBe(404);
        }
      }
    }
    expect(execute).toHaveBeenCalledTimes(128);
  });

  it.each(['/ai/complete', '/ai/job-fit', '/ai/tailored-resume'])('forwards the deadline signal to %s upstream work', async (path) => {
    let signal;
    const capture = vi.fn((_input, options) => {
      signal = path === '/ai/complete' ? options.signal : _input.signal;
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const handle = createBridgeRouter({ getToken: () => 'token', profileId: 'profile', profileContextId,
      complete: capture, analyzeJobFit: capture, createTailoredResume: capture });
    await handle({ method: 'POST', path, authorization: 'Bearer token', body: JSON.stringify(payload) });
    await vi.advanceTimersByTimeAsync(deadlineMs);
    expect(signal?.aborted).toBe(true);
    const result = await handle({ method: 'POST', path: '/ai/progress', authorization: 'Bearer token', body: JSON.stringify(payload) });
    expect(result).toMatchObject({ body: { state: 'complete', result: { status: 504 } } });
  });
});
