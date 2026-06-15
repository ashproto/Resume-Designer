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

// --- block renderers ---

const blocksOf = (node) => (node?.content ?? []);

function renderBullets(listNode, t) {
  const items = (listNode.content ?? [])
    .filter((li) => li.type === 'listItem')
    .map((li) => `[${renderRuns((li.content?.[0]?.content) ?? [])}]`);
  return items.length
    ? `#list(marker: [${t.bulletChar ? `#"${t.bulletChar}"` : ''}], ${items.join(', ')})`
    : '';
}

function renderTags(tagGroup) {
  return (tagGroup.content ?? [])
    .filter((n) => n.type === 'tag')
    .map((tg) => renderRuns(tg.content))
    .filter(Boolean)
    .join(' #h(0.6em) ');
}

// Mirror renderResumeStacked / resume.css experience-item:
//   .experience-title  → font-display, weight bold (resume.css line 399–404)
//   .experience-company → accent color (resume.css line 407–410)
//   .experience-dates   → muted, italic (resume.css line 414–419)
function renderExperienceItem(it, t) {
  const parts = [
    `#text(font: "${t.fontDisplay}", weight: "bold")[${renderRuns(childContent(it, 'jobTitle'))}]`,
    `#text(fill: rgb("${t.accent}"))[${renderRuns(childContent(it, 'company'))}]`,
    `#text(style: "italic", fill: rgb("${t.mutedColor}"))[${renderRuns(childContent(it, 'dates'))}]`,
  ];
  const bl = childOfType(it, 'bulletList');
  if (bl) parts.push(renderBullets(bl, t));
  return parts.join('\n');
}

function renderBlock(node, t) {
  switch (node.type) {
    case 'paragraph':      return `[${renderRuns(node.content)}]`;
    case 'bulletList':     return renderBullets(node, t);
    case 'tagGroup':       return `[${renderTags(node)}]`;
    case 'experienceItem': return renderExperienceItem(node, t);
    case 'educationItem':  return `[${renderRuns(node.content)}]`;
    default: return '';
  }
}

// Mirror resume.css .section-title:
//   font-display, weight bold, accent color, followed by a full-width accent rule
//   (resume.css lines 299–323: border-bottom + ::after in accent color, full-width in stacked)
function renderSection(section, t) {
  const heading = renderRuns(childContent(section, 'heading'));
  const body = blocksOf(section)
    .filter((n) => n.type !== 'heading')
    .map((b) => renderBlock(b, t))
    .filter(Boolean);
  return [
    `#text(font: "${t.fontDisplay}", weight: "bold", fill: accent)[${heading}]`,
    '#line(length: 100%, stroke: 0.5pt + accent)',
    ...body,
  ].join('\n\n');
}

export function modelToTypst(model, { theme } = {}) {
  const nodes = model.content ?? [];
  const header = nodes.find((n) => n.type === 'header');
  const sections = nodes.filter((n) => n.type === 'section').map((s) => renderSection(s, theme));
  return [preamble(model, theme), renderHeader(header, theme), ...sections, ''].join('\n\n');
}
