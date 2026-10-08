import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildGenerateResumePrompt } from '../src/aiService.js';
import { JobInputStep, ReviewStep } from '../src/components/onboarding/OnboardingSteps.jsx';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('resume generation brief', () => {
  const job = { title: 'Designer', company: 'Acme', description: 'Build design systems.' };

  it('defaults to a concise one-page draft with a concrete word budget', () => {
    const prompt = buildGenerateResumePrompt('Profile facts', job);
    expect(prompt).toContain('Target length: 1 page');
    expect(prompt).toContain('300–450 words');
    expect(prompt).toContain('Do not repeat');
  });

  it('accepts a prompt without a job description', () => {
    const prompt = buildGenerateResumePrompt('Profile facts', null, { prompt: 'Focus on a transition to product design.', targetPages: 2 });
    expect(prompt).toContain('Focus on a transition to product design.');
    expect(prompt).toContain('Target length: 2 pages');
    expect(prompt).toContain('No target job supplied');
  });

  it('balances every supplied target and grounds whole-resume revisions in the previous draft', () => {
    const prompt = buildGenerateResumePrompt('Profile facts', job, {
      jobDescriptions: [job, { title: 'Product designer', company: 'Beta', description: 'Research customers.' }],
      previousResume: { name: 'Ada', summary: 'Design systems specialist' },
      revisionInstruction: 'Make the whole resume more direct.',
    });
    expect(prompt).toContain('Build design systems.');
    expect(prompt).toContain('Research customers.');
    expect(prompt).toContain('shared requirements');
    expect(prompt).toContain('Design systems specialist');
    expect(prompt).toContain('Make the whole resume more direct.');
  });
});

describe('new resume UI', () => {
  const props = () => ({
    hasProfileData: true, availableModels: [{ id: 'test-model', label: 'Test model' }],
    defaultModel: 'test-model', defaultReasoning: 'medium',
    modelSupportsReasoning: () => true, fetchModelCatalog: async () => {},
    onGenerate: vi.fn(async () => {}), onReview: vi.fn(), onBack: vi.fn(), onOpenProfile: vi.fn(),
  });

  it('generates from instructions alone and passes the selected length', async () => {
    const p = props();
    render(<JobInputStep {...p} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Write a prompt' }));
    fireEvent.change(screen.getByLabelText('What should this resume focus on?'), { target: { value: 'Highlight my leadership experience.' } });
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalled());
    expect(p.onGenerate.mock.calls[0][0]).toMatchObject({ prompt: 'Highlight my leadership experience.', targetPages: 2, jobDescriptions: [] });
  });

  it('passes multiple job descriptions together', async () => {
    const p = props();
    render(<JobInputStep {...p} />);
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'Build design systems.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add another job' }));
    fireEvent.change(screen.getByLabelText('Job description 2'), { target: { value: 'Research customers.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate resume' }));
    await waitFor(() => expect(p.onGenerate).toHaveBeenCalled());
    expect(p.onGenerate.mock.calls[0][0].jobDescriptions.map((j) => j.description)).toEqual(['Build design systems.', 'Research customers.']);
  });

  it('keeps the draft visible and allows a whole-resume revision before saving', async () => {
    const onRevise = vi.fn(async () => {});
    render(<ReviewStep resume={{ name: 'Ada', summary: 'Original draft' }} onRevise={onRevise} onBack={() => {}} onCreate={() => {}} />);
    fireEvent.change(screen.getByLabelText('Changes to the whole resume'), { target: { value: 'Shorten the summary and every bullet.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revise resume' }));
    await waitFor(() => expect(onRevise).toHaveBeenCalled());
    expect(onRevise.mock.calls[0][0]).toMatchObject({ revisionInstruction: 'Shorten the summary and every bullet.', targetPages: 1 });
    expect(screen.getByText('Original draft')).toBeTruthy();
  });
});
