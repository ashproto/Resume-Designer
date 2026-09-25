import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  events: [],
  exportFullBackup: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('../src/persistence.js', () => ({
  exportFullBackup: mocks.exportFullBackup,
  importFullBackupDurably: vi.fn(),
  importFullBackupMerge: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
  },
}));

import { exportFullBackupWithFeedback } from '../src/backupFlow.js';

describe('full-backup export feedback', () => {
  beforeEach(() => {
    mocks.events.length = 0;
    mocks.exportFullBackup.mockReset();
    mocks.toastSuccess.mockReset();

    mocks.exportFullBackup.mockImplementation(() => {
      mocks.events.push('export returned');
      return {
        keysExported: 7,
        filename: 'resume-designer-backup-2026-07-17.json',
      };
    });
    mocks.toastSuccess.mockImplementation(() => {
      mocks.events.push('toast shown');
    });
  });

  it('announces the generated filename only after the download request is dispatched', () => {
    exportFullBackupWithFeedback();

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Backup download started', {
      description: 'resume-designer-backup-2026-07-17.json',
    });
    expect(mocks.events).toEqual(['export returned', 'toast shown']);
  });
});
