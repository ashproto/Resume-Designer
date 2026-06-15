import { describe, it, expect } from 'vitest';
import { escapeTypstString } from '../src/typst/escape.js';

describe('escapeTypstString', () => {
  it('escapes backslash then quote (order matters)', () => {
    expect(escapeTypstString('a\\b')).toBe('a\\\\b');
    expect(escapeTypstString('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeTypstString('a\\"b')).toBe('a\\\\\\"b');
  });
  it('passes Typst markup specials through literally', () => {
    expect(escapeTypstString('C++ & #func [x] *b* _i_ $x$')).toBe('C++ & #func [x] *b* _i_ $x$');
  });
  it('collapses newlines/tabs to a single space', () => {
    expect(escapeTypstString('line1\n\tline2')).toBe('line1 line2');
  });
  it('coerces nullish to empty string', () => {
    expect(escapeTypstString(null)).toBe('');
    expect(escapeTypstString(undefined)).toBe('');
  });
});
