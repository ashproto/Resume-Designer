export const BRIDGE_BASE_URL = 'http://127.0.0.1:17872';

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

export class BridgeError extends Error {
  constructor(message, { status = null, code = 'bridge_error', retryable = false } = {}) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function classifyHttpError(status, message) {
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

  if (status === 500 && /another PDF export is in progress/i.test(message)) {
    return { code: 'pdf_busy', retryable: true };
  }

  return { code: 'http_error', retryable: status >= 500 };
}

async function readResponse(response) {
  const text = await response.text();

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
} = {}) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  async function request(path, { method = 'GET', payload, authenticated = true } = {}) {
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

    const options = { method, headers };
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
        error instanceof Error && error.message ? error.message : 'Unable to reach Resume Designer',
        { code: 'network_error', retryable: true },
      );
    }

    const { text, data } = await readResponse(response);
    if (!response.ok) {
      const message = responseMessage(response, text, data);
      throw new BridgeError(message, {
        status: response.status,
        ...classifyHttpError(response.status, message),
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

  const resumePath = (id) => `/resumes/${encodeURIComponent(String(id))}`;

  return {
    health: () => request('/health', { authenticated: false }),
    listResumes: () => request('/resumes'),
    getResume: (id) => request(resumePath(id)),
    getPdf: (id) => request(`${resumePath(id)}/pdf`),
    complete: (payload) => request('/ai/complete', { method: 'POST', payload }),
    logApplication: (payload) => request('/applications', { method: 'POST', payload }),
    saveAnswer: (payload) => request('/profile/answers', { method: 'POST', payload }),
  };
}
