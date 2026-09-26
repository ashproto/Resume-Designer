export const BRIDGE_BASE_URL = 'http://127.0.0.1:17872';
export const BRIDGE_APP_ID = 'resume-designer';
export const COMPANION_PROTOCOL_VERSION = 2;
export const REQUIRED_CAPABILITIES = Object.freeze([
  'app.launch',
  'pairing.challenge',
  'profile.context',
  'resume.pdf',
  'ai.complete',
  'ai.job-fit',
  'ai.tailored-resume',
  'profile.answers',
  'applications.log',
  'applications.idempotent',
]);

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MAX_AI_RESPONSE_BYTES = 1024 * 1024;

export class BridgeError extends Error {
  constructor(message, { status = null, code = 'bridge_error', retryable = false } = {}) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function classifyHttpError(status, message, data) {
  if (typeof data?.code === 'string' && data.code) {
    const retryableByCode = {
      pairing_pending: true,
      pairing_busy: true,
      invalid_model: false,
      pairing_rejected: false,
      pairing_not_found: false,
      pairing_unavailable: true,
      storage_full: false,
      profile_changed: true,
      bridge_busy: true,
      idempotency_conflict: false,
      invalid_job: false,
      invalid_request_id: false,
      invalid_ai_response: false,
      resume_not_found: false,
      ai_failed: true,
    };
    if (Object.hasOwn(retryableByCode, data.code)) {
      return { code: data.code, retryable: retryableByCode[data.code] };
    }
  }

  if (status === 401) {
    return { code: 'unauthorized', retryable: false };
  }

  if (status === 502) {
    return {
      code: message === 'app window unavailable' ? 'app_unavailable' : 'upstream_failed',
      retryable: true,
    };
  }

  if (status === 504) {
    return { code: 'app_timeout', retryable: true };
  }

  if ((status === 409 || status === 503) && data?.code === 'profile_changed') {
    return { code: 'profile_changed', retryable: true };
  }

  if (status === 500 && /another PDF export is in progress/i.test(message)) {
    return { code: 'pdf_busy', retryable: true };
  }

  return { code: 'http_error', retryable: status >= 500 };
}

function responseTooLargeError() {
  return new BridgeError('Bridge response exceeds 1 MiB', {
    status: 413,
    code: 'response_too_large',
    retryable: false,
  });
}

function validateHealth(data) {
  if (data?.ok !== true || data?.app !== BRIDGE_APP_ID) {
    throw new BridgeError(
      'Another service is using the On Paper companion port',
      { code: 'port_conflict', retryable: false },
    );
  }

  const capabilities = Array.isArray(data.capabilities) ? new Set(data.capabilities) : null;
  if (
    data.protocolVersion !== COMPANION_PROTOCOL_VERSION
    || !capabilities
    || REQUIRED_CAPABILITIES.some((capability) => !capabilities.has(capability))
  ) {
    throw new BridgeError(
      'On Paper must be updated to work with this companion extension',
      { code: 'app_update_required', retryable: false },
    );
  }

  return data;
}

function declaredContentLength(response) {
  const rawLength = response.headers.get('Content-Length');
  if (rawLength === null || !/^\d+$/.test(rawLength.trim())) return null;
  return Number(rawLength);
}

async function readTextWithinLimit(response, maxBytes, signal) {
  const contentLength = declaredContentLength(response);
  if (contentLength !== null && contentLength > maxBytes) {
    try {
      await response.body?.cancel?.();
    } catch {
      // The declared size remains authoritative if stream cancellation fails.
    }
    throw responseTooLargeError();
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw responseTooLargeError();
    }
    return text;
  }

  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const decoder = new TextDecoder();
  const parts = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size error remains authoritative if stream cancellation fails.
        }
        throw responseTooLargeError();
      }
      parts.push(decoder.decode(chunk, { stream: true }));
    }
    parts.push(decoder.decode());
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }

  return parts.join('');
}

async function readResponse(response, maxBytes, signal) {
  const text = maxBytes === undefined
    ? await response.text()
    : await readTextWithinLimit(response, maxBytes, signal);

  if (!text) return { text, data: null };

  try {
    return { text, data: JSON.parse(text) };
  } catch {
    return { text, data: null };
  }
}

function responseMessage(response, text, data) {
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  if (typeof data?.message === 'string' && data.message.trim()) return data.message;
  if (text.trim()) return text.trim();
  if (response.statusText) return response.statusText;
  return `Bridge request failed with status ${response.status}`;
}

