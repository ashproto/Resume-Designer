// Escape a string for emission inside a Typst string literal: #"<result>".
// Only backslash and double-quote are special inside a literal — markup chars
// (#, *, _, [, ], $, @, <, >) render verbatim, which is what we want for résumé
// text. Backslash MUST be escaped before the quote (we add backslashes for "),
// or the quote-escape's backslash would itself get doubled. Newlines/tabs would
// be illegal mid-literal, so collapse runs of them to one space.
export function escapeTypstString(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n\t]+/g, ' ');
}
