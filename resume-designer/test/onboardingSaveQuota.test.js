import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// onboardingLogic statically imports resumeParser, whose pdfjs-dist import
// needs browser APIs (DOMMatrix) jsdom doesn't have. saveOnboardingResume
// never touches the parser, so stub the module out.
vi.mock('../src/resumeParser.js', () => ({
  parseResumeText: vi.fn(),
  parseResumeFile: vi.fn(),
}));

const { saveOnboardingResume } = await import('../src/onboardingLogic.js');
const { saveVariant, getVariants, getCurrentVariantId } = await import('../src/persistence.js');

// Regression test for the "generated resume never appears" bug: the wizard's
// save step used to fire saveVariant + loadVariant without checking either,
// so with localStorage at quota it advanced to the success screen while the
// old resume stayed on screen and the dropdown never gained the new entry.
// saveOnboardingResume must throw so the wizard can surface the failure.

const TARGET_JOB = {
  title: 'Platform Engineer',
  company: 'Acme Corp',
  description: 'Fabricated job description for the quota regression test.',
};

const PARSED_RESUME = {
  name: 'Jordan Sample',
  tagline: 'Platform Engineer',
  email: 'jordan@example.com',
  summary: 'Fictional summary.',
  skills: ['JavaScript'],
  experience: [{ title: 'Engineer', company: 'Acme', dates: '2020 - 2024', bullets: ['Did things'] }],
  education: [],
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveOnboardingResume persistence failure', () => {
  it('saves, loads, and selects the new variant when storage has room', () => {
    const id = saveOnboardingResume({
      parsedResume: PARSED_RESUME,
      mode: 'job',
      targetJob: TARGET_JOB,
      jobDescriptions: [TARGET_JOB],
    });

    expect(getVariants()[id].name).toMatch(/Platform Engineer - Acme Corp/);
    expect(getCurrentVariantId()).toBe(id);
  });

  it('throws (instead of claiming success) when the variant write hits quota', () => {
    // Mirror the real-world failure: existing data in storage, then quota.
    saveVariant('variant-old', 'Old Resume', { name: 'Old Person' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    expect(() =>
      saveOnboardingResume({
        parsedResume: PARSED_RESUME,
        mode: 'job',
        targetJob: TARGET_JOB,
        jobDescriptions: [TARGET_JOB],
      }),
    ).toThrow(/storage is full/i);

    // No phantom variant, and the previous selection is untouched.
    expect(Object.keys(getVariants())).toEqual(['variant-old']);
  });
});
