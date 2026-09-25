import { describe, expect, it, vi } from 'vitest';
import { createBridgeRouter } from '../src/bridgeRoutes.js';

import {
  MAX_JOB_DESCRIPTION_BYTES,
  createCompanionJobActions,
} from '../src/companionJobActions.js';

const BASE_VARIANTS = {
  'resume-1': {
    id: 'resume-1',
    name: 'General Resume',
    updatedAt: '2026-07-01T00:00:00.000Z',
    data: {
      name: 'Ash',
      summary: 'General summary',
      contact: { email: 'ash@example.com' },
      experience: [{ title: 'Engineer', bullets: ['Built products'] }],
      sections: [{ title: 'Skills', content: ['JavaScript'] }],
    },
  },
  'resume-2': {
    id: 'resume-2',
    name: 'Product Resume',
    updatedAt: '2026-07-02T00:00:00.000Z',
    data: {
      name: 'Ash',
      summary: 'Product summary',
      contact: { email: 'ash@example.com' },
      experience: [{ title: 'Product Engineer', bullets: ['Led discovery'] }],
      sections: [{ title: 'Skills', content: ['Research'] }],
    },
  },
};

const JOB = {
  title: ' Staff Product Engineer ',
  company: ' Acme ',
  description: ' Build accessible products and lead cross-functional teams. ',
  url: ' https://jobs.example.test/staff-product-engineer ',
};

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';

