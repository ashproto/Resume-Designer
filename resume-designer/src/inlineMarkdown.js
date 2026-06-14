// Single source of truth for the inline-markdown dialect (**bold**, _italic_,
// ++underline++). Used by the renderer (markdown → HTML) and the migration
// (markdown ↔ ProseMirror marks). parse/serialize are exact inverses for
// non-nested emphasis, which is all the data uses.

export function escapeHtmlRaw(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// markdown string → HTML (the renderer's exact behavior).
export function formatInlineMarkdown(text) {
  return escapeHtmlRaw(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\+\+([^+\n]+)\+\+/g, '<u>$1</u>')
    .replace(/(^|[\s([{"'`])_([^_\n]+)_(?=$|[\s)\]}"'`.,!?;:])/g, '$1<em>$2</em>');
}

// The three dialect markers, in dialect order (bold, underline, italic). Each
// captures the marker's inner text; `lead` is any boundary char the italic rule
// keeps OUTSIDE the marked span.
const MATCHERS = [
  { mark: 'bold', re: /\*\*([^*]+)\*\*/g, inner: (m) => m[1], lead: () => '' },
  { mark: 'underline', re: /\+\+([^+\n]+)\+\+/g, inner: (m) => m[1], lead: () => '' },
  { mark: 'italic', re: /(^|[\s([{"'`])_([^_\n]+)_(?=$|[\s)\]}"'`.,!?;:])/g, inner: (m) => m[2], lead: (m) => m[1] },
];

// markdown string → array of {type:'text', text, marks?} (non-nested).
export function parseInlineMarks(str) {
  const s = String(str ?? '');
  const spans = [];
  for (const { mark, re, inner, lead } of MATCHERS) {
    for (const m of s.matchAll(re)) {
      const start = m.index + lead(m).length;
      const end = m.index + m[0].length;
      if (!spans.some((sp) => start < sp.end && end > sp.start)) {
        spans.push({ start, end, mark, text: inner(m) });
      }
    }
  }
  spans.sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = 0;
  for (const sp of spans) {
    if (sp.start > cursor) out.push({ type: 'text', text: s.slice(cursor, sp.start) });
    out.push({ type: 'text', text: sp.text, marks: [{ type: sp.mark }] });
    cursor = sp.end;
  }
  if (cursor < s.length) out.push({ type: 'text', text: s.slice(cursor) });
  return out.length ? out : (s ? [{ type: 'text', text: s }] : []);
}

// array of text nodes → markdown string (inverse of parseInlineMarks).
const wrap = { bold: (t) => `**${t}**`, italic: (t) => `_${t}_`, underline: (t) => `++${t}++` };
export function serializeInlineMarks(nodes) {
  return (nodes ?? [])
    .map((n) => {
      let t = n.text ?? '';
      const marks = (n.marks ?? []).map((m) => m.type);
      // inner → outer to mirror the dialect's bold-outer/italic-inner nesting.
      if (marks.includes('italic')) t = wrap.italic(t);
      if (marks.includes('underline')) t = wrap.underline(t);
      if (marks.includes('bold')) t = wrap.bold(t);
      return t;
    })
    .join('');
}
