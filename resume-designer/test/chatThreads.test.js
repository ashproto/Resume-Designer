import { describe, it, expect } from 'vitest';
import { makeThread, migrateThreads } from '../src/chatThreads.js';

describe('makeThread homeVariantId', () => {
  it('defaults homeVariantId to null (General)', () => {
    expect(makeThread('x').homeVariantId).toBe(null);
  });
  it('stores a provided homeVariantId', () => {
    expect(makeThread('x', [], 'v-1').homeVariantId).toBe('v-1');
  });
});

describe('migrateThreads', () => {
  it('adds homeVariantId: null to legacy threads missing the field', () => {
    const out = migrateThreads([{ id: 'a', name: 'A', messages: [] }]);
    expect(out[0].homeVariantId).toBe(null);
  });
  it('preserves an existing homeVariantId', () => {
    const out = migrateThreads([{ id: 'a', homeVariantId: 'v-9', messages: [] }]);
    expect(out[0].homeVariantId).toBe('v-9');
  });
  it('returns [] for a non-array', () => {
    expect(migrateThreads(null)).toEqual([]);
  });
});
