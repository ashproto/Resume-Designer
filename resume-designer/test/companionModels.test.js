import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCompanionModels } from '../src/companionModels.js';
import { completeForBridge } from '../src/aiService.js';
import { getSettings, saveApiKey, saveSettings } from '../src/persistence.js';
import { setAIConsentPresenter, revokeAIConsent } from '../src/aiConsent.js';
import { __resetAppStorageForTests } from '../src/appStorage.js';

const DEFAULT = 'anthropic/claude-sonnet-4.6';
const SELECTED = 'openai/gpt-5.5';

beforeEach(async () => {
  localStorage.clear();
  __resetAppStorageForTests();
  await revokeAIConsent();
  setAIConsentPresenter(async () => true);
  await saveApiKey('synthetic-test-key');
  saveSettings({ defaultModel: DEFAULT, analysisModel: SELECTED, tailorModel: 'custom/my-model', autoFallback: false });
});
afterEach(() => {
  setAIConsentPresenter(null);
  vi.unstubAllGlobals();
  __resetAppStorageForTests();
  localStorage.clear();
});

describe('companion model catalog', () => {
  it('exposes names and action defaults offline without exposing credentials or unrelated preferences', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const configuration = getCompanionModels();
    expect(configuration.defaults).toEqual({ mapping: DEFAULT, analysis: SELECTED, tailoring: 'custom/my-model' });
    expect(configuration.models).toContainEqual({ id: SELECTED, name: 'GPT-5.5' });
    expect(configuration.models).toContainEqual({ id: 'custom/my-model', name: 'custom/my-model' });
    expect(configuration.models.every((model) => Object.keys(model).sort().join(',') === 'id,name')).toBe(true);
    expect(JSON.stringify(configuration)).not.toContain('synthetic-test-key');
    expect(Object.keys(configuration).sort()).toEqual(['autoFallback', 'defaults', 'models']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('includes app-added custom models and reports the existing fallback setting', () => {
    saveSettings({ customModels: ['vendor/custom', '<unsafe/model>', 'x'.repeat(300) + '/model'], autoFallback: true });
    const configuration = getCompanionModels();
    expect(configuration.models).toContainEqual({ id: 'vendor/custom', name: 'vendor/custom' });
    expect(configuration.models.some(({ id }) => id.includes('<') || id.length > 256)).toBe(false);
    expect(configuration.autoFallback).toBe(true);
  });

  it('uses the same app default when action preferences are empty', () => {
    saveSettings({ analysisModel: '', tailorModel: '' });
    expect(getCompanionModels().defaults).toEqual({ mapping: DEFAULT, analysis: DEFAULT, tailoring: DEFAULT });
  });
});

describe('bridge completion model on the OpenRouter wire', () => {
  it.each([undefined, SELECTED])('uses the requested primary model %s without changing app preferences', async (model) => {
    const settingsBefore = getSettings();
    const fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetch);
    await expect(completeForBridge([{ role: 'user', content: 'Draft a truthful answer' }], { model }))
      .rejects.toThrow('OpenRouter API error: 503');
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ model: model || DEFAULT });
    expect(getSettings()).toEqual(settingsBefore);
  });

  it('retains the app automatic fallback setting with the selected model first', async () => {
    saveSettings({ autoFallback: true });
    const fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetch);
    await expect(completeForBridge([{ role: 'user', content: 'Draft an answer' }], { model: SELECTED }))
      .rejects.toThrow('OpenRouter API error: 503');
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.model).toBe(SELECTED);
    expect(request.models[0]).toBe(SELECTED);
    expect(request.models.length).toBeGreaterThan(1);
  });
});
