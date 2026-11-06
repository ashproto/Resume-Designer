import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/resumeParser.js', () => ({ parseResumeText: vi.fn(), parseResumeFile: vi.fn() }));
vi.mock('../src/aiService.js', async (importOriginal) => ({
  ...await importOriginal(),
  generateResumeFromProfileForJob: vi.fn(),
  checkProfileHasData: () => true,
  fetchModelCatalog: async () => {},
}));

import OnboardingWizard from '../src/components/onboarding/OnboardingWizard.jsx';
import { generateResumeFromProfileForJob } from '../src/aiService.js';
import { getVariants } from '../src/persistence.js';
import { getAllJobDescriptions, initJobDescriptions, clearAllJobDescriptions } from '../src/jobDescriptions.js';
import { generateResumeForJob } from '../src/onboardingLogic.js';
import { appStorage } from '../src/appStorage.js';

beforeEach(() => {
  localStorage.clear();
  clearAllJobDescriptions();
  initJobDescriptions();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const original = { name: 'Alex', summary: 'Initial draft', experience: [], education: [] };

async function openGeneration() {
  render(<OnboardingWizard />);
  act(() => window.dispatchEvent(new CustomEvent('rd:open-onboarding', { detail: { skipApiKeyStep: true } })));
  fireEvent.click(screen.getByRole('button', { name: /Create from your profile/ }));
}

describe('whole-resume generation and revision lifecycle', () => {
  it('updates length and writing detail without requiring a typed correction', async () => {
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume: original, gaps: [], reviewNotes: 'Original assessment.' })
      .mockResolvedValueOnce({ resume: { ...original, summary: 'More context' }, gaps: [], reviewNotes: 'Updated assessment.' });
    await openGeneration();
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'Design products.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    await screen.findByRole('button', { name: 'Open in editor' });
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update draft' }).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('tab', { name: 'Detailed' }));
    expect(screen.getByRole('button', { name: 'Update draft' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Update draft' }));
    await screen.findByText('Updated assessment.');
    expect(generateResumeFromProfileForJob.mock.calls[1][2]).toMatchObject({ targetPages: 2, verbosity: 'detailed', corrections: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
    await waitFor(() => expect(Object.values(getVariants())).toHaveLength(1));
    expect(Object.values(getVariants())[0].data.generationReview).toMatchObject({ targetPages: 2, verbosity: 'detailed', corrections: [] });
  });
  it('shows an assessment without reasoning and drops an obsolete score after correction', async () => {
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume: original, gaps: [], reviewNotes: 'Team leadership is not evidenced.', score: 65 })
      .mockResolvedValueOnce({ resume: original, gaps: [], reviewNotes: 'Team leadership is now evidenced.' });
    await openGeneration();
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'Lead a team.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    await screen.findByText('Team leadership is not evidenced.');
    fireEvent.change(screen.getByLabelText('Corrections or changes'), { target: { value: 'I led five designers.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update draft' }));
    await screen.findByText('Team leadership is now evidenced.');
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
    await waitFor(() => expect(Object.values(getVariants())).toHaveLength(1));
    expect(Object.values(getVariants())[0].data.generationReview.score).toBeUndefined();
  });
  it('keeps feedback and corrections on the ready screen and saves them with the editor resume', async () => {
    generateResumeFromProfileForJob.mockImplementationOnce(async (_model, _job, { hooks }) => {
      hooks.onReasoning('Notes', 'Leadership experience is missing.');
      return { resume: original, gaps: [{ requirement: 'Leadership', severity: 'high', note: 'Add evidence.' }] };
    }).mockImplementationOnce(async (_model, _job, { hooks }) => {
      hooks.onReasoning('Notes', 'Leadership is now supported by your correction.');
      return { resume: { ...original, summary: 'Led five designers' }, gaps: [] };
    });
    await openGeneration();
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'Lead a design team.' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Detailed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    await screen.findByRole('heading', { name: 'Resume ready' });
    expect(screen.getByText('Leadership experience is missing.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Corrections or changes'), { target: { value: 'I led five designers.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update draft' }));
    await screen.findByText('Leadership is now supported by your correction.');
    expect(screen.queryByText('Leadership experience is missing.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
    await waitFor(() => expect(Object.values(getVariants())).toHaveLength(1));
    const saved = Object.values(getVariants())[0].data;
    expect(saved.summary).toBe('Led five designers');
    expect(saved.generationReview).toMatchObject({ notes: 'Leadership is now supported by your correction.', gaps: [], targetPages: 1, verbosity: 'detailed', corrections: ['I led five designers.'] });
    expect(screen.queryByRole('button', { name: 'Create resume' })).toBeNull();
    expect(generateResumeFromProfileForJob.mock.calls[1][2]).toMatchObject({ previousResume: original, verbosity: 'detailed', corrections: ['I led five designers.'] });
  });
  it('freezes the reviewed draft after a failed disk save and retries the same resume', async () => {
    vi.spyOn(appStorage, 'flush').mockResolvedValueOnce(false).mockResolvedValue(true);
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume: original, gaps: [] })
      .mockResolvedValueOnce({ resume: { ...original, summary: 'Reviewed draft' }, gaps: [] });
    await openGeneration();
    fireEvent.click(screen.getByRole('tab', { name: 'Write a prompt' }));
    fireEvent.change(screen.getByLabelText('What should this resume focus on?'), { target: { value: 'Design products.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    await screen.findByRole('button', { name: 'Open in editor' });
    fireEvent.change(screen.getByLabelText('Corrections or changes'), { target: { value: 'Be concise.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update draft' }));
    await waitFor(() => expect(screen.getByLabelText('Corrections or changes').value).toBe(''));
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open in editor' }).disabled).toBe(false));
    const savedIds = Object.keys(getVariants());
    expect(savedIds).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Update draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo last update' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Retry Open in editor');
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
    await waitFor(() => expect(document.getElementById('onboarding-overlay').classList.contains('show')).toBe(false));
    expect(Object.keys(getVariants())).toEqual(savedIds);
    expect(Object.values(getVariants())[0].data.summary).toBe('Reviewed draft');
    expect(generateResumeFromProfileForJob).toHaveBeenCalledTimes(2);
  });

  it('accepts flat contacts, structured education, and optional main sections without converting the draft', async () => {
    const resume = { ...original, email: 'alex@example.com', education: [{ degree: 'BA Design', school: 'Example University', year: 2024 }], sections: [{ id: 'projects', title: 'Projects', area: 'main', type: 'list', content: ['Research project'] }] };
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume, gaps: [] });
    const result = await generateResumeForJob('test-model', null, 'medium');
    expect(result.resume).toBe(resume);
    expect(result.resume.education[0].school).toBe('Example University');
  });

  it('keeps prompt and length across generation and revision, supports undo, and saves no phantom job', async () => {
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume: original, gaps: [] })
      .mockResolvedValueOnce({ resume: { ...original, summary: 'Revised draft' }, gaps: [] });
    await openGeneration();
    fireEvent.click(screen.getByRole('tab', { name: 'Write a prompt' }));
    fireEvent.change(screen.getByLabelText('What should this resume focus on?'), { target: { value: 'A product design career change.' } });
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    await screen.findByRole('button', { name: 'Open in editor' });
    expect(generateResumeFromProfileForJob.mock.calls[0]).toEqual([
      expect.any(String), null, expect.objectContaining({ prompt: 'A product design career change.', targetPages: 2, jobDescriptions: [] }),
    ]);
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('2');
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' });
    fireEvent.change(screen.getByLabelText('Corrections or changes'), { target: { value: 'Emphasize research.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update draft' }));
    await waitFor(() => expect(screen.getByLabelText('Corrections or changes').value).toBe(''));
    expect(generateResumeFromProfileForJob.mock.calls[1][2]).toMatchObject({ previousResume: original, prompt: 'A product design career change.', targetPages: 1, revisionInstruction: 'Emphasize research.' });
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Undo last update' }));
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
    await waitFor(() => expect(Object.values(getVariants())).toHaveLength(1));
    expect(Object.values(getVariants())).toEqual([expect.objectContaining({ name: 'Alex', data: expect.objectContaining({ summary: 'Initial draft' }) })]);
    expect(getAllJobDescriptions()).toEqual([]);
  });

  it('retains the previous draft and revision instructions when a revision fails', async () => {
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume: original, gaps: [] }).mockRejectedValueOnce(new Error('Network unavailable'));
    await openGeneration();
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'Design products.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    await screen.findByRole('button', { name: 'Open in editor' });
    fireEvent.change(screen.getByLabelText('Corrections or changes'), { target: { value: 'Be more concise.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update draft' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update draft' }).disabled).toBe(false));
    expect(screen.getByLabelText('Corrections or changes').value).toBe('Be more concise.');
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
    await waitFor(() => expect(Object.values(getVariants())).toHaveLength(1));
    expect(Object.values(getVariants())[0].data.summary).toBe('Initial draft');
  });

  it('retains the draft, new length, and instructions after cancelling a revision', async () => {
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume: original, gaps: [] })
      .mockResolvedValueOnce({ resume: { ...original, summary: 'Revised draft' }, gaps: [] })
      .mockImplementationOnce((_model, _job, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      }));
    await openGeneration();
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'Design products.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    await screen.findByRole('button', { name: 'Open in editor' });
    fireEvent.change(screen.getByLabelText('Corrections or changes'), { target: { value: 'Make the wording clearer.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update draft' }));
    await waitFor(() => expect(screen.getByLabelText('Corrections or changes').value).toBe(''));
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    fireEvent.change(screen.getByLabelText('Corrections or changes'), { target: { value: 'More detail about research.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel update' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update draft' }).disabled).toBe(false));
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('2');
    expect(screen.getByLabelText('Corrections or changes').value).toBe('More detail about research.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo last update' }));
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
    await waitFor(() => expect(Object.values(getVariants())).toHaveLength(1));
    expect(Object.values(getVariants())[0].data.summary).toBe('Initial draft');
  });

  it('rejects a malformed revision before replacing the usable draft', async () => {
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume: original, gaps: [] })
      .mockResolvedValueOnce({ resume: { name: 'Broken draft', skills: ['Research', { name: 'Design' }] }, gaps: [] });
    await openGeneration();
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'Design products.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    await screen.findByRole('button', { name: 'Open in editor' });
    fireEvent.change(screen.getByLabelText('Corrections or changes'), { target: { value: 'Include relevant skills.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update draft' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update draft' }).disabled).toBe(false));
    expect(screen.queryByText('Broken draft')).toBeNull();
    expect(screen.getByLabelText('Corrections or changes').value).toBe('Include relevant skills.');
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
    await waitFor(() => expect(Object.values(getVariants())).toHaveLength(1));
    expect(Object.values(getVariants())[0].data.summary).toBe('Initial draft');
  });
});
