import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  chat, completeForBridge, getDefaultModelId, validateModelId,
} from '../src/aiService.js';
import { getCompanionModels } from '../src/companionModels.js';
import { getSettings, loadFromStorage, saveSettings } from '../src/persistence.js';
import { useChat } from '../src/components/chat/useChat.js';
import { revokeAIConsent, setAIConsentPresenter } from '../src/aiConsent.js';
import { __resetAppStorageForTests } from '../src/appStorage.js';

// The interview helper never parses files. pdf.js requires browser APIs absent
// in jsdom, so keep the real helper/AI service and replace only that dependency.
vi.mock('../src/resumeParser.js', () => ({
  parseResumeText: vi.fn(),
  parseResumeFile: vi.fn(),
}));
const { improveInterviewAnswer } = await import('../src/onboardingLogic.js');

function configureWithoutModel(settings = {}) {
  localStorage.setItem('resume-designer-data', JSON.stringify({
    variants: {},
    settings: { openrouterKey: 'synthetic-test-key', ...settings },
  }));
}

beforeEach(async () => {
  __resetAppStorageForTests();
  localStorage.clear();
  await revokeAIConsent();
  setAIConsentPresenter(async () => true);
});

afterEach(() => {
  cleanup();
  setAIConsentPresenter(null);
  vi.unstubAllGlobals();
  __resetAppStorageForTests();
  localStorage.clear();
});

describe('shared product model defaults', () => {
  it('initializes a new workspace with Opus 5.5 without persisting a preference', () => {
    expect(loadFromStorage().settings.defaultModel).toBe('anthropic/claude-opus-5.5');
    expect(getSettings().defaultModel).toBe('anthropic/claude-opus-5.5');
    expect(localStorage.getItem('resume-designer-data')).toBeNull();
  });

  it('resolves absent or invalid selections to Opus 5.5 only when AI is configured', () => {
    expect(getDefaultModelId()).toBeNull();
    configureWithoutModel();
    expect(getDefaultModelId()).toBe('anthropic/claude-opus-5.5');
    expect(validateModelId(undefined)).toBe('anthropic/claude-opus-5.5');
    expect(validateModelId('<invalid/model>')).toBe('anthropic/claude-opus-5.5');
  });

  it('offers the named Opus 5.5 model offline and uses it for every unconfigured Companion task', () => {
    const catalog = getCompanionModels();
    expect(catalog.models).toContainEqual({ id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5' });
    expect(catalog.defaults).toEqual({
      mapping: 'anthropic/claude-opus-5.5',
      analysis: 'anthropic/claude-opus-5.5',
      tailoring: 'anthropic/claude-opus-5.5',
    });
  });

  it('starts the shared desktop/iOS chat with Opus 5.5 when a saved blob has no model or API key', async () => {
    localStorage.setItem('resume-designer-data', JSON.stringify({ settings: {} }));
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ data: [] }) }));
    let hook;
    await act(async () => { hook = renderHook(() => useChat()); });
    const { result } = hook;
    expect(result.current.currentModel).toBe('anthropic/claude-opus-5.5');
    expect(result.current.configured).toBe(false);
  });

  it('returns chat to Opus 5.5 when its selected custom model is removed without an API key', async () => {
    saveSettings({ defaultModel: 'vendor/custom', customModels: ['vendor/custom'] });
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ data: [] }) }));
    let hook;
    await act(async () => { hook = renderHook(() => useChat()); });
    expect(hook.result.current.currentModel).toBe('vendor/custom');
    act(() => { hook.result.current.removeCustomModelEntry('vendor/custom'); });
    expect(hook.result.current.currentModel).toBe('anthropic/claude-opus-5.5');
    expect(getSettings().defaultModel).toBe('anthropic/claude-opus-5.5');
    expect(getSettings().customModels).toEqual([]);
  });

  it.each([
    ['chat', () => chat(undefined, [{ role: 'user', content: 'Improve my resume' }], false)],
    ['Companion', () => completeForBridge([{ role: 'user', content: 'Draft an answer' }], { reasoningEffort: 'none' })],
    ['onboarding', () => improveInterviewAnswer('What do you do?', 'Build products')],
  ])('sends Opus 5.5 for %s requests without a chosen model and retains the normal response budget', async (_name, request) => {
    configureWithoutModel();
    const fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetch);
    await expect(request()).rejects.toThrow('OpenRouter API error: 503');
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      model: 'anthropic/claude-opus-5.5', max_tokens: 8192,
    });
  });

  it('preserves saved global/task selections and legacy model mappings', () => {
    saveSettings({
      defaultModel: 'anthropic/claude-sonnet-4.6',
      analysisModel: 'openai/gpt-5.5',
      tailorModel: 'custom/my-model',
      onboardingModel: 'google/gemini-2.5-pro',
    });
    expect(getCompanionModels().defaults).toEqual({
      mapping: 'anthropic/claude-sonnet-4.6',
      analysis: 'openai/gpt-5.5',
      tailoring: 'custom/my-model',
    });
    expect(getSettings().onboardingModel).toBe('google/gemini-2.5-pro');
    expect(validateModelId('anthropic:claude-sonnet-4-5')).toBe('anthropic/claude-sonnet-4.6');
    expect(validateModelId('anthropic:claude-opus-4-5')).toBe('anthropic/claude-opus-4.8');
  });
});
