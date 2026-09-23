import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const CONSENT_KEY = 'resume-designer-ai-sharing-consent';
let storage;
let consent;
let files;
let backend;

async function restart() {
  storage?.__resetAppStorageForTests();
  vi.resetModules();
  storage = await import('../src/appStorage.js');
  await storage.initAppStorage({ backend });
  consent = await import('../src/aiConsent.js');
}

beforeEach(async () => {
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  files = new Map([[CONSENT_KEY, JSON.stringify({ revision: 1, accepted: true })]]);
  backend = {
    loadAll: async () => Object.fromEntries(files),
    write: vi.fn(async (key, value) => { files.set(key, value); }),
    delete: vi.fn(async (key) => { files.delete(key); }),
  };
  await restart();
});

afterEach(() => {
  storage.__resetAppStorageForTests();
  localStorage.clear();
  vi.restoreAllMocks();
});

it('keeps failed revocation denied after a full restart and permits cleanup retry', async () => {
  backend.delete.mockRejectedValue(new Error('deletion unavailable'));
  expect(consent.hasAIConsent()).toBe(true);
  await expect(consent.revokeAIConsent()).rejects.toMatchObject({ code: 'AI_CONSENT_STORAGE' });

  await restart();
  expect(consent.hasAIConsent()).toBe(false);
  expect(consent.isAIConsentRevocationPending()).toBe(true);
  const presenter = vi.fn(async () => true);
  consent.setAIConsentPresenter(presenter);
  await expect(consent.requestAIConsent()).rejects.toMatchObject({ code: 'AI_CONSENT_STORAGE' });
  expect(presenter).not.toHaveBeenCalled();
  expect(() => consent.assertAIConsent()).toThrow();

  backend.delete.mockImplementation(async (key) => { files.delete(key); });
  await consent.revokeAIConsent();
  expect(files.has(CONSENT_KEY)).toBe(false);
  await restart();
  expect(consent.hasAIConsent()).toBe(false);
  expect(consent.isAIConsentRevocationPending()).toBe(false);
  consent.setAIConsentPresenter(presenter);
  await consent.requestAIConsent();
  expect(presenter).toHaveBeenCalledOnce();
  expect(consent.hasAIConsent()).toBe(true);
});

it('removes the old grant even if the denial record cannot be written', async () => {
  backend.write.mockRejectedValue(new Error('disk full'));
  await expect(consent.revokeAIConsent()).resolves.toBeUndefined();
  expect(backend.write).toHaveBeenCalled();
  await restart();
  expect(consent.hasAIConsent()).toBe(false);
  expect(consent.isAIConsentRevocationPending()).toBe(false);
});

it('retries the denial when writes recover during failed deletion', async () => {
  backend.write.mockRejectedValue(new Error('storage unavailable'));
  backend.delete.mockImplementation(async () => {
    backend.write.mockImplementation(async (key, value) => { files.set(key, value); });
    throw new Error('deletion unavailable');
  });
  await expect(consent.revokeAIConsent()).rejects.toMatchObject({ code: 'AI_CONSENT_STORAGE' });

  await restart();
  expect(consent.hasAIConsent()).toBe(false);
  expect(consent.isAIConsentRevocationPending()).toBe(true);
  await expect(consent.requestAIConsent()).rejects.toMatchObject({ code: 'AI_CONSENT_STORAGE' });
});

it('retains an unsaved denial for a later flush when deletion remains unavailable', async () => {
  backend.write.mockRejectedValue(new Error('storage unavailable'));
  backend.delete.mockRejectedValue(new Error('deletion unavailable'));
  await expect(consent.revokeAIConsent()).rejects.toMatchObject({ code: 'AI_CONSENT_STORAGE' });

  backend.write.mockImplementation(async (key, value) => { files.set(key, value); });
  await expect(storage.appStorage.flush()).resolves.toBe(true);
  await restart();
  expect(consent.hasAIConsent()).toBe(false);
  expect(consent.isAIConsentRevocationPending()).toBe(true);
  await expect(consent.requestAIConsent()).rejects.toMatchObject({ code: 'AI_CONSENT_STORAGE' });
});

it('reports total storage failure and blocks sharing for the current session', async () => {
  backend.write.mockRejectedValue(new Error('storage unavailable'));
  backend.delete.mockRejectedValue(new Error('storage unavailable'));
  await expect(consent.revokeAIConsent()).rejects.toMatchObject({
    code: 'AI_CONSENT_STORAGE',
    message: expect.stringContaining('Previous permission may return after restarting.'),
  });
  expect(consent.hasAIConsent()).toBe(false);
  expect(consent.isAIConsentRevocationPending()).toBe(true);
  await expect(consent.requestAIConsent()).rejects.toMatchObject({ code: 'AI_CONSENT_STORAGE' });

  backend.write.mockImplementation(async (key, value) => { files.set(key, value); });
  backend.delete.mockImplementation(async (key) => { files.delete(key); });
  await consent.revokeAIConsent();
  await restart();
  expect(consent.hasAIConsent()).toBe(false);
  expect(consent.isAIConsentRevocationPending()).toBe(false);
});
