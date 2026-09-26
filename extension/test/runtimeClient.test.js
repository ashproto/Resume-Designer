import { describe, expect, it, vi } from 'vitest';
import { createRuntimeClient } from '../src/sidepanel/runtimeClient.js';

describe('model selection transport', () => {
  it('passes the chosen model and job to every AI action without changing app settings', async () => {
    const send = vi.fn(async () => ({ ok: true, data: {} }));
    const client = createRuntimeClient(send);
    const job = { title: 'Designer', company: 'Fieldwork', description: 'Accessible collaboration tools.' };
    await client.getAIModels();
    await client.createMapping('context', 'resume', [], { job, model: 'provider/chosen' });
    await client.analyzeJobFit({ profileContextId: 'context', resumeId: 'resume', job, model: 'provider/chosen' });
    await client.createTailoredResume({ profileContextId: 'context', resumeId: 'resume', requestId: 'request', job, model: 'provider/chosen' });
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: 'ai.models' },
      { type: 'mapping.create', profileContextId: 'context', resumeId: 'resume', descriptors: [], job, model: 'provider/chosen' },
      { type: 'job.fit.analyze', profileContextId: 'context', resumeId: 'resume', job, model: 'provider/chosen' },
      { type: 'resume.tailor', profileContextId: 'context', resumeId: 'resume', requestId: 'request', job, model: 'provider/chosen' },
    ]);
  });

  it('explains how to enable model selection when the background does not handle its request', async () => {
    const client = createRuntimeClient(async () => undefined);
    await expect(client.getAIModels()).rejects.toMatchObject({
      code: 'extension_update_required',
      message: 'Reload On Paper Companion from chrome://extensions, then retry loading models.',
      retryable: false,
    });
  });

  it('preserves app errors so model loading can be retried', async () => {
    const client = createRuntimeClient(async () => ({
      ok: false, error: { message: 'On Paper is still starting.', code: 'app_timeout', retryable: true },
    }));
    await expect(client.getAIModels()).rejects.toMatchObject({
      message: 'On Paper is still starting.', code: 'app_timeout', retryable: true,
    });
  });

  it('omits overrides when using the app defaults', async () => {
    const send = vi.fn(async () => ({ ok: true, data: {} }));
    const client = createRuntimeClient(send);
    await client.createMapping('context', 'resume', [], { model: '' });
    expect(send).toHaveBeenCalledWith({ type: 'mapping.create', profileContextId: 'context', resumeId: 'resume', descriptors: [] });
  });
});


it('cancels an automatic pairing attempt without disconnecting the session', async () => {
  const send = vi.fn(async () => ({ ok: true, data: { cancelled: true } }));
  const client = createRuntimeClient(send);
  await expect(client.cancelPairing()).resolves.toEqual({ cancelled: true });
  expect(send).toHaveBeenCalledWith({ type: 'pairing.cancel' });
});


it('carries reviewed page identity and field descriptors with a fill', async () => {
  const send = vi.fn(async () => ({ ok: true, data: {} }));
  const client = createRuntimeClient(send);
  const reviewContext = { page: { tabId: 12, url: 'https://jobs.test/one', fingerprint: 'job-one' }, descriptors: [{ field_id: 'name', label: 'Full name', type: 'text', options: [] }] };
  await client.fillPage('context', 'resume', [{ field_id: 'name', value: 'Jordan' }], reviewContext);
  expect(send).toHaveBeenCalledWith({ type: 'page.fill', profileContextId: 'context', resumeId: 'resume', fields: [{ field_id: 'name', value: 'Jordan' }], reviewContext });
});


it('forwards the application request identity without extra fields', async () => {
  const send = vi.fn(async () => ({ ok: true, data: {} }));
  const client = createRuntimeClient(send);
  const payload = { profileContextId: 'context', requestId: '550e8400-e29b-41d4-a716-446655440000', variantId: 'resume', company: 'Acme', title: 'Engineer', notes: 'Referred' };
  await client.logApplication({ ...payload, ignored: 'private extra' });
  expect(send).toHaveBeenCalledWith({ type: 'application.log', ...payload });
});
