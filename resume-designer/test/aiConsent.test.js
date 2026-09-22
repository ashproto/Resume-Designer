import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, fetchModelCatalog } from '../src/aiService.js';
import { saveApiKey, saveSettings, importFullBackupFromEnvelope } from '../src/persistence.js';
import * as consent from '../src/aiConsent.js';
import { appStorage, initAppStorage, __resetAppStorageForTests } from '../src/appStorage.js';
import { applyUnits } from '../src/sync/syncModel.js';

const MODEL = 'anthropic/claude-sonnet-4.6';
const CONSENT_KEY = 'resume-designer-ai-sharing-consent';
let requests;

beforeEach(async () => {
  localStorage.clear();
  __resetAppStorageForTests();
  if (consent.revokeAIConsent) await consent.revokeAIConsent();
  if (consent.setAIConsentPresenter) consent.setAIConsentPresenter(null);
  await saveApiKey('test-key');
  requests = [];
  vi.stubGlobal('fetch', async (url, options) => {
    requests.push({ url, options });
    return url.endsWith('/models')
      ? { ok: true, json: async () => ({ data: [] }) }
      : { ok: false, status: 500, json: async () => ({}) };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetAppStorageForTests();
  localStorage.clear();
});

describe('AI data-sharing permission at the network boundary', () => {
  it('does not send personal text merely because an API key is configured', async () => {
    await expect(chat(MODEL, [{ role: 'user', content: 'Private resume details' }], false))
      .rejects.toMatchObject({ code: 'AI_CONSENT_DECLINED' });
    expect(requests).toEqual([]);
  });

  it('still permits the public model catalog without sharing permission', async () => {
    await fetchModelCatalog(true);
    expect(requests.map(({ url }) => url)).toEqual(['https://openrouter.ai/api/v1/models']);
  });

  it('requires explicit approval once for future requests and sends only after approval', async () => {
    let answer;
    const presenter = vi.fn(() => new Promise((resolve) => { answer = resolve; }));
    consent.setAIConsentPresenter(presenter);
    const request = chat(MODEL, [{ role: 'user', content: 'Private details' }], false);
    const rejected = expect(request).rejects.toThrow('OpenRouter API error: 500');
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
    expect(requests).toEqual([]);
    expect(consent.hasAIConsent()).toBe(false);
    answer(true);
    await rejected;
    expect(requests).toHaveLength(1);
    expect(consent.hasAIConsent()).toBe(true);
    await expect(chat(MODEL, [{ role: 'user', content: 'More details' }], false)).rejects.toThrow('500');
    expect(requests).toHaveLength(2);
    expect(presenter).toHaveBeenCalledTimes(1);
  });

  it('does not treat dismissal, a presenter failure, or a truthy non-boolean as approval', async () => {
    for (const answer of [false, null, 'true', new Error('closed')]) {
      consent.setAIConsentPresenter(async () => {
        if (answer instanceof Error) throw answer;
        return answer;
      });
      await expect(chat(MODEL, [{ role: 'user', content: 'Private details' }], false))
        .rejects.toMatchObject({ code: 'AI_CONSENT_DECLINED' });
    }
    expect(requests).toEqual([]);
    expect(consent.hasAIConsent()).toBe(false);
  });

  it('describes the actual selected models, automatic fallback, and web search before sending', async () => {
    saveSettings({ autoFallback: true });
    let shown;
    consent.setAIConsentPresenter(async (disclosure) => { shown = disclosure; return true; });
    await expect(chat(MODEL, [{ role: 'user', content: 'Private details' }], false, { webSearch: true }))
      .rejects.toThrow('500');
    const body = JSON.parse(requests[0].options.body);
    expect(shown.modelIds).toEqual(['anthropic/claude-sonnet-4.6', 'openai/gpt-5.5', 'google/gemini-3.1-pro-preview']);
    expect(body.models).toEqual(shown.modelIds);
    expect(shown.webSearch).toBe(true);
    expect(body.tools).toEqual([{ type: 'openrouter:web_search' }]);
  });

  it('deduplicates concurrent prompts while allowing one waiting request to cancel', async () => {
    let answer;
    let shown;
    const presenter = vi.fn((disclosure) => {
      shown = disclosure;
      return new Promise((resolve) => { answer = resolve; });
    });
    consent.setAIConsentPresenter(presenter);
    const controller = new AbortController();
    const first = consent.requestAIConsent({ signal: controller.signal });
    const firstResult = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = consent.requestAIConsent();
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
    controller.abort();
    await firstResult;
    expect(shown.signal.aborted).toBe(false);
    answer(true);
    await second;
    expect(presenter).toHaveBeenCalledTimes(1);
    expect(consent.hasAIConsent()).toBe(true);
  });

  it('aborts the visible prompt and sends nothing when its last request is stopped', async () => {
    let shown;
    consent.setAIConsentPresenter((disclosure) => { shown = disclosure; return new Promise(() => {}); });
    const controller = new AbortController();
    const request = chat(MODEL, [{ role: 'user', content: 'Private details' }], false, { signal: controller.signal });
    const outcome = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(shown).toBeDefined());
    controller.abort();
    await outcome;
    expect(shown.signal.aborted).toBe(true);
    expect(requests).toEqual([]);
    expect(consent.hasAIConsent()).toBe(false);
  });

  it('revocation defeats an outstanding Allow answer and requires new approval for later requests', async () => {
    let answer;
    consent.setAIConsentPresenter(() => new Promise((resolve) => { answer = resolve; }));
    const request = consent.requestAIConsent();
    const outcome = expect(request).rejects.toMatchObject({ code: 'AI_CONSENT_DECLINED' });
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
    await consent.revokeAIConsent();
    answer(true);
    await outcome;
    expect(consent.hasAIConsent()).toBe(false);
    consent.setAIConsentPresenter(async () => true);
    await consent.requestAIConsent();
    await consent.revokeAIConsent();
    consent.setAIConsentPresenter(null);
    await expect(chat(MODEL, [{ role: 'user', content: 'Private details' }], false))
      .rejects.toMatchObject({ code: 'AI_CONSENT_DECLINED' });
    expect(requests).toEqual([]);
  });

  it('rejects an obsolete disclosure revision and malformed saved consent', async () => {
    for (const value of ['true', '{', JSON.stringify({ revision: 0, accepted: true })]) {
      appStorage.setItem(CONSENT_KEY, value);
      expect(consent.hasAIConsent()).toBe(false);
      await expect(consent.requestAIConsent()).rejects.toMatchObject({ code: 'AI_CONSENT_DECLINED' });
    }
  });

  it('does not let a backup or synced record grant permission on this device', async () => {
    consent.setAIConsentPresenter(async () => true);
    await consent.requestAIConsent();
    const grant = appStorage.getItem(CONSENT_KEY);
    await consent.revokeAIConsent();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    importFullBackupFromEnvelope({ backupFormat: 1, keys: { [CONSENT_KEY]: grant } });
    expect(consent.hasAIConsent()).toBe(false);
    expect(() => importFullBackupFromEnvelope({
      backupFormat: 2, kind: 'full', registry: [{ id: 'p1', name: 'Imported' }],
      profiles: { p1: { keys: {} } }, shared: { [CONSENT_KEY]: grant },
    })).toThrow('unrecognized shared key');
    expect(consent.hasAIConsent()).toBe(false);
    await applyUnits([{ id: `key:${CONSENT_KEY}`, kind: 'plain', payload: grant, modifiedAt: '2099-01-01T00:00:00Z' }]);
    expect(consent.hasAIConsent()).toBe(false);
    expect(appStorage.getItem(CONSENT_KEY)).toBeNull();
  });

  it('never reports permission or sends data while its grant is still waiting for disk', async () => {
    const files = new Map([['marker', 'present']]);
    let release;
    await initAppStorage({ backend: {
      loadAll: async () => Object.fromEntries(files),
      write: async (key, value) => {
        if (key === CONSENT_KEY) await new Promise((resolve) => { release = resolve; });
        files.set(key, value);
      },
      delete: async (key) => files.delete(key),
    } });
    consent.setAIConsentPresenter(async () => true);
    const allowed = consent.requestAIConsent();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(consent.hasAIConsent()).toBe(false);
    expect(files.has(CONSENT_KEY)).toBe(false);
    release();
    await allowed;
    expect(files.has(CONSENT_KEY)).toBe(true);
    expect(consent.hasAIConsent()).toBe(true);
  });

  it('refuses permission if its grant cannot reach disk', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await initAppStorage({ backend: {
      loadAll: async () => ({ marker: 'present' }),
      write: async () => { throw new Error('disk full'); },
      delete: async () => {},
    } });
    consent.setAIConsentPresenter(async () => true);
    await expect(consent.requestAIConsent()).rejects.toMatchObject({ code: 'AI_CONSENT_STORAGE' });
    expect(consent.hasAIConsent()).toBe(false);
  });

  it('notifies settings only after successful consent and immediately on revocation', async () => {
    const states = [];
    const unsubscribe = consent.subscribeAIConsent(() => states.push(consent.hasAIConsent()));
    consent.setAIConsentPresenter(async () => true);
    await consent.requestAIConsent();
    await consent.revokeAIConsent();
    unsubscribe();
    expect(states).toEqual([true, false]);
  });

  it('retains an approved revision after reloading the same device storage', async () => {
    const files = new Map([['marker', 'present']]);
    const backend = {
      loadAll: async () => Object.fromEntries(files),
      write: async (key, value) => files.set(key, value),
      delete: async (key) => files.delete(key),
    };
    await initAppStorage({ backend });
    consent.setAIConsentPresenter(async () => true);
    await consent.requestAIConsent();
    __resetAppStorageForTests();
    await initAppStorage({ backend });
    consent.setAIConsentPresenter(null);
    await expect(consent.requestAIConsent()).resolves.toBeUndefined();
    expect(consent.hasAIConsent()).toBe(true);
  });

  it('blocks an approved request if revocation arrives before the network send', async () => {
    consent.setAIConsentPresenter(async () => true);
    const unsubscribe = consent.subscribeAIConsent(() => {
      if (consent.hasAIConsent()) void consent.revokeAIConsent();
    });
    try {
      await expect(chat(MODEL, [{ role: 'user', content: 'Private details' }], false))
        .rejects.toMatchObject({ code: 'AI_CONSENT_DECLINED' });
      expect(requests).toEqual([]);
    } finally { unsubscribe(); }
  });

  it('does not authorize a write deferred by a backup restore', async () => {
    consent.setAIConsentPresenter(async () => true);
    appStorage.beginRestoreGuard();
    try {
      await expect(consent.requestAIConsent()).rejects.toMatchObject({ code: 'AI_CONSENT_STORAGE' });
      expect(consent.hasAIConsent()).toBe(false);
    } finally { appStorage.endRestoreGuard(); appStorage.discardDeferredWrites(); }
  });

  it('keeps sharing paused and reports when revocation cannot be persisted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const files = new Map([['marker', 'present']]);
    let failDelete = false;
    await initAppStorage({ backend: {
      loadAll: async () => Object.fromEntries(files),
      write: async (key, value) => files.set(key, value),
      delete: async (key) => {
        if (failDelete) throw new Error('storage unavailable');
        files.delete(key);
      },
    } });
    consent.setAIConsentPresenter(async () => true);
    await consent.requestAIConsent();
    failDelete = true;
    await expect(consent.revokeAIConsent()).rejects.toMatchObject({ code: 'AI_CONSENT_STORAGE' });
    expect(files.has(CONSENT_KEY)).toBe(true);
    expect(consent.hasAIConsent()).toBe(false);
    consent.setAIConsentPresenter(null);
    await expect(consent.requestAIConsent()).rejects.toMatchObject({ code: 'AI_CONSENT_DECLINED' });
    failDelete = false;
    await consent.revokeAIConsent();
    expect(files.has(CONSENT_KEY)).toBe(false);
  });
});
