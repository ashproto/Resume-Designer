import { describe, it, expect } from 'vitest';
import { makeThread, migrateThreads, groupThreadsByHome, pickCurrentThreadId } from '../src/chatThreads.js';

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

const T = (id, home, updatedAt) => ({ id, name: id, messages: [], homeVariantId: home, updatedAt });

describe('groupThreadsByHome', () => {
  const variants = [{ id: 'v1', name: 'Acme' }, { id: 'v2', name: 'Globex' }];
  const threads = [
    T('a', 'v1', '2026-01-03'), T('b', 'v1', '2026-01-05'),
    T('c', null, '2026-01-02'), T('d', 'v2', '2026-01-04'),
    T('e', 'v-deleted', '2026-01-01'),
  ];
  it('splits into current / general / others and sorts current by updatedAt desc', () => {
    const g = groupThreadsByHome(threads, 'v1', variants);
    expect(g.current.map((t) => t.id)).toEqual(['b', 'a']);
    expect(g.general.map((t) => t.id)).toEqual(['c', 'e']); // deleted-home falls into General
    expect(g.others).toEqual([{ variantId: 'v2', variantName: 'Globex', threads: [threads[3]] }]);
  });
  it('current is empty when the active variant has no threads', () => {
    expect(groupThreadsByHome(threads, 'v2', variants).current.map((t) => t.id)).toEqual(['d']);
    expect(groupThreadsByHome([], 'v1', variants).current).toEqual([]);
  });
});

describe('pickCurrentThreadId', () => {
  const threads = [T('a', 'v1', '2026-01-03'), T('b', 'v1', '2026-01-05'), T('c', 'v2', '2026-01-09')];
  it('returns the most-recent thread homed to the active variant', () => {
    expect(pickCurrentThreadId(threads, 'v1')).toBe('b');
  });
  it('returns null when the active variant has no threads', () => {
    expect(pickCurrentThreadId(threads, 'v3')).toBe(null);
  });
});
