import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttr } from '../src/htmlEscape.js';

describe('escapeHtml', () => {
  it('escapes &, <, > only', () => {
    expect(escapeHtml('<a> & </a>')).toBe('&lt;a&gt; &amp; &lt;/a&gt;');
  });
  it('leaves quotes untouched', () => {
    expect(escapeHtml(`"x" 'y'`)).toBe(`"x" 'y'`);
  });
  it('returns empty string for falsy input', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
  it('coerces non-strings', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('escapeAttr', () => {
  it('escapes &, <, >, double and single quotes', () => {
    expect(escapeAttr(`<a "x" 'y'>`)).toBe('&lt;a &quot;x&quot; &#039;y&#039;&gt;');
  });
  it('returns empty string for falsy input', () => {
    expect(escapeAttr('')).toBe('');
    expect(escapeAttr(null)).toBe('');
  });
});
