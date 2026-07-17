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
    complete: vi.fn(async () => 'ai says hi'),
    exportVariantPdf: vi.fn(async () => 'JVBERi0base64=='),
    ...overrides,
  };
}

const AUTH = 'Bearer tok-123';
const route = (deps, req) => createBridgeRouter(deps)(req);

describe('auth', () => {
  it('health needs no token', async () => {
    const res = await route(makeDeps(), { method: 'GET', path: '/health', authorization: '', body: '' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, app: 'resume-designer', version: '1.0.0' });
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

describe('POST body shape', () => {
  it.each([null, [], 'text', 42])('400s non-object JSON %j on every POST route', async (value) => {
    for (const path of ['/ai/complete', '/applications', '/profile/answers']) {
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
    });
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
    expect(deps.saveLearnedAnswer).toHaveBeenCalledWith('Notice period?', '4 weeks');
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
    ];

    for (const request of requests) {
      const res = await route(deps, request);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('profile_changed');
    }
    expect(deps.exportVariantPdf).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();

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
