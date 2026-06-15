import { describe, it, expect, beforeEach } from 'vitest';
import { getSettings, saveSettings } from '../src/persistence.js';

describe('defaultPageSize setting', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults to auto on a fresh install', () => {
    expect(getSettings().defaultPageSize).toBe('auto');
  });

  it('persists a changed default and reads it back', () => {
    saveSettings({ defaultPageSize: 'a4' });
    expect(getSettings().defaultPageSize).toBe('a4');
  });
});
