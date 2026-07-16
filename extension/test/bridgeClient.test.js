import { describe, expect, it, vi } from 'vitest';

import {
  BRIDGE_BASE_URL,
  BridgeError,
  createBridgeClient,
} from '../src/bridgeClient.js';

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
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
    ['listResumes', [], '/resumes'],
    ['getResume', ['variant-1'], '/resumes/variant-1'],
    ['getPdf', ['variant-1'], '/resumes/variant-1/pdf'],
    ['complete', [{ messages: [{ role: 'user', content: 'Hello' }] }], '/ai/complete'],
    ['logApplication', [{ variantId: 'variant-1' }], '/applications'],
    ['saveAnswer', [{ question: 'Notice?', answer: 'Two weeks' }], '/profile/answers'],
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
    const message = 'the app did not answer in time — is Resume Designer running and unlocked?';
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
