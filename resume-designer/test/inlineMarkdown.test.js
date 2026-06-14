import { describe, it, expect } from 'vitest';
import { parseInlineMarks, serializeInlineMarks, escapeHtmlRaw } from '../src/inlineMarkdown.js';

const roundtrip = (s) => serializeInlineMarks(parseInlineMarks(s));

describe('parseInlineMarks / serializeInlineMarks', () => {
  it('parses bold/italic/underline to marked text nodes', () => {
    expect(parseInlineMarks('a **b** _c_ ++d++')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'c', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'd', marks: [{ type: 'underline' }] },
    ]);
  });
  it('round-trips byte-for-byte', () => {
    for (const s of [
      'Led **growth** and _scaled_ the team — 3×.',
      'Shipped **v2**.',
      'Rust • WASM',
      'C++ and Go',
      'plain text',
      'edge_case snake_word',
      '',
    ]) expect(roundtrip(s)).toBe(s);
  });
  it('produces no empty marks objects on plain text', () => {
    expect(parseInlineMarks('plain')).toEqual([{ type: 'text', text: 'plain' }]);
  });
});

describe('escapeHtmlRaw', () => {
  it('escapes the five HTML chars with the repo convention (&#039; for apostrophe)', () => {
    expect(escapeHtmlRaw(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#039;');
  });
});
