import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({
  toast: { success: toastSuccess },
}));

describe('backup download feedback', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
  });

  it('identifies a per-profile backup without claiming the file was saved', async () => {
    // This presentation helper is intentionally independent of the profile
    // export coordinator, so AccountSection can preserve its existing
    // flush-before-export ordering and report only after export resolves.
    const { notifyBackupDownloadStarted } = await import('../src/backupFeedback.js');

    notifyBackupDownloadStarted({
      filename: 'resume-designer-profile-partner-2026-07-17.json',
      profileName: 'Partner',
    });

    expect(toastSuccess).toHaveBeenCalledWith('Backup download started for "Partner"', {
      description: 'resume-designer-profile-partner-2026-07-17.json',
    });
  });
});
