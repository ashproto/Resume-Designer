import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import SettingsDialog from '../src/components/SettingsDialog.jsx';
import { revokeAIConsent } from '../src/aiConsent.js';

beforeEach(async () => { localStorage.clear(); await revokeAIConsent(); });
afterEach(cleanup);

it('reads the adopted device permission when Settings opens after startup', async () => {
  render(<SettingsDialog />);
  // Native storage adoption happens after App mounts its closed dialogs.
  localStorage.setItem('resume-designer-ai-sharing-consent', JSON.stringify({ revision: 1, accepted: true }));
  await act(async () => { window.dispatchEvent(new CustomEvent('rd:open-settings', { detail: { tab: 'api-keys' } })); });
  expect(screen.getByRole('button', { name: 'Stop AI sharing' })).toBeTruthy();
});
