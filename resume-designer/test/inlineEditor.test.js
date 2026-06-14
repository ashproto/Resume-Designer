import { describe, it, expect } from 'vitest';
import { replaceToolToken } from '../src/inlineEditor.js';

describe('replaceToolToken (tool re-join fix)', () => {
  it('replaces only the edited token, keeping the others', () => {
    expect(replaceToolToken('A • B • C', 1, 'B2')).toBe('A • B2 • C');
  });
  it('keeps token emphasis on untouched tokens', () => {
    expect(replaceToolToken('**A** • B • C', 2, 'C2')).toBe('**A** • B • C2');
  });
  it('drops a token edited to empty', () => {
    expect(replaceToolToken('A • B • C', 1, '')).toBe('A • C');
  });
  it('appends when the index is past the end (new chip)', () => {
    expect(replaceToolToken('A • B', 2, 'C')).toBe('A • B • C');
  });
  it('aligns indices with the rendered (empty-token-free) chips', () => {
    // visible chips of 'A •  • B' are ['A','B']; editing chip index 1 hits 'B', not the empty.
    expect(replaceToolToken('A •  • B', 1, 'B2')).toBe('A • B2');
  });
});
