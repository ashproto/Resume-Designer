import { describe, it, expect, vi } from 'vitest';
import { createBridgeRouter } from '../src/bridgeRoutes.js';

const VARIANTS = {
  'v-1': { id: 'v-1', name: 'Backend Resume', data: { name: 'Ash' }, updatedAt: '2026-07-01T00:00:00.000Z' },
  'v-2': { id: 'v-2', name: 'Frontend Resume', data: { name: 'Ash' }, updatedAt: '2026-07-10T00:00:00.000Z' },
};

function makeDeps(overrides = {}) {
  return {
    version: '1.0.0',
    getToken: () => 'tok-123',
    profileId: 'profile-1',
    profileContextId: 'context-1',
    getVariants: () => VARIANTS,
    getUserProfile: () => ({ markdown: '# Ash' }),
    getLearnedAnswers: () => [{ id: 'ans-1', question: 'Notice period?', answer: '4 weeks' }],
    addApplication: vi.fn((fields) => ({ id: 'app-1', ...fields })),
    saveLearnedAnswer: vi.fn((q, a) => ({ id: 'ans-2', question: q, answer: a })),
    flush: async () => true,
    complete: vi.fn(async () => 'ai says hi'),
    getAiModels: vi.fn(() => ({ models: [{ id: 'vendor/chosen', name: 'Chosen model' }], defaults: { mapping: 'vendor/chosen', analysis: 'vendor/chosen', tailoring: 'vendor/chosen' }, autoFallback: false })),
    claimPairing: vi.fn(async () => ({ status: 200, body: { token: 'tok-123' } })),
    analyzeJobFit: vi.fn(async ({ resumeId }) => ({
      resumeId,
      analysis: {
        matchScore: 80,
        keywordMatches: ['JavaScript'],
        missingKeywords: [],
        evidence: [],
        strengths: ['Relevant experience'],
        gaps: [],
        recommendations: [],
      },
    })),
    createTailoredResume: vi.fn(async () => ({
      created: true,
      resume: {
        id: 'companion-550e8400-e29b-41d4-a716-446655440000',
        name: 'Staff Engineer — Acme',
        updatedAt: '2026-07-17T20:00:00.000Z',
      },
    })),
    exportVariantPdf: vi.fn(async () => 'JVBERi0base64=='),
    writesSuspended: vi.fn(() => false),
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

const AUTH = 'Bearer tok-123';
const route = (deps, req) => createBridgeRouter(deps)(req);

describe('auth', () => {
  it('health needs no token', async () => {
    const res = await route(makeDeps(), { method: 'GET', path: '/health', authorization: '', body: '' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      app: 'resume-designer',
      version: '1.0.0',
      protocolVersion: 2,
      capabilities: expect.arrayContaining([
        'app.launch',
        'pairing.challenge',
        'ai.job-fit',
        'ai.tailored-resume',
      ]),
    });
  });

  it('allows a one-time pairing claim without a bearer token and preserves its status', async () => {
    const deps = makeDeps({
      claimPairing: vi.fn(async () => ({
        status: 425,
        body: { error: 'pairing approval is pending', code: 'pairing_pending' },
      })),
    });
    const body = JSON.stringify({ requestId: 'request-id', verifier: 'verifier' });
    const res = await route(deps, {
      method: 'POST', path: '/pairing/claim', authorization: '', body,
    });

    expect(res).toEqual({
      status: 425,
      body: { error: 'pairing approval is pending', code: 'pairing_pending' },
    });
    expect(deps.claimPairing).toHaveBeenCalledWith({ requestId: 'request-id', verifier: 'verifier' });
  });
  it('rejects a missing or wrong token with 401', async () => {
    for (const authorization of ['', 'Bearer wrong', 'tok-123']) {
      const res = await route(makeDeps(), { method: 'GET', path: '/resumes', authorization, body: '' });
      expect(res.status).toBe(401);
    }
  });
  it('rejects everything when no token is provisioned yet', async () => {
    const res = await route(makeDeps({ getToken: () => '' }), { method: 'GET', path: '/resumes', authorization: 'Bearer ', body: '' });
    expect(res.status).toBe(401);
  });
});

describe('POST /pairing/revoke', () => {
  it('requires the current bearer token before revoking', async () => {
    const deps = makeDeps({ revokePairing: vi.fn() });
    for (const authorization of ['', 'Bearer wrong']) {
      expect(await route(deps, { method: 'POST', path: '/pairing/revoke', authorization, body: '{}' }))
        .toMatchObject({ status: 401 });
    }
    expect(deps.revokePairing).not.toHaveBeenCalled();
  });

  it('waits for durable rotation then rejects the old bearer token', async () => {
    let token = 'tok-123';
    const durability = deferred();
    const deps = makeDeps({
      getToken: () => token,
      revokePairing: vi.fn(async () => {
        await durability.promise;
        token = 'new-token';
      }),
    });
    const handle = createBridgeRouter(deps);
    let settled = false;
    const operation = handle({ method: 'POST', path: '/pairing/revoke', authorization: AUTH, body: '{}' })
      .then((result) => { settled = true; return result; });
    await Promise.resolve();
    expect(settled).toBe(false);
    durability.resolve();
    expect(await operation).toEqual({ status: 200, body: { ok: true } });
    expect(await handle({ method: 'GET', path: '/resumes', authorization: AUTH }))
      .toMatchObject({ status: 401 });
  });

  it('reports durable-storage failure without claiming disconnection', async () => {
    const deps = makeDeps({
      revokePairing: vi.fn(async () => {
        throw Object.assign(new Error('Could not save disconnection. Try again.'), {
          status: 503, code: 'pairing_unavailable',
        });
      }),
    });
    expect(await route(deps, { method: 'POST', path: '/pairing/revoke', authorization: AUTH, body: '{}' }))
      .toEqual({ status: 503, body: { error: 'Could not save disconnection. Try again.', code: 'pairing_unavailable' } });
  });
});

describe('GET /resumes', () => {
  it('lists id/name/updatedAt, newest first, no resume data', async () => {
    const res = await route(makeDeps(), { method: 'GET', path: '/resumes', authorization: AUTH, body: '' });
    expect(res.status).toBe(200);
    expect(res.body.profileId).toBe('profile-1');
    expect(res.body.profileContextId).toBe('context-1');
    expect(res.body.resumes).toEqual([
      { id: 'v-2', name: 'Frontend Resume', updatedAt: '2026-07-10T00:00:00.000Z' },
      { id: 'v-1', name: 'Backend Resume', updatedAt: '2026-07-01T00:00:00.000Z' },
    ]);
  });
});

describe('GET /resumes/:id', () => {
  it('returns data, profile, and learned answers', async () => {
    const res = await route(makeDeps(), { method: 'GET', path: '/resumes/v-1', authorization: AUTH, body: '' });
    expect(res.status).toBe(200);
    expect(res.body.profileId).toBe('profile-1');
    expect(res.body.profileContextId).toBe('context-1');
    expect(res.body.id).toBe('v-1');
    expect(res.body.data).toEqual({ name: 'Ash' });
    expect(res.body.profile).toEqual({ markdown: '# Ash' });
    expect(res.body.learnedAnswers).toHaveLength(1);
  });
  it('404s an unknown id', async () => {
    const res = await route(makeDeps(), { method: 'GET', path: '/resumes/nope', authorization: AUTH, body: '' });
    expect(res.status).toBe(404);
  });
});

describe('GET /resumes/:id/pdf', () => {
  it('returns base64 and a filename derived from the variant name', async () => {
    const deps = makeDeps();
    const res = await route(deps, { method: 'GET', path: '/resumes/v-1/pdf', authorization: AUTH, body: '' });
    expect(res.status).toBe(200);
    expect(deps.exportVariantPdf).toHaveBeenCalledWith('v-1');
    expect(res.body).toEqual({
      profileId: 'profile-1',
      profileContextId: 'context-1',
      filename: 'Backend-Resume.pdf',
      pdfBase64: 'JVBERi0base64==',
    });
  });
  it('404s an unknown id without exporting', async () => {
    const deps = makeDeps();
    const res = await route(deps, { method: 'GET', path: '/resumes/nope/pdf', authorization: AUTH, body: '' });
    expect(res.status).toBe(404);
    expect(deps.exportVariantPdf).not.toHaveBeenCalled();
  });
  it('maps an export failure to 500 with the message', async () => {
    const deps = makeDeps({ exportVariantPdf: vi.fn(async () => { throw new Error('another PDF export is in progress'); }) });
    const res = await route(deps, { method: 'GET', path: '/resumes/v-1/pdf', authorization: AUTH, body: '' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/in progress/);
  });
});

describe('POST /ai/complete', () => {
  const MSGS = [{ role: 'user', content: 'map these fields' }];
  it('delegates messages and options to complete()', async () => {
    const deps = makeDeps();
    const res = await route(deps, {
      method: 'POST', path: '/ai/complete', authorization: AUTH,
      body: JSON.stringify({
        profileContextId: 'context-1',
        messages: MSGS,
        systemPrompt: 'sys',
        reasoningEffort: 'low',
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: 'ai says hi' });
    expect(deps.complete).toHaveBeenCalledWith(MSGS, { systemPrompt: 'sys', reasoningEffort: 'low' });
  });
  it('400s invalid JSON and invalid messages', async () => {
    const bad = [
      'not json',
      JSON.stringify({ profileContextId: 'context-1' }),
      JSON.stringify({ profileContextId: 'context-1', messages: [] }),
      JSON.stringify({ profileContextId: 'context-1', messages: [{ role: 'user' }] }),
    ];
    for (const body of bad) {
      const res = await route(makeDeps(), { method: 'POST', path: '/ai/complete', authorization: AUTH, body });
      expect(res.status).toBe(400);
    }
  });
  it('maps an upstream AI failure to 502', async () => {
    const deps = makeDeps({ complete: vi.fn(async () => { throw new Error('rate limited'); }) });
    const res = await route(deps, {
      method: 'POST', path: '/ai/complete', authorization: AUTH,
      body: JSON.stringify({ profileContextId: 'context-1', messages: MSGS }),
    });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/rate limited/);
  });

  it.each([undefined, 'context-old'])('409s context %s before invoking AI', async (profileContextId) => {
    const deps = makeDeps();
    const res = await route(deps, {
      method: 'POST', path: '/ai/complete', authorization: AUTH,
      body: JSON.stringify({ profileContextId, messages: MSGS }),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('profile_changed');
    expect(deps.complete).not.toHaveBeenCalled();
  });
});

describe('purpose-specific companion AI routes', () => {
  const job = {
    title: 'Staff Engineer',
    company: 'Acme',
    description: 'Build accessible products.',
    url: 'https://jobs.example.test/staff-engineer',
  };

  it('POST /ai/job-fit delegates selected-resume analysis and labels the response context', async () => {
    const deps = makeDeps();
    const res = await route(deps, {
      method: 'POST', path: '/ai/job-fit', authorization: AUTH,
      body: JSON.stringify({ profileContextId: 'context-1', resumeId: 'v-2', job }),
    });

    expect(res).toEqual({
      status: 200,
      body: {
        profileId: 'profile-1',
        profileContextId: 'context-1',
        resumeId: 'v-2',
        analysis: expect.objectContaining({ matchScore: 80 }),
      },
    });
    expect(deps.analyzeJobFit).toHaveBeenCalledWith({ resumeId: 'v-2', job });
  });

  it('POST /ai/tailored-resume returns 201 for creation and 200 for an idempotent replay', async () => {
    const request = {
      method: 'POST', path: '/ai/tailored-resume', authorization: AUTH,
      body: JSON.stringify({
        profileContextId: 'context-1',
        resumeId: 'v-1',
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        job,
      }),
    };
    const deps = makeDeps();

    let res = await route(deps, request);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      profileId: 'profile-1',
      profileContextId: 'context-1',
      created: true,
      resume: expect.objectContaining({ id: expect.stringMatching(/^companion-/) }),
    });

    deps.createTailoredResume.mockResolvedValueOnce({
      created: false,
      resume: res.body.resume,
    });
    res = await route(deps, request);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(deps.createTailoredResume).toHaveBeenLastCalledWith({
      resumeId: 'v-1',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      job,
    }, { assertAuthorized: expect.any(Function) });
  });

  it.each(['/ai/job-fit', '/ai/tailored-resume'])('409s stale context before %s work', async (path) => {
    const deps = makeDeps();
    const res = await route(deps, {
      method: 'POST', path, authorization: AUTH,
      body: JSON.stringify({
        profileContextId: 'context-old', resumeId: 'v-1',
        requestId: '550e8400-e29b-41d4-a716-446655440000', job,
      }),
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('profile_changed');
    expect(deps.analyzeJobFit).not.toHaveBeenCalled();
    expect(deps.createTailoredResume).not.toHaveBeenCalled();
  });

  it('preserves typed validation, AI, and persistence errors from job actions', async () => {
    const failures = [
      ['/ai/job-fit', 'analyzeJobFit', { status: 400, code: 'invalid_job', message: 'job description is required' }],
      ['/ai/job-fit', 'analyzeJobFit', { status: 502, code: 'invalid_ai_response', message: 'AI returned invalid analysis' }],
      ['/ai/tailored-resume', 'createTailoredResume', { status: 507, code: 'storage_full', message: 'Could not save resume' }],
    ];

    for (const [path, method, failure] of failures) {
      const error = Object.assign(new Error(failure.message), failure);
      const deps = makeDeps({ [method]: vi.fn(async () => { throw error; }) });
      const res = await route(deps, {
        method: 'POST', path, authorization: AUTH,
        body: JSON.stringify({
          profileContextId: 'context-1', resumeId: 'v-1',
          requestId: '550e8400-e29b-41d4-a716-446655440000', job,
        }),
      });
      expect(res).toEqual({
        status: failure.status,
        body: { error: failure.message, code: failure.code },
      });
    }
  });
});

describe('POST body shape', () => {
  it.each([null, [], 'text', 42])('400s non-object JSON %j on every POST route', async (value) => {
    for (const path of [
      '/ai/complete',
      '/ai/job-fit',
      '/ai/tailored-resume',
      '/applications',
      '/profile/answers',
    ]) {
      const res = await route(makeDeps(), {
        method: 'POST', path, authorization: AUTH, body: JSON.stringify(value),
      });
      expect(res).toEqual({ status: 400, body: { error: 'JSON body must be an object' } });
    }
  });
});

describe('POST /applications', () => {
  it('creates an applied record with a job snapshot', async () => {
    const deps = makeDeps();
    const res = await route(deps, {
      method: 'POST', path: '/applications', authorization: AUTH,
      body: JSON.stringify({ profileContextId: 'context-1', variantId: 'v-1', company: 'Acme', title: 'Staff Engineer', notes: 'via extension' }),
    });
    expect(res.status).toBe(201);
    expect(deps.addApplication).toHaveBeenCalledWith({
      variantId: 'v-1',
      variantName: 'Backend Resume',
      jobSnapshot: { title: 'Staff Engineer', company: 'Acme' },
      status: 'applied',
      notes: 'via extension',
    }, { throwOnFailure: true, registerRollback: expect.any(Function) });
    expect(res.body.application.id).toBe('app-1');
  });
  it('400s a missing variantId and 404s an unknown one', async () => {
    let res = await route(makeDeps(), { method: 'POST', path: '/applications', authorization: AUTH, body: JSON.stringify({ profileContextId: 'context-1', company: 'Acme' }) });
    expect(res.status).toBe(400);
    res = await route(makeDeps(), { method: 'POST', path: '/applications', authorization: AUTH, body: JSON.stringify({ profileContextId: 'context-1', variantId: 'nope' }) });
    expect(res.status).toBe(404);
  });
});

describe('prototype-key ids', () => {
  const PROTO_IDS = ['__proto__', 'constructor', 'hasOwnProperty'];
  it('404s GET /resumes/:id for inherited object keys', async () => {
    for (const id of PROTO_IDS) {
      const res = await route(makeDeps(), { method: 'GET', path: `/resumes/${id}`, authorization: AUTH, body: '' });
      expect(res.status).toBe(404);
    }
  });
  it('404s GET /resumes/:id/pdf for inherited object keys without exporting', async () => {
    for (const id of PROTO_IDS) {
      const deps = makeDeps();
      const res = await route(deps, { method: 'GET', path: `/resumes/${id}/pdf`, authorization: AUTH, body: '' });
      expect(res.status).toBe(404);
      expect(deps.exportVariantPdf).not.toHaveBeenCalled();
    }
  });
  it('404s POST /applications for inherited object keys', async () => {
    for (const id of PROTO_IDS) {
      const deps = makeDeps();
      const res = await route(deps, { method: 'POST', path: '/applications', authorization: AUTH, body: JSON.stringify({ profileContextId: 'context-1', variantId: id }) });
      expect(res.status).toBe(404);
      expect(deps.addApplication).not.toHaveBeenCalled();
    }
  });
});

describe('POST /profile/answers', () => {
  it('saves a q&a pair', async () => {
    const deps = makeDeps();
    const res = await route(deps, {
      method: 'POST', path: '/profile/answers', authorization: AUTH,
      body: JSON.stringify({ profileContextId: 'context-1', question: 'Notice period?', answer: '4 weeks' }),
    });
    expect(res.status).toBe(201);
    expect(deps.saveLearnedAnswer).toHaveBeenCalledWith('Notice period?', '4 weeks', {
      throwOnFailure: true, registerRollback: expect.any(Function),
    });
  });
  it('400s empty question or answer', async () => {
    for (const body of [
      JSON.stringify({ profileContextId: 'context-1', question: '', answer: 'x' }),
      JSON.stringify({ profileContextId: 'context-1', question: 'q', answer: '' }),
    ]) {
      const res = await route(makeDeps(), { method: 'POST', path: '/profile/answers', authorization: AUTH, body });
      expect(res.status).toBe(400);
    }
  });
});

describe('active profile write guard', () => {
  it.each([undefined, null, 'context-old'])('409s application writes for context %s', async (profileContextId) => {
    const deps = makeDeps();
    const res = await route(deps, {
      method: 'POST', path: '/applications', authorization: AUTH,
      body: JSON.stringify({ profileContextId, variantId: 'v-1', company: 'Acme' }),
    });
    expect(res).toEqual({
      status: 409,
      body: {
        error: 'profile context changed; refresh the companion extension',
        code: 'profile_changed',
      },
    });
    expect(deps.addApplication).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'context-old'])('409s learned-answer writes for context %s', async (profileContextId) => {
    const deps = makeDeps();
    const res = await route(deps, {
      method: 'POST', path: '/profile/answers', authorization: AUTH,
      body: JSON.stringify({ profileContextId, question: 'Notice period?', answer: '4 weeks' }),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('profile_changed');
    expect(deps.saveLearnedAnswer).not.toHaveBeenCalled();
  });

  it('fails closed when both request and boot contexts are null', async () => {
    const deps = makeDeps({ profileContextId: null });
    const res = await route(deps, {
      method: 'POST', path: '/applications', authorization: AUTH,
      body: JSON.stringify({ profileContextId: null, variantId: 'v-1' }),
    });
    expect(res.status).toBe(409);
    expect(deps.addApplication).not.toHaveBeenCalled();
  });
});

describe('write suspension during a destructive import', () => {
  it('503s POST /applications while writes are suspended, without persisting', async () => {
    const deps = makeDeps({ writesSuspended: () => true });
    const res = await route(deps, {
      method: 'POST', path: '/applications', authorization: AUTH,
      body: JSON.stringify({ profileContextId: 'context-1', variantId: 'v-1', company: 'Acme' }),
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('profile_changed');
    expect(deps.addApplication).not.toHaveBeenCalled();
  });
  it('503s POST /profile/answers while writes are suspended, without persisting', async () => {
    const deps = makeDeps({ writesSuspended: () => true });
    const res = await route(deps, {
      method: 'POST', path: '/profile/answers', authorization: AUTH,
      body: JSON.stringify({ profileContextId: 'context-1', question: 'Notice period?', answer: '4 weeks' }),
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('profile_changed');
    expect(deps.saveLearnedAnswer).not.toHaveBeenCalled();
  });
  it('503s profile-dependent reads and AI while suspended but keeps health available', async () => {
    const deps = makeDeps({ writesSuspended: () => true });
    const requests = [
      { method: 'GET', path: '/resumes', authorization: AUTH, body: '' },
      { method: 'GET', path: '/resumes/v-1', authorization: AUTH, body: '' },
      { method: 'GET', path: '/resumes/v-1/pdf', authorization: AUTH, body: '' },
      {
        method: 'POST', path: '/ai/complete', authorization: AUTH,
        body: JSON.stringify({
          profileContextId: 'context-1',
          messages: [{ role: 'user', content: 'map these fields' }],
        }),
      },
      {
        method: 'POST', path: '/ai/job-fit', authorization: AUTH,
        body: JSON.stringify({
          profileContextId: 'context-1', resumeId: 'v-1',
          job: { description: 'Build products' },
        }),
      },
      {
        method: 'POST', path: '/ai/tailored-resume', authorization: AUTH,
        body: JSON.stringify({
          profileContextId: 'context-1', resumeId: 'v-1',
          requestId: '550e8400-e29b-41d4-a716-446655440000',
          job: { description: 'Build products' },
        }),
      },
    ];

    for (const request of requests) {
      const res = await route(deps, request);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('profile_changed');
    }
    expect(deps.exportVariantPdf).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.analyzeJobFit).not.toHaveBeenCalled();
    expect(deps.createTailoredResume).not.toHaveBeenCalled();

    const health = await route(deps, {
      method: 'GET', path: '/health', authorization: '', body: '',
    });
    expect(health.status).toBe(200);
  });
  it('accepts writes once the flag clears', async () => {
    const deps = makeDeps({ writesSuspended: () => false });
    const res = await route(deps, {
      method: 'POST', path: '/applications', authorization: AUTH,
      body: JSON.stringify({ profileContextId: 'context-1', variantId: 'v-1', company: 'Acme' }),
    });
    expect(res.status).toBe(201);
    expect(deps.addApplication).toHaveBeenCalled();
  });

  it('discards asynchronous PDF and AI results when an import starts while they are running', async () => {
    const cases = [
      {
        path: '/resumes/v-1/pdf',
        method: 'GET',
        dep: 'exportVariantPdf',
        body: '',
        result: 'JVBERi0base64==',
      },
      {
        path: '/ai/complete',
        method: 'POST',
        dep: 'complete',
        body: JSON.stringify({
          profileContextId: 'context-1',
          messages: [{ role: 'user', content: 'map these fields' }],
        }),
        result: 'completion',
      },
      {
        path: '/ai/job-fit',
        method: 'POST',
        dep: 'analyzeJobFit',
        body: JSON.stringify({
          profileContextId: 'context-1', resumeId: 'v-1',
          job: { description: 'Build products' },
        }),
        result: { resumeId: 'v-1', analysis: { matchScore: 80 } },
      },
      {
        path: '/ai/tailored-resume',
        method: 'POST',
        dep: 'createTailoredResume',
        body: JSON.stringify({
          profileContextId: 'context-1', resumeId: 'v-1',
          requestId: '550e8400-e29b-41d4-a716-446655440000',
          job: { description: 'Build products' },
        }),
        result: { created: true, resume: { id: 'companion-result' } },
      },
    ];

    for (const testCase of cases) {
      let suspended = false;
      const operation = deferred();
      const dependency = vi.fn(() => operation.promise);
      const deps = makeDeps({
        writesSuspended: () => suspended,
        [testCase.dep]: dependency,
      });
      const response = route(deps, {
        method: testCase.method,
        path: testCase.path,
        authorization: AUTH,
        body: testCase.body,
      });
      await vi.waitFor(() => expect(dependency).toHaveBeenCalledOnce());
      suspended = true;
      operation.resolve(testCase.result);

      await expect(response).resolves.toEqual({
        status: 503,
        body: {
          error: 'a data import is in progress; retry after the app reloads',
          code: 'profile_changed',
        },
      });
    }
  });
});

describe('fallthrough', () => {
  it('404s unknown routes and wrong methods', async () => {
    for (const req of [
      { method: 'GET', path: '/nope', authorization: AUTH, body: '' },
      { method: 'POST', path: '/resumes', authorization: AUTH, body: '{}' },
      { method: 'DELETE', path: '/resumes/v-1', authorization: AUTH, body: '' },
    ]) {
      const res = await route(makeDeps(), req);
      expect(res.status).toBe(404);
    }
  });
});


describe('companion model selection', () => {
  it('requires pairing before exposing the model catalog and defaults', async () => {
    const deps = makeDeps();
    expect(await route(deps, { method: 'GET', path: '/ai/models', authorization: '' }))
      .toMatchObject({ status: 401 });
    expect(deps.getAiModels).not.toHaveBeenCalled();
    expect(await route(deps, { method: 'GET', path: '/ai/models', authorization: AUTH }))
      .toEqual({ status: 200, body: deps.getAiModels() });
  });

  it.each([
    ['/ai/complete', 'complete'], ['/ai/job-fit', 'analyzeJobFit'], ['/ai/tailored-resume', 'createTailoredResume'],
  ])('passes a selected model through %s', async (path, action) => {
    const deps = makeDeps();
    const body = { profileContextId: 'context-1', messages: [{ role: 'user', content: 'Draft an answer' }],
      resumeId: 'v-1', job: { description: 'Build products' }, model: 'vendor/chosen' };
    expect((await route(deps, { method: 'POST', path, authorization: AUTH, body: JSON.stringify(body) })).status)
      .toBe(path === '/ai/tailored-resume' ? 201 : 200);
    const args = deps[action].mock.calls[0];
    expect(action === 'complete' ? args[1] : args[0]).toMatchObject({ model: 'vendor/chosen' });
  });

  it.each(['/ai/complete', '/ai/job-fit', '/ai/tailored-resume'])('rejects invalid models before AI work on %s', async (path) => {
    const deps = makeDeps();
    for (const model of [null, {}, '', ' ', 'vendor/unknown', 'x'.repeat(257)]) {
      const res = await route(deps, { method: 'POST', path, authorization: AUTH,
        body: JSON.stringify({ profileContextId: 'context-1', messages: [{ role: 'user', content: 'Draft an answer' }], model }),
      });
      expect(res).toMatchObject({ status: 400, body: { code: 'invalid_model' } });
    }
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.analyzeJobFit).not.toHaveBeenCalled();
    expect(deps.createTailoredResume).not.toHaveBeenCalled();
  });
});


describe('POST /pairing/request', () => {
  it('starts approval without auth but never returns a token', async () => {
    const requestPairing = vi.fn(() => ({ status: 202, body: { pending: true } }));
    const input = { protocolVersion: '2', requestId: 'request', challenge: 'challenge', clientId: 'extension' };
    const response = await route(makeDeps({ requestPairing }), {
      method: 'POST', path: '/pairing/request', authorization: '', body: JSON.stringify(input),
    });
    expect(response).toEqual({ status: 202, body: { pending: true } });
    expect(requestPairing).toHaveBeenCalledWith(input);
  });

  it('rejects malformed requests and does not show approval during a destructive import', async () => {
    const requestPairing = vi.fn();
    for (const body of ['not-json', 'null', '[]', '3']) {
      expect(await route(makeDeps({ requestPairing }), { method: 'POST', path: '/pairing/request', body }))
        .toMatchObject({ status: 400 });
    }
    expect(await route(makeDeps({ requestPairing, writesSuspended: () => true }), {
      method: 'POST', path: '/pairing/request', body: '{}',
    })).toMatchObject({ status: 503 });
    expect(requestPairing).not.toHaveBeenCalled();
  });
});


describe('mutation authorization during durable revocation', () => {
  it.each([
    ['/applications', { variantId: 'v-1', company: 'Example' }, 'addApplication'],
    ['/profile/answers', { question: 'Notice period?', answer: 'Two weeks' }, 'saveLearnedAnswer'],
  ])('blocks %s until token rotation has finished', async (path, payload, writer) => {
    let token = 'tok-123';
    const durability = deferred();
    const deps = makeDeps({
      getToken: () => token,
      revokePairing: vi.fn(async () => { token = 'new-token'; await durability.promise; }),
    });
    const handle = createBridgeRouter(deps);
    const revoke = handle({ method: 'POST', path: '/pairing/revoke', authorization: AUTH, body: '{}' });
    const request = { method: 'POST', path, authorization: 'Bearer new-token',
      body: JSON.stringify({ profileContextId: 'context-1', ...payload }) };
    expect(await handle(request)).toMatchObject({ status: 401, body: { code: 'unauthorized' } });
    expect(deps[writer]).not.toHaveBeenCalled();
    durability.resolve();
    expect((await revoke).status).toBe(200);
    expect((await handle(request)).status).toBe(201);
    expect(deps[writer]).toHaveBeenCalledOnce();
  });
});
