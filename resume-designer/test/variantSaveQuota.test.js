import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveVariant, getVariants } from '../src/persistence.js';

// Regression test for the "generated resume never appears" bug: when
// localStorage is at quota, saveToStorage swallows the QuotaExceededError and
// saveVariant used to return undefined either way. Callers (the onboarding
// wizard) then advanced to a success screen for a variant that was never
// persisted. saveVariant must report whether the write actually landed.

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveVariant persistence contract', () => {
  it('returns true when the variant write lands', () => {
    const ok = saveVariant('variant-a', 'Variant A', { name: 'A' });
    expect(ok).toBe(true);
    expect(getVariants()['variant-a'].name).toBe('Variant A');
  });

  it('returns false when storage is full and leaves no phantom variant', () => {
    // Mirror the real-world failure: existing data in storage, then quota.
    saveVariant('variant-a', 'Variant A', { name: 'A' });
    const quotaError = new DOMException('quota exceeded', 'QuotaExceededError');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quotaError;
    });

    const ok = saveVariant('variant-b', 'Variant B', { name: 'B' });

    expect(ok).toBe(false);
    // The variant must not be readable back — this is what loadVariant sees.
    expect(getVariants()['variant-b']).toBeUndefined();
    expect(getVariants()['variant-a'].name).toBe('Variant A');
  });

  it('does not pollute the default storage object on a failed first save', () => {
    // Fresh install (no stored data) + quota: loadFromStorage falls back to
    // its DEFAULT_STORAGE template. A shallow copy there would let the failed
    // save's in-memory mutation leak into the module constant, conjuring a
    // phantom variant that getVariants() reports without it ever persisting.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    const ok = saveVariant('variant-ghost', 'Ghost', { name: 'G' });

    expect(ok).toBe(false);
    expect(getVariants()['variant-ghost']).toBeUndefined();
  });
});
