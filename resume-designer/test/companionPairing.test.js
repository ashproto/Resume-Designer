import { describe, expect, it, vi } from 'vitest';

import { createCompanionPairing } from '../src/companionPairing.js';

const CLIENT_ID = 'keggfbelidgpjiapcbgkjidenhdjmega';
const REQUEST_ID = 'abcdefghijklmnopqrstuv';
const VERIFIER = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';

async function challengeFor(verifier) {
  const bytes = new TextEncoder().encode(verifier);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Buffer.from(digest).toString('base64url');
}

async function pairUrl(overrides = {}) {
  const requestId = overrides.requestId ?? REQUEST_ID;
  const verifier = overrides.verifier ?? VERIFIER;
  const challenge = overrides.challenge ?? await challengeFor(verifier);
  const protocolVersion = overrides.protocolVersion ?? '2';
  return `resume-designer://companion/pair?protocolVersion=${protocolVersion}`
    + `&requestId=${requestId}&challenge=${challenge}&clientId=${overrides.clientId ?? CLIENT_ID}`;
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('companion pairing identity', () => {
  it('rejects an unrelated extension deep link before requesting native consent', async () => {
    const confirmPairing = vi.fn(async () => true);
    const pairing = createCompanionPairing({ confirmPairing });
    expect(await pairing.registerUrl(await pairUrl({ clientId: 'b'.repeat(32) }))).toBeNull();
    expect(confirmPairing).not.toHaveBeenCalled();
    expect(pairing.pendingCount()).toBe(0);
  });

  it('rejects an unrelated extension HTTP request before requesting native consent', async () => {
    const confirmPairing = vi.fn(async () => true);
    const pairing = createCompanionPairing({ confirmPairing });
    expect(pairing.request({
      protocolVersion: '2', requestId: REQUEST_ID,
      challenge: await challengeFor(VERIFIER), clientId: 'b'.repeat(32),
    })).toMatchObject({ status: 403, body: { code: 'untrusted_pairing_client' } });
    expect(confirmPairing).not.toHaveBeenCalled();
    expect(pairing.pendingCount()).toBe(0);
  });
});

describe('companion pairing client binding', () => {
  it.each([false, true])('allows the unpacked client only in a development frontend: %s', async (development) => {
    vi.stubEnv('DEV', development);
    try {
      const clientId = 'jejabnlfgdapamjoechlgmgpmldekffo';
      const confirmPairing = vi.fn(async () => true);
      const pairing = createCompanionPairing({ confirmPairing, ensureToken: () => 'install-token' });
      const registration = await pairing.registerUrl(await pairUrl({ clientId }));
      if (development) {
        expect(registration).toEqual({ kind: 'pair', requestId: REQUEST_ID });
        expect(await pairing.claim({ clientId, requestId: REQUEST_ID, verifier: VERIFIER }))
          .toMatchObject({ status: 200 });
      } else {
        expect(registration).toBeNull();
        expect(pairing.request({
          protocolVersion: '2', requestId: REQUEST_ID, challenge: await challengeFor(VERIFIER), clientId,
        })).toMatchObject({ status: 403 });
        expect(confirmPairing).not.toHaveBeenCalled();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('binds an approved cold-link grant and duplicate requests to one trusted client', async () => {
    vi.stubEnv('DEV', true);
    try {
      const otherClientId = 'jejabnlfgdapamjoechlgmgpmldekffo';
      const confirmPairing = vi.fn(async () => true);
      const ensureToken = vi.fn(() => 'install-token');
      const pairing = createCompanionPairing({ confirmPairing, ensureToken });
      await pairing.registerUrl(await pairUrl());
      expect(await pairing.registerUrl(await pairUrl({ clientId: otherClientId }))).toBeNull();
      expect(pairing.request({
        protocolVersion: '2', requestId: REQUEST_ID,
        challenge: await challengeFor(VERIFIER), clientId: otherClientId,
      })).toMatchObject({ status: 409 });
      for (const clientId of [undefined, 'b'.repeat(32), otherClientId]) {
        expect(await pairing.claim({ clientId, requestId: REQUEST_ID, verifier: VERIFIER }))
          .toMatchObject({ status: 404 });
      }
      expect(confirmPairing).toHaveBeenCalledOnce();
      expect(ensureToken).not.toHaveBeenCalled();
      expect(await pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER }))
        .toMatchObject({ status: 200, body: { token: 'install-token' } });
      expect(ensureToken).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('companion pairing grants', () => {
  it('accepts only exact launch and pair deep-link shapes', async () => {
    const pairing = createCompanionPairing({ confirmPairing: vi.fn(async () => true) });

    expect(await pairing.registerUrl('resume-designer://companion/open?protocolVersion=2'))
      .toEqual({ kind: 'open' });
    expect(await pairing.registerUrl('https://companion/open?protocolVersion=2')).toBeNull();
    expect(await pairing.registerUrl('resume-designer://other/open?protocolVersion=2')).toBeNull();
    expect(await pairing.registerUrl('resume-designer://companion/open?protocolVersion=1')).toBeNull();
    expect(await pairing.registerUrl(`${await pairUrl()}&extra=not-secret`))
      .toEqual({ kind: 'pair', requestId: REQUEST_ID });
  });

  it('keeps a grant pending until approval, then flushes before a single successful claim', async () => {
    const confirmation = deferred();
    const events = [];
    const pairing = createCompanionPairing({
      confirmPairing: vi.fn(() => confirmation.promise),
      ensureToken: vi.fn(() => {
        events.push('token');
        return 'install-token';
      }),
      flush: vi.fn(async () => {
        events.push('flush');
        return true;
      }),
    });

    const registration = pairing.registerUrl(await pairUrl());
    await vi.waitFor(() => expect(pairing.pendingCount()).toBe(1));
    await expect(pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).resolves.toEqual({
      status: 425,
      body: { error: 'pairing approval is pending', code: 'pairing_pending' },
    });

    confirmation.resolve(true);
    await expect(registration).resolves.toEqual({ kind: 'pair', requestId: REQUEST_ID });
    await expect(pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).resolves.toEqual({
      status: 200,
      body: { token: 'install-token' },
    });
    expect(events).toEqual(['token', 'flush']);
    await expect(pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).resolves.toMatchObject({
      status: 404,
      body: { code: 'pairing_not_found' },
    });
  });

  it('invalidates approved and in-flight grants when pairing is revoked', async () => {
    const durability = deferred();
    const flush = vi.fn(() => durability.promise);
    const pairing = createCompanionPairing({
      confirmPairing: vi.fn(async () => true),
      ensureToken: () => 'install-token',
      flush,
    });
    await pairing.registerUrl(await pairUrl());
    const operation = pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER });
    await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce());
    pairing.revokeAll();
    durability.resolve(true);
    expect(await operation).toMatchObject({ status: 404 });
    expect(pairing.pendingCount()).toBe(0);
    expect(await pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).toMatchObject({ status: 404 });
  });

  it('does not revive an approval dialog that completes after revocation', async () => {
    const approval = deferred();
    const pairing = createCompanionPairing({ confirmPairing: () => approval.promise });
    const operation = pairing.registerUrl(await pairUrl());
    pairing.revokeAll();
    approval.resolve(true);
    await operation;
    expect(await pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).toMatchObject({ status: 404 });
  });

  it('never exposes a token for wrong, rejected, expired, or malformed claims', async () => {
    let now = 1_000;
    const ensureToken = vi.fn(() => 'secret');
    const pairing = createCompanionPairing({
      now: () => now,
      ttlMs: 100,
      confirmPairing: vi.fn(async ({ requestId }) => requestId !== 'rejectedrequestid12345'),
      ensureToken,
    });

    await pairing.registerUrl(await pairUrl());
    await expect(pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: `${VERIFIER}wrong` }))
      .resolves.toMatchObject({ status: 404 });

    const rejectedId = 'rejectedrequestid12345';
    const rejectedUrl = await pairUrl({ requestId: rejectedId });
    await pairing.registerUrl(rejectedUrl);
    await expect(pairing.claim({ clientId: CLIENT_ID, requestId: rejectedId, verifier: VERIFIER })).resolves.toMatchObject({
      status: 403,
      body: { code: 'pairing_rejected' },
    });

    const expiredId = 'expiredrequestid123456';
    await pairing.registerUrl(await pairUrl({ requestId: expiredId }));
    now += 101;
    await expect(pairing.claim({ clientId: CLIENT_ID, requestId: expiredId, verifier: VERIFIER })).resolves.toMatchObject({
      status: 404,
      body: { code: 'pairing_not_found' },
    });
    await expect(pairing.claim({ clientId: CLIENT_ID, requestId: '', verifier: '' })).resolves.toMatchObject({ status: 400 });
    expect(ensureToken).not.toHaveBeenCalled();
  });

  it('retains an approved one-time grant when durable token flush fails so it can be retried', async () => {
    const flush = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(true);
    const pairing = createCompanionPairing({
      confirmPairing: vi.fn(async () => true),
      ensureToken: vi.fn(() => 'install-token'),
      flush,
    });
    await pairing.registerUrl(await pairUrl());

    await expect(pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).resolves.toEqual({
      status: 503,
      body: { error: 'pairing token could not be saved', code: 'pairing_unavailable' },
    });
    await expect(pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).resolves.toEqual({
      status: 200,
      body: { token: 'install-token' },
    });
  });

  it('treats a false durability result as a retryable pairing failure', async () => {
    const flush = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const pairing = createCompanionPairing({
      confirmPairing: vi.fn(async () => true),
      ensureToken: vi.fn(() => 'install-token'),
      flush,
    });
    await pairing.registerUrl(await pairUrl());

    await expect(pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).resolves.toEqual({
      status: 503,
      body: { error: 'pairing token could not be saved', code: 'pairing_unavailable' },
    });
    await expect(pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).resolves.toEqual({
      status: 200,
      body: { token: 'install-token' },
    });
  });

  it('allows only one concurrent claim to enter the token durability section', async () => {
    const durability = deferred();
    const ensureToken = vi.fn(() => 'install-token');
    const pairing = createCompanionPairing({
      confirmPairing: vi.fn(async () => true),
      ensureToken,
      flush: vi.fn(() => durability.promise),
    });
    await pairing.registerUrl(await pairUrl());

    const first = pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER });
    await vi.waitFor(() => expect(ensureToken).toHaveBeenCalledOnce());
    await expect(pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).resolves.toEqual({
      status: 425,
      body: { error: 'pairing approval is pending', code: 'pairing_pending' },
    });

    durability.resolve(true);
    await expect(first).resolves.toEqual({
      status: 200,
      body: { token: 'install-token' },
    });
    expect(ensureToken).toHaveBeenCalledOnce();
  });
});

 describe('loopback pairing requests', () => {
  const clientId = CLIENT_ID;
  async function request(overrides = {}) {
    return { protocolVersion: '2', requestId: REQUEST_ID, challenge: await challengeFor(VERIFIER), clientId, ...overrides };
  }

  it('starts one native approval, exposes no token, and requires matching proof after approval', async () => {
    const approval = deferred();
    const confirmPairing = vi.fn(() => approval.promise);
    const ensureToken = vi.fn(() => 'install-token');
    const pairing = createCompanionPairing({ confirmPairing, ensureToken });
    const input = await request();
    expect(pairing.request(input)).toEqual({ status: 202, body: { pending: true } });
    expect(pairing.request(input)).toEqual({ status: 202, body: { pending: true } });
    expect(confirmPairing).toHaveBeenCalledOnce();
    expect(ensureToken).not.toHaveBeenCalled();
    expect(await pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).toMatchObject({ status: 425 });
    approval.resolve(true);
    await Promise.resolve();
    expect(await pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER + 'wrong' })).toMatchObject({ status: 404 });
    expect(await pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).toMatchObject({ status: 200, body: { token: 'install-token' } });
  });

  it('rejects malformed requests and bounds both pending prompts and repeated new attempts', async () => {
    let now = 0;
    const approval = deferred();
    const confirmPairing = vi.fn(() => approval.promise);
    const pairing = createCompanionPairing({ now: () => now, confirmPairing });
    for (const changes of [{ requestId: '' }, { challenge: 'bad' }, { clientId: 'site.example' }, { protocolVersion: '1' }]) {
      expect(pairing.request(await request(changes))).toMatchObject({ status: 400 });
    }
    expect(confirmPairing).not.toHaveBeenCalled();
    expect(pairing.request(await request())).toMatchObject({ status: 202 });
    now = 10000;
    expect(pairing.request(await request({ requestId: 'differentrequestid12345' }))).toMatchObject({ status: 429 });
    approval.resolve(false);
    await Promise.resolve();
    expect(await pairing.claim({ clientId: CLIENT_ID, requestId: REQUEST_ID, verifier: VERIFIER })).toMatchObject({ status: 403 });
    expect(pairing.request(await request({ requestId: 'differentrequestid12345' }))).toMatchObject({ status: 202 });
    await Promise.resolve();
    expect(pairing.request(await request({ requestId: 'anotherrequestid1234567' }))).toMatchObject({ status: 429 });
  });
});
