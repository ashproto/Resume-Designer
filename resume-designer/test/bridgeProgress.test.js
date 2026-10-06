import { describe, expect, it, vi } from 'vitest';
import { createBridgeRouter } from '../src/bridgeRoutes.js';

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
