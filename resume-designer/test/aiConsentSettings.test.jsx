import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SettingsDialog from '../src/components/SettingsDialog.jsx';
import { hasAIConsent, revokeAIConsent, setAIConsentPresenter } from '../src/aiConsent.js';
import { initAppStorage, __resetAppStorageForTests } from '../src/appStorage.js';

beforeEach(async () => {
  localStorage.clear();
  __resetAppStorageForTests();
  await revokeAIConsent();
  setAIConsentPresenter(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  __resetAppStorageForTests();
});

it('reads the adopted device permission when Settings opens after startup', async () => {
  render(<SettingsDialog />);
  // Native storage adoption happens after App mounts its closed dialogs.
  localStorage.setItem('resume-designer-ai-sharing-consent', JSON.stringify({ revision: 1, accepted: true }));
  await act(async () => { window.dispatchEvent(new CustomEvent('rd:open-settings', { detail: { tab: 'api-keys' } })); });
  expect(screen.getByRole('button', { name: 'Stop AI sharing' })).toBeTruthy();
});

it('retries a failed revocation from Settings without reopening the approval prompt', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const consentKey = 'resume-designer-ai-sharing-consent';
  const files = new Map([[consentKey, JSON.stringify({ revision: 1, accepted: true })]]);
  let failDelete = true;
  const backend = {
    loadAll: async () => Object.fromEntries(files),
    write: async (key, value) => files.set(key, value),
    delete: async (key) => {
      if (key === consentKey && failDelete) throw new Error('storage unavailable');
      files.delete(key);
    },
  };
  await initAppStorage({ backend });
  const presenter = vi.fn(async () => true);
  setAIConsentPresenter(presenter);
  const view = render(<SettingsDialog />);
  const openSettings = async () => act(async () => {
    window.dispatchEvent(new CustomEvent('rd:open-settings', { detail: { tab: 'api-keys' } }));
  });
  await openSettings();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop AI sharing' })); });
  expect(hasAIConsent()).toBe(false);
  expect(files.has(consentKey)).toBe(true);
  expect(screen.getByRole('button', { name: 'Retry stopping AI sharing' })).toBeTruthy();

  // Reopening Settings must retain the retry action, too.
  view.unmount();
  render(<SettingsDialog />);
  await openSettings();
  failDelete = false;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry stopping AI sharing' })); });
  expect(presenter).not.toHaveBeenCalled();
  expect(files.has(consentKey)).toBe(false);
  expect(screen.getByRole('button', { name: 'Review AI data sharing' })).toBeTruthy();

  __resetAppStorageForTests();
  await initAppStorage({ backend });
  expect(hasAIConsent()).toBe(false);
});
