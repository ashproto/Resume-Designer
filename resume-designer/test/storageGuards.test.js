import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createVariant, duplicateVariant, loadVariant } from '../src/variantManager.js';
import { saveVariant, getVariants, initPersistence } from '../src/persistence.js';
import { store } from '../src/store.js';
import { initJobDescriptions, addJobDescription, getAllJobDescriptions } from '../src/jobDescriptions.js';
import { __resetStorageToastForTests } from '../src/storageToast.js';

// Sibling guards to the onboarding-wizard quota fix: the header's create /
// duplicate / import actions, the debounced auto-save, and job-description
// writes must all SURFACE a failed storage write instead of silently doing
// nothing. These tests run in the facade's passthrough mode (jsdom), where a
// quota error from localStorage.setItem is still a real failure path.

function quotaSpy() {
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota exceeded', 'QuotaExceededError');
  });
}

beforeEach(() => {
  localStorage.clear();
  __resetStorageToastForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createVariant under storage failure', () => {
  it('returns null, surfaces the error, and leaves no phantom variant', () => {
    saveVariant('variant-a', 'Variant A', { name: 'A' });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    quotaSpy();

    const id = createVariant('New Resume');

    expect(id).toBeNull();
    expect(Object.keys(getVariants())).toEqual(['variant-a']);
    expect(errSpy).toHaveBeenCalledWith(
      '[storage]',
      expect.stringContaining('local storage is full'),
    );
  });

  it('still returns the new id when storage has room', () => {
    const id = createVariant('New Resume');
    expect(id).not.toBeNull();
    expect(getVariants()[id].name).toBe('New Resume');
  });
});

describe('duplicateVariant under storage failure', () => {
  it('propagates the null from createVariant', () => {
    saveVariant('variant-a', 'Variant A', { name: 'A' });
    loadVariant('variant-a');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    quotaSpy();

    expect(duplicateVariant()).toBeNull();
    expect(Object.keys(getVariants())).toEqual(['variant-a']);
    errSpy.mockRestore();
  });
});

describe('debounced auto-save under storage failure', () => {
  it('surfaces a once-per-session warning when an edit cannot be persisted', () => {
    saveVariant('variant-a', 'Variant A', { name: 'A' });
    loadVariant('variant-a'); // wires initPersistence('variant-a')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    quotaSpy();

    store.update('name', 'Edited Name');
    store.saveNow(); // run the debounced save synchronously
    store.update('name', 'Edited Again');
    store.saveNow();

    const storageErrors = errSpy.mock.calls.filter(
      (c) => c[0] === '[storage]' && /recent edits are NOT being saved/.test(c[1]),
    );
    // once: true — exactly one user-facing warning despite two failed saves.
    expect(storageErrors).toHaveLength(1);
    errSpy.mockRestore();
  });
});

describe('job descriptions under storage failure', () => {
  it('keeps the JD in memory and surfaces the failed write', () => {
    initJobDescriptions();
    const before = getAllJobDescriptions().length;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    quotaSpy();

    const jd = addJobDescription({ title: 'Fictional Role', company: 'Acme', description: 'x' });

    expect(jd.title).toBe('Fictional Role');
    expect(getAllJobDescriptions().length).toBe(before + 1); // in-memory survives
    expect(errSpy).toHaveBeenCalledWith(
      '[storage]',
      expect.stringContaining('job descriptions'),
    );
    errSpy.mockRestore();
  });
});
