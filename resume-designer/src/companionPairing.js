const PROTOCOL_VERSION = '2';
const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_PENDING = 8;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const json = (status, body) => ({ status, body });

function notFound() {
  return json(404, { error: 'pairing request was not found or has expired', code: 'pairing_not_found' });
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function pairingUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'resume-designer:'
    || url.hostname !== 'companion'
    || url.searchParams.get('protocolVersion') !== PROTOCOL_VERSION
  ) {
    return null;
  }

  if (url.pathname === '/open') return { kind: 'open' };
  if (url.pathname !== '/pair') return null;

  const requestId = url.searchParams.get('requestId') ?? '';
  const challenge = url.searchParams.get('challenge') ?? '';
  const clientId = String(url.searchParams.get('clientId') ?? '').slice(0, 128);
  if (!REQUEST_ID_PATTERN.test(requestId) || !CHALLENGE_PATTERN.test(challenge)) return null;
  return { kind: 'pair', requestId, challenge, clientId };
}

export function createCompanionPairing({
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  maxPending = DEFAULT_MAX_PENDING,
  confirmPairing = async () => false,
  ensureToken = () => '',
  flush = async () => true,
} = {}) {
  const pending = new Map();
  let approvalInFlight = false;
  let lastRequestAt = -Infinity;

  function prune() {
    const current = now();
    for (const [requestId, grant] of pending) {
      if (grant.expiresAt <= current) pending.delete(requestId);
    }
  }

  async function registerUrl(rawUrl) {
    const parsed = pairingUrl(rawUrl);
    if (!parsed || parsed.kind === 'open') return parsed;

    prune();
    const existing = pending.get(parsed.requestId);
    if (existing) {
      if (constantTimeEqual(existing.challenge, parsed.challenge)) {
        return { kind: 'pair', requestId: parsed.requestId };
      }
      return null;
    }

    if (approvalInFlight) return null;

    while (pending.size >= maxPending) {
      pending.delete(pending.keys().next().value);
    }

    const grant = {
      challenge: parsed.challenge,
      expiresAt: now() + ttlMs,
      status: 'pending',
    };
    pending.set(parsed.requestId, grant);

    approvalInFlight = true;
    try {
      const approved = await confirmPairing({
        requestId: parsed.requestId,
        clientId: parsed.clientId,
      });
      if (pending.get(parsed.requestId) === grant) {
        grant.status = approved ? 'approved' : 'rejected';
      }
    } catch {
      if (pending.get(parsed.requestId) === grant) grant.status = 'rejected';
    } finally {
      approvalInFlight = false;
    }

    return { kind: 'pair', requestId: parsed.requestId };
  }

  function request({ protocolVersion, requestId, challenge, clientId } = {}) {
    if (![protocolVersion, requestId, challenge, clientId].every((value) => typeof value === 'string')
      || protocolVersion !== PROTOCOL_VERSION || !REQUEST_ID_PATTERN.test(requestId ?? '')
      || !CHALLENGE_PATTERN.test(challenge ?? '') || !/^[a-p]{32}$/.test(clientId ?? '')) {
      return json(400, { error: 'valid pairing challenge and extension ID are required', code: 'invalid_pairing_request' });
    }
    prune();
    const existing = pending.get(requestId);
    if (existing) {
      return constantTimeEqual(existing.challenge, challenge)
        ? json(202, { pending: true })
        : json(409, { error: 'pairing request ID is already in use', code: 'invalid_pairing_request' });
    }
    if (approvalInFlight || now() - lastRequestAt < 5_000) {
      return json(429, { error: 'Finish the current pairing request in On Paper, then try again.', code: 'pairing_busy' });
    }
    lastRequestAt = now();
    const url = new URL('resume-designer://companion/pair');
    for (const [key, value] of Object.entries({ protocolVersion, requestId, challenge, clientId })) {
      url.searchParams.set(key, value);
    }
    // registerUrl installs the challenge synchronously, then awaits native
    // approval. HTTP returns only pending; the proof-protected claim is separate.
    void registerUrl(url.href);
    return json(202, { pending: true });
  }

  async function claim({ requestId, verifier } = {}) {
    if (!REQUEST_ID_PATTERN.test(requestId ?? '') || !VERIFIER_PATTERN.test(verifier ?? '')) {
      return json(400, { error: 'requestId and verifier are required', code: 'invalid_pairing_claim' });
    }

    prune();
    const grant = pending.get(requestId);
    if (!grant) return notFound();

    const actualChallenge = await challengeFor(verifier);
    if (pending.get(requestId) !== grant) return notFound();
    if (!constantTimeEqual(grant.challenge, actualChallenge)) return notFound();
    if (grant.status === 'pending' || grant.status === 'claiming') {
      return json(425, { error: 'pairing approval is pending', code: 'pairing_pending' });
    }
    if (grant.status === 'rejected') {
      pending.delete(requestId);
      return json(403, { error: 'pairing request was rejected', code: 'pairing_rejected' });
    }

    grant.status = 'claiming';
    let token;
    try {
      token = String(ensureToken() ?? '').trim();
    } catch {
      grant.status = 'approved';
      return json(503, { error: 'pairing token is unavailable', code: 'pairing_unavailable' });
    }
    if (!token) {
      grant.status = 'approved';
      return json(503, { error: 'pairing token is unavailable', code: 'pairing_unavailable' });
    }
    try {
      const durable = await flush();
      if (durable !== true) {
        grant.status = 'approved';
        return json(503, { error: 'pairing token could not be saved', code: 'pairing_unavailable' });
      }
    } catch {
      grant.status = 'approved';
      return json(503, { error: 'pairing token could not be saved', code: 'pairing_unavailable' });
    }

    if (pending.get(requestId) !== grant) return notFound();
    pending.delete(requestId);
    return json(200, { token });
  }

  return {
    claim,
    request,
    revokeAll: () => pending.clear(),
    pendingCount: () => {
      prune();
      return pending.size;
    },
    registerUrl,
  };
}
