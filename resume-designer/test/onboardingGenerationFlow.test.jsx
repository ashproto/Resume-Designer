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
import { getAllJobDescriptions, initJobDescriptions } from '../src/jobDescriptions.js';
import { generateResumeForJob } from '../src/onboardingLogic.js';
import { appStorage } from '../src/appStorage.js';

beforeEach(() => {
  localStorage.clear();
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
  it('freezes the reviewed draft after a failed disk save and retries the same resume', async () => {
    vi.spyOn(appStorage, 'flush').mockResolvedValueOnce(false).mockResolvedValue(true);
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume: original, gaps: [] })
      .mockResolvedValueOnce({ resume: { ...original, summary: 'Reviewed draft' }, gaps: [] });
    await openGeneration();
    fireEvent.click(screen.getByRole('tab', { name: 'Write a prompt' }));
    fireEvent.change(screen.getByLabelText('What should this resume focus on?'), { target: { value: 'Design products.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review your resume' }));
    fireEvent.change(screen.getByLabelText('Changes to the whole resume'), { target: { value: 'Be concise.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revise resume' }));
    await screen.findByText('Reviewed draft');
    fireEvent.click(screen.getByRole('button', { name: 'Create resume' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create resume' }).disabled).toBe(false));
    const savedIds = Object.keys(getVariants());
    expect(savedIds).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Revise resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo last revision' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Retry Create resume');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Reviewed draft')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create resume' }));
    await screen.findByRole('heading', { name: 'Your resume is ready' });
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
    await screen.findByRole('button', { name: 'Review your resume' });
    expect(generateResumeFromProfileForJob.mock.calls[0]).toEqual([
      expect.any(String), null, expect.objectContaining({ prompt: 'A product design career change.', targetPages: 2, jobDescriptions: [] }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Review your resume' }));
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('2');
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' });
    fireEvent.change(screen.getByLabelText('Changes to the whole resume'), { target: { value: 'Emphasize research.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revise resume' }));
    await screen.findByText('Revised draft');
    expect(generateResumeFromProfileForJob.mock.calls[1][2]).toMatchObject({ previousResume: original, prompt: 'A product design career change.', targetPages: 1, revisionInstruction: 'Emphasize research.' });
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Undo last revision' }));
    expect(screen.getByText('Initial draft')).toBeTruthy();
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Create resume' }));
    await screen.findByRole('heading', { name: 'Your resume is ready' });
    expect(Object.values(getVariants())).toEqual([expect.objectContaining({ name: 'Alex', data: expect.objectContaining({ summary: 'Initial draft' }) })]);
    expect(getAllJobDescriptions()).toEqual([]);
  });

  it('retains the previous draft and revision instructions when a revision fails', async () => {
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume: original, gaps: [] }).mockRejectedValueOnce(new Error('Network unavailable'));
    await openGeneration();
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'Design products.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review your resume' }));
    fireEvent.change(screen.getByLabelText('Changes to the whole resume'), { target: { value: 'Be more concise.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revise resume' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revise resume' }).disabled).toBe(false));
    expect(screen.getByText('Initial draft')).toBeTruthy();
    expect(screen.getByLabelText('Changes to the whole resume').value).toBe('Be more concise.');
    expect(screen.getByRole('button', { name: 'Create resume' }).disabled).toBe(false);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Review your resume' }));
    fireEvent.change(screen.getByLabelText('Changes to the whole resume'), { target: { value: 'Make the wording clearer.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revise resume' }));
    await screen.findByText('Revised draft');
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    fireEvent.change(screen.getByLabelText('Changes to the whole resume'), { target: { value: 'More detail about research.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revise resume' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel revision' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revise resume' }).disabled).toBe(false));
    expect(screen.getByText('Revised draft')).toBeTruthy();
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('2');
    expect(screen.getByLabelText('Changes to the whole resume').value).toBe('More detail about research.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo last revision' }));
    expect(screen.getByText('Initial draft')).toBeTruthy();
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('1');
  });

  it('rejects a malformed revision before replacing the usable draft', async () => {
    generateResumeFromProfileForJob.mockResolvedValueOnce({ resume: original, gaps: [] })
      .mockResolvedValueOnce({ resume: { name: 'Broken draft', skills: ['Research', { name: 'Design' }] }, gaps: [] });
    await openGeneration();
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'Design products.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review your resume' }));
    fireEvent.change(screen.getByLabelText('Changes to the whole resume'), { target: { value: 'Include relevant skills.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revise resume' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revise resume' }).disabled).toBe(false));
    expect(screen.getByText('Initial draft')).toBeTruthy();
    expect(screen.queryByText('Broken draft')).toBeNull();
    expect(screen.getByLabelText('Changes to the whole resume').value).toBe('Include relevant skills.');
  });
});
