import { describe, it, expect } from 'vitest';
import {
  makeThread, migrateThreads, groupThreadsByHome, pickCurrentThreadId,
  lastTurnVariantId, withContextMarker,
  reassignThreadsForDeletedVariant,
} from '../src/chatThreads.js';

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

describe('lastTurnVariantId', () => {
  it('returns the variantId of the last non-context message', () => {
    const msgs = [
      { role: 'user', variantId: 'v1' },
      { role: 'context', variantId: 'v2' },
      { role: 'assistant', variantId: 'v1' },
    ];
    expect(lastTurnVariantId(msgs)).toBe('v1');
  });
  it('returns null for an empty thread', () => {
    expect(lastTurnVariantId([])).toBe(null);
  });
});

describe('withContextMarker', () => {
  it('appends a context marker when the active variant differs from the last turn', () => {
    const msgs = [{ id: 'm1', role: 'user', variantId: 'v1' }];
    const out = withContextMarker(msgs, 'v2', 'Globex');
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ role: 'context', variantId: 'v2', variantName: 'Globex' });
    expect(typeof out[1].id).toBe('string');
  });
  it('is a no-op when the active variant matches the last turn', () => {
    const msgs = [{ id: 'm1', role: 'user', variantId: 'v1' }];
    expect(withContextMarker(msgs, 'v1', 'Acme')).toBe(msgs);
  });
  it('is a no-op for an empty thread (no prior turn to switch from)', () => {
    const msgs = [];
    expect(withContextMarker(msgs, 'v1', 'Acme')).toBe(msgs);
  });
});

describe('reassignThreadsForDeletedVariant', () => {
  const threads = [
    { id: 'a', homeVariantId: 'v1' }, { id: 'b', homeVariantId: 'v2' },
    { id: 'c', homeVariantId: null },
  ];
  it("mode 'general' clears homeVariantId for the deleted variant's threads", () => {
    const out = reassignThreadsForDeletedVariant(threads, 'v1', 'general');
    expect(out.find((t) => t.id === 'a').homeVariantId).toBe(null);
    expect(out.find((t) => t.id === 'b').homeVariantId).toBe('v2'); // untouched
  });
  it("mode 'delete' removes the deleted variant's threads", () => {
    const out = reassignThreadsForDeletedVariant(threads, 'v1', 'delete');
    expect(out.map((t) => t.id)).toEqual(['b', 'c']);
  });
});
