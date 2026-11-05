import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/resumeParser.js', () => ({ parseResumeText: vi.fn(), parseResumeFile: vi.fn() }));
vi.mock('../src/aiService.js', async (original) => ({
  ...await original(), generateResumeFromProfileForJob: vi.fn(),
  checkProfileHasData: () => true, fetchModelCatalog: async () => {},
}));
import OnboardingWizard from '../src/components/onboarding/OnboardingWizard.jsx';
import { generateResumeFromProfileForJob } from '../src/aiService.js';
import { buildOnboarding, initIOSShell, SHELL_HANDLER } from '../src/iosShell.js';
import { appStorage } from '../src/appStorage.js';
import { getVariants } from '../src/persistence.js';

let postMessage;
const snapshot = () => postMessage.mock.calls.map(([m]) => m).filter((m) => m.kind === 'snapshot').at(-1)?.onboarding;
const send = async (type, payload = {}) => act(async () => { await window.__opShell.commandAsync({ type, ...payload }); });
const resume = { name: 'Alex', email: 'alex@example.com', summary: 'Original draft', skills: ['Research'], education: [{ degree: 'BA Design', school: 'Example University', year: '2024' }], experience: [] };

beforeEach(() => {
  localStorage.clear();
  postMessage = vi.fn();
  globalThis.webkit = { messageHandlers: { [SHELL_HANDLER]: { postMessage } } };
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  initIOSShell({ subscribeVariants: vi.fn(), subscribeDocument: vi.fn(), getVariantsSnapshot: () => ({ currentId: null, list: [] }), getZoom: () => 1,
    getAppInfo: async () => ({ version: 'test' }), getSettings: () => ({}), getTheme: () => 'system', getDocument: () => null,
    getPendingChanges: () => [], getDesign: () => ({}), subscribeJobs: vi.fn(), subscribeApplications: vi.fn(), getJobs: () => ({ jobs: [] }) });
});
afterEach(() => { cleanup(); delete globalThis.webkit; vi.unstubAllGlobals(); vi.clearAllMocks(); vi.restoreAllMocks(); });