export function createBridgeClient({
  fetchImpl = globalThis.fetch,
  getToken = async () => null,
  baseUrl = BRIDGE_BASE_URL,
  requestTimeoutMs,
} = {}) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  async function performRequest(path, {
    method = 'GET',
    payload,
    authenticated = true,
    maxResponseBytes,
    signal,
  } = {}) {
    const headers = new Headers({ Accept: 'application/json' });

    if (authenticated) {
      const token = String(await getToken() ?? '').trim();
      if (!token) {
        throw new BridgeError('Pairing token is required', {
          code: 'not_paired',
          retryable: false,
        });
      }
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (signal?.aborted) {
      throw new BridgeError('Request cancelled', { code: 'request_cancelled', retryable: false });
    }

    const options = { method, headers, signal };
    if (payload !== undefined) {
      const body = JSON.stringify(payload);
      if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BODY_BYTES) {
        throw new BridgeError('Bridge request body exceeds 1 MiB', {
          status: 413,
          code: 'request_too_large',
          retryable: false,
        });
      }

      headers.set('Content-Type', 'application/json');
      options.body = body;
    }

    let response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, options);
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      throw new BridgeError(
        error instanceof Error && error.message ? error.message : 'Unable to reach On Paper',
        { code: 'network_error', retryable: true },
      );
    }

    const { text, data } = await readResponse(response, maxResponseBytes, signal);
    if (!response.ok) {
      const message = responseMessage(response, text, data);
      throw new BridgeError(message, {
        status: response.status,
        ...classifyHttpError(response.status, message, data),
      });
    }

    if (data === null) {
      throw new BridgeError('Bridge returned a non-JSON response', {
        status: response.status,
        code: 'invalid_response',
        retryable: true,
      });
    }

    return data;
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeoutMs = requestTimeoutMs ?? (
      path === '/health' || path.startsWith('/pairing/') ? 4_000
        : (path.startsWith('/ai/') && path !== '/ai/models') || path.endsWith('/pdf') ? 185_000 : 30_000
    );
    let timer;
    let cancel;
    const interrupted = new Promise((_, reject) => {
      cancel = () => {
        reject(new BridgeError('Request cancelled', { code: 'request_cancelled', retryable: false }));
        controller.abort();
      };
      options.signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => {
        reject(new BridgeError('On Paper took too long to respond. Try again.', {
          code: 'app_timeout', retryable: true,
        }));
        controller.abort();
      }, timeoutMs);
      if (options.signal?.aborted) cancel();
    });
    try {
      if (options.signal?.aborted) return await interrupted;
      return await Promise.race([
        performRequest(path, { ...options, signal: controller.signal }), interrupted,
      ]);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  const resumePath = (id) => `/resumes/${encodeURIComponent(String(id))}`;

  return {
    health: async (options = {}) => validateHealth(await request('/health', { ...options, authenticated: false })),
    claimPairing: (payload, options = {}) => request('/pairing/claim', {
      ...options, method: 'POST', payload, authenticated: false,
    }),
    requestPairing: (payload, options = {}) => request('/pairing/request', {
      ...options, method: 'POST', payload, authenticated: false,
    }),
    revokePairing: () => request('/pairing/revoke', { method: 'POST', payload: {} }),
    listResumes: (options = {}) => request('/resumes', options),
    getAIModels: () => request('/ai/models', { maxResponseBytes: MAX_AI_RESPONSE_BYTES }),
    getResume: (id) => request(resumePath(id)),
    getPdf: (id) => request(`${resumePath(id)}/pdf`),
    complete: (payload) => request('/ai/complete', {
      method: 'POST',
      payload,
      maxResponseBytes: MAX_AI_RESPONSE_BYTES,
    }),
    analyzeJobFit: (payload) => request('/ai/job-fit', {
      method: 'POST', payload, maxResponseBytes: MAX_AI_RESPONSE_BYTES,
    }),
    createTailoredResume: (payload, options = {}) => request('/ai/tailored-resume', {
      ...options, method: 'POST', payload, maxResponseBytes: MAX_AI_RESPONSE_BYTES,
    }),
    logApplication: (payload, options = {}) => request('/applications', { ...options, method: 'POST', payload }),
    saveAnswer: (payload, options = {}) => request('/profile/answers', { ...options, method: 'POST', payload }),
  };
}
