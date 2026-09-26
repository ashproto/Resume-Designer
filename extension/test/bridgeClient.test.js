import { describe, expect, it, vi } from 'vitest';

import {
  BRIDGE_BASE_URL,
  REQUIRED_CAPABILITIES,
  BridgeError,
  createBridgeClient,
} from '../src/bridgeClient.js';

const ONE_MIB = 1024 * 1024;

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function streamedJsonResponse(body, { chunkSize = 64 * 1024 } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const telemetry = { bytesEnqueued: 0, cancelled: false };
  let offset = 0;

  const response = new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }

      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
      telemetry.bytesEnqueued = offset;
    },
    cancel() {
      telemetry.cancelled = true;
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  return { response, telemetry, totalBytes: bytes.byteLength };
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('Expected promise to reject');
}

function makeClient(fetchImpl, getToken = vi.fn(async () => 'pairing-token')) {
  return createBridgeClient({ fetchImpl, getToken });
}

describe('createBridgeClient', () => {
  it('uses the fixed loopback bridge base URL', () => {
    expect(BRIDGE_BASE_URL).toBe('http://127.0.0.1:17872');
  });

  it('calls health without reading or sending the bearer token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      ok: true,
      app: 'resume-designer',
      protocolVersion: 2,
      capabilities: [...REQUIRED_CAPABILITIES],
    }));
    const getToken = vi.fn(async () => 'must-not-leak');

    await makeClient(fetchImpl, getToken).health();

    expect(getToken).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BRIDGE_BASE_URL}/health`);
    expect(options.method).toBe('GET');
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
  });

  it.each([
    [{ ok: true, app: 'something-else', protocolVersion: 2, capabilities: [] }, 'port_conflict'],
    [{ ok: true, app: 'resume-designer', protocolVersion: 1, capabilities: [] }, 'app_update_required'],
    [{
      ok: true,
      app: 'resume-designer',
      protocolVersion: 2,
      capabilities: ['profile.context'],
    }, 'app_update_required'],
  ])('rejects an invalid or incompatible health identity before auth (%s)', async (health, code) => {
    const getToken = vi.fn(async () => 'must-not-send');
    const fetchImpl = vi.fn(async () => jsonResponse(health));
    const client = makeClient(fetchImpl, getToken);

    await expect(client.health()).rejects.toMatchObject({ code, retryable: false });

    expect(getToken).not.toHaveBeenCalled();
    expect(new Headers(fetchImpl.mock.calls[0][1].headers).has('Authorization')).toBe(false);
  });

  it('claims a pairing grant without reading or sending the bearer token', async () => {
    const getToken = vi.fn(async () => 'must-not-leak');
    const fetchImpl = vi.fn(async () => jsonResponse({ token: 'claimed-token' }));
    const client = makeClient(fetchImpl, getToken);

    await expect(client.claimPairing({ requestId: 'request-id', verifier: 'verifier' }))
      .resolves.toEqual({ token: 'claimed-token' });

    expect(getToken).not.toHaveBeenCalled();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BRIDGE_BASE_URL}/pairing/claim`);
    expect(options.method).toBe('POST');
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
  });

  it.each([
    ['listResumes', [], '/resumes'],
    ['getResume', ['variant-1'], '/resumes/variant-1'],
    ['getPdf', ['variant-1'], '/resumes/variant-1/pdf'],
    ['complete', [{ messages: [{ role: 'user', content: 'Hello' }] }], '/ai/complete'],
    ['logApplication', [{ variantId: 'variant-1' }], '/applications'],
    ['saveAnswer', [{ question: 'Notice?', answer: 'Two weeks' }], '/profile/answers'],
    ['analyzeJobFit', [{ resumeId: 'variant-1', job: { description: 'Build things' } }], '/ai/job-fit'],
    ['createTailoredResume', [{ resumeId: 'variant-1', requestId: 'request-1', job: { description: 'Build things' } }], '/ai/tailored-resume'],
  ])('sends a bearer token for %s', async (method, args, expectedPath) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const getToken = vi.fn(async () => '  secret token  ');

    await makeClient(fetchImpl, getToken)[method](...args);

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BRIDGE_BASE_URL}${expectedPath}`);
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer secret token');
  });

  it.each([
    ['complete', '/ai/complete', { messages: [{ role: 'user', content: 'Hello' }] }],
    ['logApplication', '/applications', { variantId: 'variant-1', company: 'Acme' }],
    ['saveAnswer', '/profile/answers', { question: 'Notice?', answer: 'Two weeks' }],
    ['analyzeJobFit', '/ai/job-fit', { resumeId: 'variant-1', job: { description: 'Build things' } }],
    ['createTailoredResume', '/ai/tailored-resume', { resumeId: 'variant-1', requestId: 'request-1', job: { description: 'Build things' } }],
  ])('sends JSON for %s', async (method, expectedPath, payload) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));

    await makeClient(fetchImpl)[method](payload);

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BRIDGE_BASE_URL}${expectedPath}`);
    expect(options.method).toBe('POST');
    expect(new Headers(options.headers).get('Content-Type')).toBe('application/json');
    expect(options.body).toBe(JSON.stringify(payload));
  });

  it('returns the complete bridge JSON object unchanged', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ text: 'Drafted answer' }));
    const payload = {
      messages: [{ role: 'user', content: 'Draft an answer' }],
      systemPrompt: 'Be concise',
      reasoningEffort: 'low',
    };

    const result = await makeClient(fetchImpl).complete(payload);

    expect(result).toEqual({ text: 'Drafted answer' });
  });

  it.each(['analyzeJobFit', 'createTailoredResume'])('applies the 1 MiB cap to %s responses', async (method) => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      { analysis: 'x'.repeat(ONE_MIB) },
      { headers: { 'Content-Length': String(ONE_MIB + 100) } },
    ));

    await expect(makeClient(fetchImpl)[method]({})).rejects.toMatchObject({
      code: 'response_too_large',
      retryable: false,
    });
  });

  it('rejects an AI completion whose Content-Length exceeds 1 MiB before reading it', async () => {
    const cancel = vi.fn(async () => undefined);
    const getReader = vi.fn();
    const readText = vi.fn();
    const response = {
      body: { cancel, getReader },
      headers: new Headers({ 'Content-Length': String(ONE_MIB + 1) }),
      ok: true,
      status: 200,
      statusText: 'OK',
      text: readText,
    };
    const fetchImpl = vi.fn(async () => response);

    const error = await captureError(makeClient(fetchImpl).complete({
      messages: [{ role: 'user', content: 'Hello' }],
    }));

    expect(cancel).toHaveBeenCalledOnce();
    expect(getReader).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({
      code: 'response_too_large',
      retryable: false,
    });
  });

  it('stream-counts UTF-8 bytes when rejecting an oversized AI completion', async () => {
    const { response, telemetry, totalBytes } = streamedJsonResponse({
      text: 'é'.repeat(ONE_MIB * 2),
    });
    const fetchImpl = vi.fn(async () => response);

    const error = await captureError(makeClient(fetchImpl).complete({
      messages: [{ role: 'user', content: 'Hello' }],
    }));

    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({
      code: 'response_too_large',
      retryable: false,
    });
    expect(telemetry.cancelled).toBe(true);
    expect(telemetry.bytesEnqueued).toBeLessThan(totalBytes);
  });

  it('accepts an AI completion whose JSON body is exactly 1 MiB', async () => {
    const envelopeBytes = new TextEncoder().encode(JSON.stringify({ text: '' })).byteLength;
    const body = { text: 'x'.repeat(ONE_MIB - envelopeBytes) };
    expect(new TextEncoder().encode(JSON.stringify(body))).toHaveLength(ONE_MIB);
    const fetchImpl = vi.fn(async () => jsonResponse(body));

    const result = await makeClient(fetchImpl).complete({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.text).toHaveLength(ONE_MIB - envelopeBytes);
  });

  it('does not apply the AI completion response cap to PDF responses', async () => {
    const pdfBase64 = 'A'.repeat(ONE_MIB + 1);
    const fetchImpl = vi.fn(async () => jsonResponse(
      { filename: 'resume.pdf', pdfBase64 },
      { headers: { 'Content-Length': String(ONE_MIB + 100) } },
    ));

    const result = await makeClient(fetchImpl).getPdf('variant-1');

    expect(result).toEqual({ filename: 'resume.pdf', pdfBase64 });
  });

  it('escapes resume ids as a single path segment', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const client = makeClient(fetchImpl);

    await client.getResume('résumé/id?draft=true');
    await client.getPdf('résumé/id?draft=true');

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${BRIDGE_BASE_URL}/resumes/r%C3%A9sum%C3%A9%2Fid%3Fdraft%3Dtrue`,
      `${BRIDGE_BASE_URL}/resumes/r%C3%A9sum%C3%A9%2Fid%3Fdraft%3Dtrue/pdf`,
    ]);
  });

  it('preserves a non-JSON error body', async () => {
    const fetchImpl = vi.fn(async () => new Response('loopback proxy failed', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'Content-Type': 'text/plain' },
    }));

    const error = await captureError(makeClient(fetchImpl).listResumes());

    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({
      message: 'loopback proxy failed',
      status: 502,
      code: 'upstream_failed',
      retryable: true,
    });
  });

  it('classifies 401 responses as unauthorized and preserves the server message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      { error: 'invalid or missing bearer token' },
      { status: 401 },
    ));

    const error = await captureError(makeClient(fetchImpl).listResumes());

    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({
      message: 'invalid or missing bearer token',
      status: 401,
      code: 'unauthorized',
      retryable: false,
    });
  });

  it.each([
    [425, 'pairing_pending', true],
    [403, 'pairing_rejected', false],
    [404, 'pairing_not_found', false],
    [507, 'storage_full', false],
    [503, 'bridge_busy', true],
    [409, 'idempotency_conflict', false],
    [400, 'invalid_job', false],
    [502, 'ai_failed', true],
  ])('preserves typed bridge errors (%i %s)', async (status, code, retryable) => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      { error: `typed ${code}`, code },
      { status },
    ));
    const client = makeClient(fetchImpl);
    const operation = code.startsWith('pairing_')
      ? client.claimPairing({ requestId: 'request-id', verifier: 'verifier' })
      : client.createTailoredResume({});

    await expect(operation).rejects.toMatchObject({ status, code, retryable });
  });

  it('classifies an in-progress PDF export as retryable', async () => {
    const message = 'another PDF export is in progress — try again in a moment';
    const fetchImpl = vi.fn(async () => jsonResponse({ error: message }, { status: 500 }));

    const error = await captureError(makeClient(fetchImpl).getPdf('variant-1'));

    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({
      message,
      status: 500,
      code: 'pdf_busy',
      retryable: true,
    });
  });

  it('distinguishes an unavailable app window from other 502 failures', async () => {
    const appUnavailableFetch = vi.fn(async () => jsonResponse(
      { error: 'app window unavailable' },
      { status: 502 },
    ));
    const upstreamFetch = vi.fn(async () => jsonResponse(
      { error: 'OpenRouter rate limited the request' },
      { status: 502 },
    ));

    const unavailable = await captureError(makeClient(appUnavailableFetch).listResumes());
    const upstream = await captureError(makeClient(upstreamFetch).complete({
      messages: [{ role: 'user', content: 'Hello' }],
    }));

    expect(unavailable).toMatchObject({
      message: 'app window unavailable',
      status: 502,
      code: 'app_unavailable',
      retryable: true,
    });
    expect(upstream).toMatchObject({
      message: 'OpenRouter rate limited the request',
      status: 502,
      code: 'upstream_failed',
      retryable: true,
    });
  });

  it('classifies 504 responses as app timeouts and retryable', async () => {
    const message = 'the app did not answer in time — is On Paper running and unlocked?';
    const fetchImpl = vi.fn(async () => jsonResponse({ error: message }, { status: 504 }));

    const error = await captureError(makeClient(fetchImpl).listResumes());

    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({
      message,
      status: 504,
      code: 'app_timeout',
      retryable: true,
    });
  });

  it('preserves an active-profile conflict as a refreshable profile change', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      error: 'profile context changed; refresh the companion extension',
      code: 'profile_changed',
    }, { status: 409 }));

    const error = await captureError(makeClient(fetchImpl).saveAnswer({
      profileContextId: 'context-old',
      question: 'Notice period?',
      answer: 'Two weeks',
    }));

    expect(error).toMatchObject({
      status: 409,
      code: 'profile_changed',
      retryable: true,
    });
  });

  it('classifies a restore-window 503 as a retryable profile change', async () => {
    const message = 'import in progress; retry after the active profile is restored';
    const fetchImpl = vi.fn(async () => jsonResponse({
      error: message,
      code: 'profile_changed',
    }, { status: 503 }));

    const error = await captureError(makeClient(fetchImpl).listResumes());

    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({
      message,
      status: 503,
      code: 'profile_changed',
      retryable: true,
    });
  });

  it('classifies fetch failures as retryable network errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    const error = await captureError(makeClient(fetchImpl).listResumes());

    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({
      message: 'Failed to fetch',
      status: null,
      code: 'network_error',
      retryable: true,
    });
  });

  it('rejects a POST body above 1 MiB by UTF-8 byte length without fetching', async () => {
    const fetchImpl = vi.fn();
    const toJSON = vi.fn(() => ({ answer: 'é'.repeat(524_289) }));

    const error = await captureError(makeClient(fetchImpl).saveAnswer({ toJSON }));

    expect(toJSON).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({
      message: 'Bridge request body exceeds 1 MiB',
      status: 413,
      code: 'request_too_large',
      retryable: false,
    });
  });

  it('rejects authenticated requests when no pairing token is stored', async () => {
    const fetchImpl = vi.fn();

    const error = await captureError(makeClient(fetchImpl, async () => '').listResumes());

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({
      message: 'Pairing token is required',
      status: null,
      code: 'not_paired',
      retryable: false,
    });
  });
});

 describe('bounded bridge requests', () => {
  it('times out even when fetch never settles, and aborts the underlying request', async () => {
    vi.useFakeTimers();
    try {
      let signal;
      const client = createBridgeClient({ getToken: async () => 'token', requestTimeoutMs: 25,
        fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
      const result = captureError(client.listResumes());
      await vi.advanceTimersByTimeAsync(25);
      expect(await result).toMatchObject({ code: 'app_timeout', retryable: true });
      expect(signal.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('cancels health while fetch is pending without waiting for its deadline', async () => {
    const abort = new AbortController();
    const client = createBridgeClient({ fetchImpl: async () => new Promise(() => {}) });
    const result = captureError(client.health({ signal: abort.signal }));
    abort.abort();
    expect(await result).toMatchObject({ code: 'request_cancelled', retryable: false });
  });

  it('bounds a response body that stalls after headers', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const client = createBridgeClient({ getToken: async () => 'token', requestTimeoutMs: 25,
        fetchImpl: async () => new Response(new ReadableStream({ cancel })) });
      const result = captureError(client.getAIModels());
      await vi.advanceTimersByTimeAsync(25);
      expect(await result).toMatchObject({ code: 'app_timeout' });
      expect(cancel).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});


describe('mutation cancellation while reading the session token', () => {
  it.each(['saveAnswer', 'logApplication', 'createTailoredResume'])('does not dispatch cancelled %s after token lookup resolves', async (method) => {
    let resolveToken;
    const token = new Promise((resolve) => { resolveToken = resolve; });
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const client = makeClient(fetchImpl, () => token);
    const controller = new AbortController();
    const outcome = captureError(client[method]({}, { signal: controller.signal }));
    controller.abort();
    resolveToken('new-session-token');
    expect(await outcome).toMatchObject({ code: 'request_cancelled', retryable: false });
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});


it('requires durable application idempotency before connecting', async () => {
  const client = createBridgeClient({ fetchImpl: async () => jsonResponse({ ok: true, app: 'resume-designer', protocolVersion: 2, capabilities: REQUIRED_CAPABILITIES.filter((capability) => capability !== 'applications.idempotent') }) });
  await expect(client.health()).rejects.toMatchObject({ code: 'app_update_required' });
});