describe('iOS generation parity', () => {
  it('refuses native draft changes after a failed save and retries the existing resume', async () => {
    vi.spyOn(appStorage, 'flush').mockResolvedValueOnce(false).mockResolvedValue(true);
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume, gaps: [] })
      .mockResolvedValueOnce({ resume: { ...resume, summary: 'Reviewed draft' }, gaps: [] });
    render(<OnboardingWizard />);
    act(() => window.dispatchEvent(new CustomEvent('rd:open-onboarding', { detail: { skipApiKeyStep: true } })));
    await send('onboardingChoose', { mode: 'job' });
    const brief = { inputMode: 'prompt', prompt: 'Design leadership', targetPages: '1', model: 'test-model' };
    await send('onboardingGenerate', brief);
    await send('onboardingNext');
    await send('onboardingRevise', { revisionInstruction: 'Be concise', targetPages: '1' });
    await send('onboardingCreate');
    const savedIds = Object.keys(getVariants());
    expect(savedIds).toHaveLength(1);
    expect(snapshot()).toMatchObject({ step: 4, busy: '', canRevise: false, canUndoRevision: false });
    expect(snapshot().notice.text).toContain('Retry Create resume');
    await send('onboardingRevise', { revisionInstruction: 'Change the draft', targetPages: '3' });
    await send('onboardingUndoRevision');
    await send('onboardingBack');
    await send('onboardingEditBrief');
    await send('onboardingChoose', { mode: 'job' });
    await send('onboardingGenerate', brief);
    expect(snapshot().step).toBe(4);
    expect(snapshot().resume.groups.flatMap((g) => g.fields.map((f) => f.value))).toContain('Reviewed draft');
    expect(generateResumeFromProfileForJob).toHaveBeenCalledTimes(2);
    await send('onboardingCreate');
    expect(snapshot().step).toBe(5);
    expect(Object.keys(getVariants())).toEqual(savedIds);
    expect(Object.values(getVariants())[0].data.summary).toBe('Reviewed draft');
  });

  it('projects the brief, actual gap text, and revision controls with concise defaults', () => {
    const state = buildOnboarding({ hasProfileData: true, targetJob: { inputMode: 'prompt', prompt: 'Emphasize research', targetPages: 2, jobDescriptions: [] },
      canRevise: true, canUndoRevision: true, draftRevision: 3, revisionCompletions: 2, revision: { phase: 'revising', reasoning: 'Editing', done: false },
      jobGaps: [{ requirement: 'Research leadership', note: 'Add supporting experience.' }] });
    expect(state.generationBrief).toEqual({ inputMode: 'prompt', prompt: 'Emphasize research', targetPages: 2, jobDescriptions: [] });
    expect(state).toMatchObject({ hasProfileData: true, canRevise: true, canUndoRevision: true, draftRevision: 3, revisionCompletions: 2, revision: { reasoning: 'Editing' } });
    expect(state.jobGaps[0]).toContain('Research leadership');
    expect(buildOnboarding().generationBrief.targetPages).toBe(1);
  });

  it('runs native prompt generation, revision and undo through the real command bridge', async () => {
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume, gaps: [] })
      .mockResolvedValueOnce({ resume: { ...resume, summary: 'Revised draft' }, gaps: [] });
    render(<OnboardingWizard />);
    act(() => window.dispatchEvent(new CustomEvent('rd:open-onboarding', { detail: { skipApiKeyStep: true } })));
    await send('onboardingChoose', { mode: 'job' });
    await send('onboardingGenerate', { inputMode: 'prompt', prompt: 'Emphasize research', targetPages: '2', jobDescriptions: '[]', model: 'test-model', reasoning: 'low' });
    expect(generateResumeFromProfileForJob.mock.calls[0][2]).toMatchObject({ prompt: 'Emphasize research', targetPages: 2, jobDescriptions: [] });
    expect(snapshot().generating.done).toBe(true);
    await send('onboardingNext');
    expect(snapshot().canRevise).toBe(true);
    const text = snapshot().resume.groups.flatMap((g) => g.fields.map((f) => f.value));
    expect(text).toContain('alex@example.com');
    expect(text).toContain('BA Design - Example University - (2024)');
    expect(text).toContain('Research');
    await send('onboardingRevise', { revisionInstruction: 'Make it shorter', targetPages: '1' });
    expect(generateResumeFromProfileForJob.mock.calls[1][2]).toMatchObject({ previousResume: resume, revisionInstruction: 'Make it shorter', targetPages: 1 });
    expect(snapshot()).toMatchObject({ canUndoRevision: true, revisionCompletions: 1, generationBrief: { targetPages: 1 } });
    await send('onboardingUndoRevision');
    expect(snapshot()).toMatchObject({ canUndoRevision: false, generationBrief: { targetPages: 2 } });
    expect(snapshot().resume.groups.flatMap((g) => g.fields.map((f) => f.value))).toContain('Original draft');
  });

  it('preserves a native multi-job draft on back and allows cancellation without losing the resume', async () => {
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume, gaps: [] })
      .mockImplementationOnce((_model, _job, { signal, hooks }) => new Promise((_resolve, reject) => {
        hooks.onReasoning('Editing', 'Editing');
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      }));
    render(<OnboardingWizard />);
    act(() => window.dispatchEvent(new CustomEvent('rd:open-onboarding', { detail: { skipApiKeyStep: true } })));
    await send('onboardingChoose', { mode: 'job' });
    const jobs = [{ title: 'Designer', company: 'Acme', description: 'Research' }, { title: 'Design lead', company: 'Beta', description: 'Design systems' }];
    const brief = { inputMode: 'jobs', prompt: 'Be concise', targetPages: '1', jobDescriptions: JSON.stringify(jobs) };
    await send('onboardingBack', brief);
    await send('onboardingChoose', { mode: 'job' });
    expect(snapshot().generationBrief.jobDescriptions).toEqual(jobs);
    await send('onboardingGenerate', { ...brief, model: 'test-model' });
    expect(generateResumeFromProfileForJob.mock.calls[0][2].jobDescriptions).toEqual(jobs);
    await send('onboardingNext');
    act(() => { window.__opShell.command({ type: 'onboardingRevise', revisionInstruction: 'More detail', targetPages: '2' }); });
    await waitFor(() => expect(snapshot().revision?.reasoning).toBe('Editing'));
    await send('onboardingCancelRevision');
    await waitFor(() => expect(snapshot().revision).toBe(null));
    expect(snapshot().revisionCompletions).toBe(0);
    expect(snapshot().resume.groups.flatMap((g) => g.fields.map((f) => f.value))).toContain('Original draft');
  });

  it('keeps the last usable native draft and undo state after a malformed revision', async () => {
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume, gaps: [] })
      .mockResolvedValueOnce({ resume: { ...resume, summary: 'First revision' }, gaps: [] })
      .mockResolvedValueOnce({ resume: { ...resume, experience: [{ title: { invalid: true } }] }, gaps: [] });
    render(<OnboardingWizard />);
    act(() => window.dispatchEvent(new CustomEvent('rd:open-onboarding', { detail: { skipApiKeyStep: true } })));
    await send('onboardingChoose', { mode: 'job' });
    await send('onboardingGenerate', { inputMode: 'prompt', prompt: 'Design leadership', targetPages: '2', model: 'test-model' });
    await send('onboardingNext');
    await send('onboardingRevise', { revisionInstruction: 'Shorten it', targetPages: '1' });
    const revision = snapshot().draftRevision;
    await send('onboardingRevise', { revisionInstruction: 'Expand it', targetPages: '3' });
    expect(snapshot()).toMatchObject({ step: 4, revision: null, revisionCompletions: 1, draftRevision: revision,
      canUndoRevision: true, generationBrief: { targetPages: 1 }, notice: { kind: 'error' } });
    expect(snapshot().resume.groups.flatMap((g) => g.fields.map((f) => f.value))).toContain('First revision');
    await send('onboardingUndoRevision');
    expect(snapshot()).toMatchObject({ canUndoRevision: false, generationBrief: { targetPages: 2 } });
    expect(snapshot().draftRevision).toBeGreaterThan(revision);
    expect(snapshot().resume.groups.flatMap((g) => g.fields.map((f) => f.value))).toContain('Original draft');
  });

  it('ignores a cancelled revision that resolves after a new wizard opens', async () => {
    let resolveRevision;
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume, gaps: [] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRevision = resolve; }));
    render(<OnboardingWizard />);
    act(() => window.dispatchEvent(new CustomEvent('rd:open-onboarding', { detail: { skipApiKeyStep: true } })));
    await send('onboardingChoose', { mode: 'job' });
    await send('onboardingGenerate', { inputMode: 'prompt', prompt: 'Design leadership', model: 'test-model' });
    await send('onboardingNext');
    act(() => { window.__opShell.command({ type: 'onboardingRevise', revisionInstruction: 'Change everything', targetPages: '2' }); });
    await waitFor(() => expect(snapshot().revision).not.toBeNull());
    await send('onboardingCreate');
    await send('onboardingBack');
    expect(snapshot().step).toBe(4);
    act(() => window.dispatchEvent(new CustomEvent('rd:open-onboarding', { detail: { skipApiKeyStep: true } })));
    await act(async () => resolveRevision({ resume: { ...resume, summary: 'Stale revision' }, gaps: [] }));
    expect(snapshot()).toMatchObject({ step: 1, resume: null, revision: null, revisionCompletions: 0, draftRevision: 0, generating: null });
  });
});
