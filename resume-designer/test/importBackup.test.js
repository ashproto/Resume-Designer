import { describe, it, expect, beforeEach } from 'vitest';
import { importFullBackupFromEnvelope } from '../src/persistence.js';

beforeEach(() => {
  localStorage.clear();
});

describe('importFullBackupFromEnvelope', () => {
  it('throws on a non-envelope object', () => {
    expect(() => importFullBackupFromEnvelope({})).toThrow(/backupFormat/i);
    expect(() => importFullBackupFromEnvelope(null)).toThrow(/backupFormat/i);
  });

  it('throws when a value is not a string', () => {
    expect(() =>
      importFullBackupFromEnvelope({
        backupFormat: 1,
        keys: { 'resume-designer-data': 123 },
      })
    ).toThrow(/must be a string/i);
  });

  it('writes owned keys and silently skips foreign keys', () => {
    const result = importFullBackupFromEnvelope({
      backupFormat: 1,
      keys: {
        'resume-designer-data': '{"summary":"hi"}',
        'evil-key': 'pwned',
      },
    });
    expect(localStorage.getItem('resume-designer-data')).toBe('{"summary":"hi"}');
    expect(localStorage.getItem('evil-key')).toBeNull();
    expect(result.keysImported).toBe(1);
  });

  it('clears pre-existing owned keys not present in the new backup', () => {
    localStorage.setItem('resume-zoom', '1.5');
    importFullBackupFromEnvelope({
      backupFormat: 1,
      keys: { 'resume-designer-data': '{}' },
    });
    expect(localStorage.getItem('resume-zoom')).toBeNull();
    expect(localStorage.getItem('resume-designer-data')).toBe('{}');
  });
});