function analysis(overrides = {}) {
  return {
    matchScore: 82,
    keywordMatches: ['product', 'accessibility'],
    missingKeywords: ['payments'],
    evidence: [{ requirement: 'Product leadership', resumeEvidence: 'Led discovery', assessment: 'match' }],
    strengths: ['Relevant product experience'],
    gaps: [{ area: 'Domain', issue: 'No payments work', suggestion: 'Add relevant evidence if accurate' }],
    recommendations: [{
      section: 'summary',
      current: 'Product summary',
      suggested: 'Staff product engineer summary',
      reason: 'Aligns the opening with the role',
      impact: 'high',
      impactReason: 'The target role is staff-level',
    }],
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function makeDeps(overrides = {}) {
  let variants = structuredClone(BASE_VARIANTS);
  return {
    getVariants: vi.fn(() => variants),
    getSettings: vi.fn(() => ({
      defaultModel: 'default/model',
      analysisModel: 'analysis/model',
      analysisReasoning: 'low',
      tailorModel: 'tailor/model',
      tailorReasoning: 'high',
    })),
    getDefaultModelId: vi.fn(() => 'fallback/model'),
    analyzeResumeDataAgainstJobs: vi.fn(async () => analysis()),
    generateResumeChangesForData: vi.fn(async () => ({
      changes: {
        summary: 'Tailored summary',
        'experience[0].bullets[1]': 'Led accessible product delivery',
        'contact.linkedin': 'https://linkedin.com/in/ash',
      },
      explanation: 'Tailored for Acme',
    })),
    generateUniqueVariantName: vi.fn((name) => name),
    writesSuspended: vi.fn(() => false),
    flush: vi.fn(async () => true),
    saveVariant: vi.fn((id, name, data, metadata = {}) => {
      variants = {
        ...variants,
        [id]: {
          id,
          name,
          data: structuredClone(data),
          ...structuredClone(metadata),
          createdAt: '2026-07-17T20:00:00.000Z',
          updatedAt: '2026-07-17T20:00:00.000Z',
        },
      };
      return true;
    }),
    loadVariant: vi.fn((id) => Object.hasOwn(variants, id)),
    ...overrides,
  };
}

describe('createCompanionJobActions analyzeJobFit', () => {
  it('analyzes the explicitly selected resume with app-owned model settings and normalized job text', async () => {
    const deps = makeDeps();
    const actions = createCompanionJobActions(deps);

    await expect(actions.analyzeJobFit({ resumeId: 'resume-2', job: JOB })).resolves.toEqual({
      resumeId: 'resume-2',
      analysis: analysis(),
    });

    expect(deps.analyzeResumeDataAgainstJobs).toHaveBeenCalledWith(
      'analysis/model',
      BASE_VARIANTS['resume-2'].data,
      [{
        title: 'Staff Product Engineer',
        company: 'Acme',
        description: 'Build accessible products and lead cross-functional teams.',
        url: 'https://jobs.example.test/staff-product-engineer',
      }],
      { reasoningEffort: 'low' },
    );
  });

  it('accepts the analysis shape produced by the existing app prompt without an evidence field', async () => {
    const withoutEvidence = analysis();
    delete withoutEvidence.evidence;
    const deps = makeDeps({
      analyzeResumeDataAgainstJobs: vi.fn(async () => withoutEvidence),
    });
    const actions = createCompanionJobActions(deps);

    await expect(actions.analyzeJobFit({ resumeId: 'resume-1', job: JOB })).resolves.toEqual({
      resumeId: 'resume-1',
      analysis: withoutEvidence,
    });
  });

  it('rejects missing, oversized, or unsafe job input before invoking AI', async () => {
    const deps = makeDeps();
    const actions = createCompanionJobActions(deps);
    const invalidJobs = [
      { ...JOB, description: '   ' },
      { ...JOB, description: 'é'.repeat(MAX_JOB_DESCRIPTION_BYTES) },
      { ...JOB, url: 'javascript:alert(1)' },
    ];

    for (const job of invalidJobs) {
      await expect(actions.analyzeJobFit({ resumeId: 'resume-1', job }))
        .rejects.toMatchObject({ status: expect.any(Number), code: 'invalid_job' });
    }
    expect(deps.analyzeResumeDataAgainstJobs).not.toHaveBeenCalled();
  });

  it('rejects unknown resume ids and malformed or oversized AI analysis', async () => {
    const deps = makeDeps({
      analyzeResumeDataAgainstJobs: vi.fn(async () => analysis({
        strengths: ['x'.repeat(8_001)],
      })),
    });
    const actions = createCompanionJobActions(deps);

    await expect(actions.analyzeJobFit({ resumeId: 'missing', job: JOB }))
      .rejects.toMatchObject({ status: 404, code: 'resume_not_found' });
    await expect(actions.analyzeJobFit({ resumeId: 'resume-1', job: JOB }))
      .rejects.toMatchObject({ status: 502, code: 'invalid_ai_response' });
  });
});

describe('createCompanionJobActions createTailoredResume', () => {
  it('creates and selects one new variant from safe generated changes without mutating the base', async () => {
    const deps = makeDeps();
    const actions = createCompanionJobActions(deps);

    await expect(actions.createTailoredResume({
      resumeId: 'resume-2', requestId: REQUEST_ID, job: JOB,
    })).resolves.toEqual({
      created: true,
      resume: {
        id: `companion-${REQUEST_ID}`,
        name: 'Staff Product Engineer — Acme',
        updatedAt: '2026-07-17T20:00:00.000Z',
      },
    });

    expect(deps.generateResumeChangesForData).toHaveBeenCalledWith(
      'tailor/model',
      BASE_VARIANTS['resume-2'].data,
      expect.stringMatching(/tailor.*resume/i),
      null,
      { jobDescriptions: [expect.objectContaining({ title: 'Staff Product Engineer', company: 'Acme' })] },
      'tailor',
      { reasoningEffort: 'high' },
    );
    expect(deps.saveVariant).toHaveBeenCalledWith(
      `companion-${REQUEST_ID}`,
      'Staff Product Engineer — Acme',
      expect.objectContaining({
        summary: 'Tailored summary',
        contact: expect.objectContaining({ linkedin: 'https://linkedin.com/in/ash' }),
        experience: [expect.objectContaining({
          bullets: ['Led discovery', 'Led accessible product delivery'],
        })],
      }),
      {
        companionRequest: {
          requestId: REQUEST_ID,
          fingerprint: expect.any(String),
        },
      },
    );
    expect(deps.loadVariant).toHaveBeenCalledWith(`companion-${REQUEST_ID}`);
    expect(deps.flush).toHaveBeenCalledOnce();
    expect(BASE_VARIANTS['resume-2'].data).toEqual(expect.objectContaining({ summary: 'Product summary' }));
  });

  it('clears structured dates when tailoring rewrites their displayed range', async () => {
    const deps = makeDeps({
      generateResumeChangesForData: vi.fn(async () => ({
        changes: { 'experience[0].dates': '2022 – Present' },
      })),
    });
    const base = deps.getVariants()['resume-1'].data;
    Object.assign(base.experience[0], { dates: '2020 – 2021', startDate: '2020-01', endDate: '2021-12' });

    await createCompanionJobActions(deps).createTailoredResume({
      resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB,
    });

    expect(deps.saveVariant.mock.calls[0][2].experience[0]).toMatchObject({
      dates: '2022 – Present', startDate: '', endDate: '',
    });
    expect(base.experience[0]).toMatchObject({ startDate: '2020-01', endDate: '2021-12' });
  });

  it('preserves structured dates when their display text is unchanged', async () => {
    const deps = makeDeps({
      generateResumeChangesForData: vi.fn(async () => ({
        changes: { 'experience[0].dates': '2020 – 2021' },
      })),
    });
    Object.assign(deps.getVariants()['resume-1'].data.experience[0], {
      dates: '2020 – 2021', startDate: '2020-01', endDate: '2021-12',
    });

    await createCompanionJobActions(deps).createTailoredResume({
      resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB,
    });

    expect(deps.saveVariant.mock.calls[0][2].experience[0]).toMatchObject({
      dates: '2020 – 2021', startDate: '2020-01', endDate: '2021-12',
    });
  });

  it('renames every role in a grouped employer without changing separate tenures', async () => {
    const deps = makeDeps({
      generateResumeChangesForData: vi.fn(async () => ({
        changes: { 'experience[0].company': 'New employer' },
      })),
    });
    const base = deps.getVariants()['resume-1'].data;
    base.experience = [
      { title: 'Lead', company: 'Acme', _groupId: 'tenure-1', bullets: [] },
      { title: 'Engineer', company: 'Acme', _groupId: 'tenure-1', bullets: [] },
      { title: 'Intern', company: 'Acme', _groupId: 'tenure-2', bullets: [] },
    ];

    await createCompanionJobActions(deps).createTailoredResume({
      resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB,
    });

    expect(deps.saveVariant.mock.calls[0][2].experience.map((entry) => entry.company))
      .toEqual(['New employer', 'New employer', 'Acme']);
    expect(base.experience.map((entry) => entry.company)).toEqual(['Acme', 'Acme', 'Acme']);
  });

  it('rejects malformed request ids, unsafe paths, and storage failures without selecting a variant', async () => {
    const unsafeDeps = makeDeps({
      generateResumeChangesForData: vi.fn(async () => ({
        changes: JSON.parse('{"__proto__.polluted":"yes"}'),
      })),
    });
    const unsafe = createCompanionJobActions(unsafeDeps);

    await expect(unsafe.createTailoredResume({
      resumeId: 'resume-1', requestId: 'not-a-uuid', job: JOB,
    })).rejects.toMatchObject({ status: 400, code: 'invalid_request_id' });
    await expect(unsafe.createTailoredResume({
      resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB,
    })).rejects.toMatchObject({ status: 502, code: 'invalid_ai_response' });
    expect(unsafeDeps.saveVariant).not.toHaveBeenCalled();
    expect(unsafeDeps.loadVariant).not.toHaveBeenCalled();
    expect({}.polluted).toBeUndefined();

    const storageDeps = makeDeps({ saveVariant: vi.fn(() => false) });
    await expect(createCompanionJobActions(storageDeps).createTailoredResume({
      resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB,
    })).rejects.toMatchObject({ status: 507, code: 'storage_full' });
    expect(storageDeps.loadVariant).not.toHaveBeenCalled();
  });

  it.each([
    { experience: 'corrupted' },
    { 'sections[0].id': 'replaced-id' },
    { 'sections[0].content': 'not-an-array' },
    { 'experience[0].bullets': 'not-an-array' },
    { 'contact.untrusted': 'unexpected field' },
  ])('rejects structurally unsafe resume changes: %j', async (changes) => {
    const deps = makeDeps({
      generateResumeChangesForData: vi.fn(async () => ({ changes })),
    });

    await expect(createCompanionJobActions(deps).createTailoredResume({
      resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB,
    })).rejects.toMatchObject({ status: 502, code: 'invalid_ai_response' });
    expect(deps.saveVariant).not.toHaveBeenCalled();
  });

  it('rechecks destructive-import suspension after generation and before persistence', async () => {
    let suspended = false;
    const generation = deferred();
    const deps = makeDeps({
      writesSuspended: vi.fn(() => suspended),
      generateResumeChangesForData: vi.fn(() => generation.promise),
    });
    const operation = createCompanionJobActions(deps).createTailoredResume({
      resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB,
    });
    await vi.waitFor(() => expect(deps.generateResumeChangesForData).toHaveBeenCalledOnce());
    suspended = true;
    generation.resolve({ changes: { summary: 'Would race a restore' } });

    await expect(operation).rejects.toMatchObject({ status: 503, code: 'profile_changed' });
    expect(deps.saveVariant).not.toHaveBeenCalled();
  });

  it('requires tailored resume creation and replay to be durable and loadable', async () => {
    const notDurable = makeDeps({ flush: vi.fn(async () => false) });
    await expect(createCompanionJobActions(notDurable).createTailoredResume({
      resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB,
    })).rejects.toMatchObject({ status: 507, code: 'storage_full' });

    const deps = makeDeps();
    const actions = createCompanionJobActions(deps);
    const request = { resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB };
    await actions.createTailoredResume(request);
    deps.loadVariant.mockReturnValue(false);
    await expect(actions.createTailoredResume(request))
      .rejects.toMatchObject({ status: 507, code: 'storage_full' });
  });

  it('deduplicates concurrent requests and replays an already-created deterministic variant', async () => {
    const generation = deferred();
    const deps = makeDeps({
      generateResumeChangesForData: vi.fn(() => generation.promise),
    });
    const actions = createCompanionJobActions(deps);
    const request = { resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB };

    const first = actions.createTailoredResume(request);
    const concurrent = actions.createTailoredResume(request);
    await vi.waitFor(() => expect(deps.generateResumeChangesForData).toHaveBeenCalledOnce());

    generation.resolve({ changes: { summary: 'Concurrent tailored summary' } });
    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      expect.objectContaining({ created: true }),
      expect.objectContaining({ created: true }),
    ]);
    expect(deps.saveVariant).toHaveBeenCalledOnce();
    expect(deps.loadVariant).toHaveBeenCalledOnce();

    await expect(actions.createTailoredResume(request)).resolves.toEqual({
      created: false,
      resume: {
        id: `companion-${REQUEST_ID}`,
        name: 'Staff Product Engineer — Acme',
        updatedAt: '2026-07-17T20:00:00.000Z',
      },
    });
    expect(deps.generateResumeChangesForData).toHaveBeenCalledOnce();
    expect(deps.saveVariant).toHaveBeenCalledOnce();
    expect(deps.loadVariant).toHaveBeenCalledTimes(2);
    expect(deps.flush).toHaveBeenCalledTimes(2);
  });

  it('rejects reuse of an idempotency key for a different resume or job payload', async () => {
    const deps = makeDeps();
    const actions = createCompanionJobActions(deps);
    await actions.createTailoredResume({
      resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB,
    });

    await expect(actions.createTailoredResume({
      resumeId: 'resume-2',
      requestId: REQUEST_ID,
      job: { ...JOB, company: 'Different Company' },
    })).rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' });
    expect(deps.generateResumeChangesForData).toHaveBeenCalledOnce();
  });
});


