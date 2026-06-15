import { escapeTypstString } from './escape.js';

const childOfType = (node, type) => (node?.content ?? []).find((n) => n.type === type);
const childContent = (node, type) => childOfType(node, type)?.content ?? [];

// --- inline runs (marks) ---
function renderRun(node) {
  let inner = `#"${escapeTypstString(node.text ?? '')}"`;
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') inner = `#strong[${inner}]`;
    else if (mark.type === 'italic') inner = `#emph[${inner}]`;
    else if (mark.type === 'underline') inner = `#underline[${inner}]`;
    else if (mark.type === 'link') inner = `#link("${escapeTypstString(mark.attrs?.href ?? '')}")[${inner}]`;
  }
  return inner;
}
function renderRuns(nodes = []) {
  return nodes.filter((n) => n.type === 'text').map(renderRun).join('');
}

const PAPER = { letter: 'us-letter', a4: 'a4', legal: 'us-legal' };
function pageRule(pageSize, t) {
  const margin = `(top: ${t.marginTopIn}in, bottom: ${t.marginBottomIn}in, left: ${t.marginLeftIn}in, right: ${t.marginRightIn}in)`;
  return PAPER[pageSize]
    ? `#set page(paper: "${PAPER[pageSize]}", margin: ${margin})`
    : `#set page(width: 8.5in, height: auto, margin: ${margin})`;
}

function preamble(model, t) {
  return [
    pageRule(model.attrs?.pageSize ?? 'auto', t),
    `#set text(font: "${t.fontBody}", size: ${t.baseSizePt}pt, fill: rgb("${t.textColor}"))`,
    `#set par(leading: ${(t.lineHeight - 1).toFixed(3)}em, justify: false)`,
    `#let accent = rgb("${t.accent}")`,
  ].join('\n');
}

function renderHeader(header, t) {
  const name = renderRuns(childContent(header, 'name'));
  const tagline = renderRuns(childContent(header, 'tagline'));
  const contacts = (childOfType(header, 'contactList')?.content ?? [])
    .filter((n) => n.type === 'contactItem')
    .map((ci) => renderRuns(ci.content))
    .filter(Boolean)
    .join(` #text(fill: rgb("${t.mutedColor}"))[#" • "] `);
  return [
    `#text(font: "${t.fontDisplay}", size: ${t.nameSizePt}pt, weight: "bold")[${name}]`,
    `#text(size: ${t.taglineSizePt}pt, fill: rgb("${t.mutedColor}"))[${tagline}]`,
    contacts ? `#text(fill: rgb("${t.mutedColor}"))[${contacts}]` : '',
    '',
  ].filter((s) => s !== '').join('\n\n');
}

export function modelToTypst(model, { theme } = {}) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  // Sections are added in Task 5; for now emit preamble + header.
  return [preamble(model, theme), renderHeader(header, theme), ''].join('\n\n');
}
