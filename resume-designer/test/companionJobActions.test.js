import { describe, expect, it, vi } from 'vitest';

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