describe('request-specific companion models', () => {
  it('overrides each action model without altering app settings', async () => {
    const deps = makeDeps();
    const original = deps.getSettings();
    const actions = createCompanionJobActions(deps);
    await actions.analyzeJobFit({ resumeId: 'resume-1', job: JOB, model: 'vendor/selected' });
    await actions.createTailoredResume({ resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB, model: 'vendor/selected' });
    expect(deps.analyzeResumeDataAgainstJobs.mock.calls[0][0]).toBe('vendor/selected');
    expect(deps.generateResumeChangesForData.mock.calls[0][0]).toBe('vendor/selected');
    expect(deps.getSettings()).toEqual(original);
  });

  it('does not replay a tailored resume generated with a different explicit model', async () => {
    const deps = makeDeps();
    const actions = createCompanionJobActions(deps);
    const input = { resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB, model: 'vendor/first' };
    await actions.createTailoredResume(input);
    await expect(actions.createTailoredResume(input)).resolves.toMatchObject({ created: false });
    await expect(actions.createTailoredResume({ ...input, model: 'vendor/second' }))
      .rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' });
    expect(deps.generateResumeChangesForData).toHaveBeenCalledOnce();
  });
});


describe('revocation before tailored resume persistence', () => {
  function setup(overrides = {}) {
    let token = 'initial-token';
    const deps = makeDeps(overrides);
    const actions = createCompanionJobActions(deps);
    const routerDeps = {
      ...deps, ...actions, profileId: 'profile-1', profileContextId: 'context-1',
      getToken: () => token,
      revokePairing: vi.fn(async () => { token = 'rotated-token'; }),
    };
    const handle = createBridgeRouter(routerDeps);
    const request = (path, payload = {}, currentToken = token) => handle({
      method: 'POST', path, authorization: `Bearer ${currentToken}`,
      body: JSON.stringify({ profileContextId: 'context-1', ...payload }),
    });
    const tailor = () => request('/ai/tailored-resume', { resumeId: 'resume-1', requestId: REQUEST_ID, job: JOB });
    return { deps, routerDeps, request, tailor, rotate: () => { token = 'rotated-token'; } };
  }

  it.each([false, true])('rejects an authorized generation after revoke (rollback=%s), without saving or selecting', async (rollback) => {
    const generation = deferred();
    const fixture = setup({ generateResumeChangesForData: vi.fn(() => generation.promise) });
    if (rollback) fixture.routerDeps.revokePairing.mockImplementation(async () => {
      throw Object.assign(new Error('Revocation could not persist'), { status: 503 });
    });
    const operation = fixture.tailor();
    await vi.waitFor(() => expect(fixture.deps.generateResumeChangesForData).toHaveBeenCalledOnce());
    expect((await fixture.request('/pairing/revoke')).status).toBe(rollback ? 503 : 200);
    generation.resolve({ changes: { summary: 'Must not be saved after disconnect' } });
    expect(await operation).toMatchObject({ status: 401, body: { code: 'unauthorized' } });
    expect(fixture.deps.saveVariant).not.toHaveBeenCalled();
    expect(fixture.deps.loadVariant).not.toHaveBeenCalled();
    expect(fixture.deps.flush).not.toHaveBeenCalled();
  });

  it('revalidates the current token even if it changes outside the revoke route', async () => {
    const generation = deferred();
    const fixture = setup({ generateResumeChangesForData: vi.fn(() => generation.promise) });
    const operation = fixture.tailor();
    await vi.waitFor(() => expect(fixture.deps.generateResumeChangesForData).toHaveBeenCalledOnce());
    fixture.rotate();
    generation.resolve({ changes: { summary: 'Revoked' } });
    expect(await operation).toMatchObject({ status: 401 });
    expect(fixture.deps.saveVariant).not.toHaveBeenCalled();
  });

  it('lets a newly authorized retry replace revoked in-flight work without creating duplicates', async () => {
    const oldGeneration = deferred();
    const newGeneration = deferred();
    const generate = vi.fn().mockImplementationOnce(() => oldGeneration.promise)
      .mockImplementationOnce(() => newGeneration.promise);
    const fixture = setup({ generateResumeChangesForData: generate });
    const oldOperation = fixture.tailor();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    await fixture.request('/pairing/revoke');
    const newOperation = fixture.tailor();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    newGeneration.resolve({ changes: { summary: 'Authorized new session' } });
    expect(await newOperation).toMatchObject({ status: 201 });
    oldGeneration.resolve({ changes: { summary: 'Old revoked session' } });
    expect(await oldOperation).toMatchObject({ status: 401 });
    expect(fixture.deps.saveVariant).toHaveBeenCalledOnce();
    expect(fixture.deps.saveVariant.mock.calls[0][2].summary).toBe('Authorized new session');
    expect(await fixture.tailor()).toMatchObject({ status: 200, body: { created: false } });
    expect(fixture.deps.saveVariant).toHaveBeenCalledOnce();
  });

  it.each([false, true])('blocks revoke during asynchronous fingerprinting (existing variant=%s)', async (existing) => {
    const fixture = setup();
    if (existing) await fixture.tailor();
    fixture.deps.saveVariant.mockClear();
    fixture.deps.loadVariant.mockClear();
    const fingerprint = deferred();
    const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => fingerprint.promise);
    try {
      const operation = fixture.tailor();
      expect(digest).toHaveBeenCalledOnce();
      await fixture.request('/pairing/revoke');
      fingerprint.resolve(new ArrayBuffer(32));
      expect(await operation).toMatchObject({ status: 401 });
      expect(fixture.deps.saveVariant).not.toHaveBeenCalled();
      expect(fixture.deps.loadVariant).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
    }
  });

  it('preserves a committed mutation while durability completes, then replays without a second save', async () => {
    const durability = deferred();
    const fixture = setup({ flush: vi.fn(() => durability.promise) });
    const operation = fixture.tailor();
    await vi.waitFor(() => expect(fixture.deps.saveVariant).toHaveBeenCalledOnce());
    expect((await fixture.request('/pairing/revoke')).status).toBe(200);
    durability.resolve(true);
    expect(await operation).toMatchObject({ status: 201, body: { created: true } });
    expect(await fixture.tailor()).toMatchObject({ status: 200, body: { created: false } });
    expect(fixture.deps.saveVariant).toHaveBeenCalledOnce();
  });
});
