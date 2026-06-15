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

function stackedLayout(model, theme) {
  const nodes = model.content ?? [];
  const header = nodes.find((n) => n.type === 'header');
  const sections = nodes.filter((n) => n.type === 'section').map((s) => renderSection(s, theme));
  return [preamble(model, theme), renderHeader(header, theme), ...sections, ''].join('\n\n');
}

// Bucket sections by kind, preserving model order within each bucket.
function groupSections(model) {
  const sections = (model.content ?? []).filter((n) => n.type === 'section');
  const byKind = (k) => sections.filter((s) => s.attrs?.sectionKind === k);
  return {
    summary: byKind('summary'),
    customs: byKind('custom'),
    experience: byKind('experience'),
    education: byKind('education'),
    tools: byKind('tools'),
  };
}

// Gradient header (white text on linear-gradient background) — mirrors
// resume.css: linear-gradient(135deg, var(--header-bg), var(--header-bg-end)) with white text.
function renderGradientHeader(header, t) {
  const name = renderRuns(childContent(header, 'name'));
  const tagline = renderRuns(childContent(header, 'tagline'));
  const contacts = (childOfType(header, 'contactList')?.content ?? [])
    .filter((n) => n.type === 'contactItem').map((ci) => renderRuns(ci.content)).filter(Boolean)
    .join(' #" • " ');
  return `#block(width: 100%, fill: gradient.linear(angle: 135deg, rgb("${t.headerBg}"), rgb("${t.headerBgEnd}")), inset: 16pt)[
  #text(font: "${t.fontDisplay}", size: ${t.nameSizePt}pt, weight: "bold", fill: white)[${name}]

  #text(size: ${t.taglineSizePt}pt, fill: white)[${tagline}]
${contacts ? `\n  #text(size: ${(8 * t.fontScale).toFixed(2)}pt, fill: white)[${contacts}]` : ''}
]`;
}

// Sidebar section: h3-style title — display font, uppercase, accent, smaller.
// Mirrors resume.css .sidebar-title: font-display, 0.8rem, uppercase, accent, accent border-bottom.
function renderSidebarSection(section, t) {
  const heading = renderRuns(childContent(section, 'heading'));
  const body = (section.content ?? []).filter((n) => n.type !== 'heading').map((b) => renderBlock(b, t)).filter(Boolean);
  return [
    `#text(font: "${t.fontDisplay}", size: ${(0.8 * 12 * t.fontScale).toFixed(2)}pt, weight: "bold", fill: accent)[#upper[${heading}]]`,
    '#line(length: 100%, stroke: 1pt + accent)',
    ...body,
  ].join('\n\n');
}

function sidebarLayout(model, t) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const g = groupSections(model);
  const sidebarCell = [...g.customs, ...g.tools].map((s) => renderSidebarSection(s, t)).filter(Boolean).join('\n\n');
  const mainCell = [...g.summary, ...g.experience, ...g.education].map((s) => renderSection(s, t)).filter(Boolean).join('\n\n');
  const grid = `#grid(columns: (${t.sidebarWidthIn}in, 1fr), column-gutter: 14pt,
  block(fill: rgb("${t.sidebarBg}"), inset: 12pt, width: 100%, height: 100%)[
${sidebarCell}
],
  block(inset: (left: 4pt))[
${mainCell}
])`;
  return [preamble(model, t), renderGradientHeader(header, t), grid, ''].join('\n\n');
}

// Classic layout: solid centered header (no gradient), single column ordered
// summary → experience → education → custom sections → tools.
// Mirrors renderResumeClassic in renderer.js + .classic-header in resume.css:923-929.

const CLASSIC_LABELS = { summary: 'Professional Summary', experience: 'Professional Experience' };

function renderSolidCenteredHeader(header, t) {
  const name = renderRuns(childContent(header, 'name'));
  const tagline = renderRuns(childContent(header, 'tagline'));
  const contacts = (childOfType(header, 'contactList')?.content ?? [])
    .filter((n) => n.type === 'contactItem').map((ci) => renderRuns(ci.content)).filter(Boolean).join(' #" • " ');
  return `#block(width: 100%, fill: rgb("${t.headerBg}"), inset: 16pt)[#align(center)[
  #text(font: "${t.fontDisplay}", size: ${t.nameSizePt}pt, weight: "bold", fill: white)[${name}]

  #text(size: ${t.taglineSizePt}pt, fill: white)[${tagline}]
${contacts ? `\n  #text(size: ${(8 * t.fontScale).toFixed(2)}pt, fill: white)[${contacts}]` : ''}
]]`;
}

// Like renderSection but honoring the classic label override for summary/experience.
function renderClassicSection(section, t) {
  const kind = section.attrs?.sectionKind;
  const label = CLASSIC_LABELS[kind];
  const heading = label ? `#"${label}"` : renderRuns(childContent(section, 'heading'));
  const body = (section.content ?? []).filter((n) => n.type !== 'heading').map((b) => renderBlock(b, t)).filter(Boolean);
  return [
    `#text(font: "${t.fontDisplay}", weight: "bold", fill: accent)[${heading}]`,
    '#line(length: 100%, stroke: 0.5pt + accent)',
    ...body,
  ].join('\n\n');
}

function classicLayout(model, t) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const g = groupSections(model);
  const ordered = [...g.summary, ...g.experience, ...g.education, ...g.customs, ...g.tools];
  const body = ordered.map((s) => renderClassicSection(s, t)).filter(Boolean).join('\n\n');
  return [preamble(model, t), renderSolidCenteredHeader(header, t), body, ''].join('\n\n');
}

function rightSidebarLayout(model, t) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const g = groupSections(model);
  const mainCell = [...g.summary, ...g.experience, ...g.education].map((s) => renderSection(s, t)).filter(Boolean).join('\n\n');
  const sidebarCell = [...g.customs, ...g.tools].map((s) => renderSidebarSection(s, t)).filter(Boolean).join('\n\n');
  const grid = `#grid(columns: (1fr, ${t.sidebarWidthIn}in), column-gutter: 14pt,
  block(inset: (right: 4pt))[
${mainCell}
],
  block(fill: rgb("${t.sidebarBg}"), inset: 12pt, width: 100%, height: 100%)[
${sidebarCell}
])`;
  return [preamble(model, t), renderGradientHeader(header, t), grid, ''].join('\n\n');
}

// Modern layout: narrow 1.8in sidebar (left) + main (right), horizontal gradient header
// (name/tagline on the left, contacts on the right). Mirrors renderResumeModern in
// renderer.js + .modern-* rules in resume.css (grid-template-columns: 1.8in 1fr; flex-row header).
// Sidebar partition: customs + tools + education (same as renderSidebar + education in renderer.js).
// Sidebar cell is emitted first (sidebar-then-main reading order).
function renderModernGradientHeader(header, t) {
  const name = renderRuns(childContent(header, 'name'));
  const tagline = renderRuns(childContent(header, 'tagline'));
  const contacts = (childOfType(header, 'contactList')?.content ?? [])
    .filter((n) => n.type === 'contactItem').map((ci) => renderRuns(ci.content)).filter(Boolean)
    .join(' #" • " ');
  const nameBlock = `#text(font: "${t.fontDisplay}", size: ${t.nameSizePt}pt, weight: "bold", fill: white)[${name}]`;
  const taglineBlock = `#text(size: ${t.taglineSizePt}pt, fill: white)[${tagline}]`;
  const contactBlock = contacts
    ? `#align(right)[#text(size: ${(8 * t.fontScale).toFixed(2)}pt, fill: white)[${contacts}]]`
    : '';
  const leftCell = `[${nameBlock}\n\n${taglineBlock}]`;
  const rightCell = contactBlock ? `[${contactBlock}]` : '[]';
  return `#block(width: 100%, fill: gradient.linear(angle: 135deg, rgb("${t.headerBg}"), rgb("${t.headerBgEnd}")), inset: 16pt)[
  #grid(columns: (1fr, auto), column-gutter: 12pt, ${leftCell}, ${rightCell})
]`;
}

function modernLayout(model, t) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const g = groupSections(model);
  const sidebarCell = [...g.customs, ...g.tools, ...g.education]
    .map((s) => renderSidebarSection(s, t)).filter(Boolean).join('\n\n');
  const mainCell = [...g.summary, ...g.experience]
    .map((s) => renderSection(s, t)).filter(Boolean).join('\n\n');
  const grid = `#grid(columns: (1.8in, 1fr), column-gutter: 14pt,
  block(fill: rgb("${t.sidebarBg}"), inset: 12pt, width: 100%, height: 100%)[
${sidebarCell}
],
  block(inset: (left: 4pt))[
${mainCell}
])`;
  return [preamble(model, t), renderModernGradientHeader(header, t), grid, ''].join('\n\n');
}

// Compact layout: sidebar layout SCALED DOWN (smaller fonts, tighter margins/spacing).
// Mirrors renderResumeCompact in renderer.js + .compact-* in resume.css:
//   grid-template-columns: 1fr var(--sidebar-width, 2in)  → main LEFT, sidebar RIGHT
//   compact-main emitted first in HTML → main cell FIRST in Typst source order.
// Partition: main = summary + experience; sidebar = customs + tools + education.
// Reduced sizes: base ×0.88, name/tagline ×0.85, sectionGap ×0.75, tighter insets.
function compactLayout(model, t) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const g = groupSections(model);
  // Scale-down theme for compact sizing (mirrors .compact-* CSS size reductions)
  const ct = {
    ...t,
    baseSizePt:    t.baseSizePt * 0.88,
    nameSizePt:    t.nameSizePt * 0.85,
    taglineSizePt: t.taglineSizePt * 0.85,
    sectionGapPt:  t.sectionGapPt * 0.75,
  };
  const mainCell = [...g.summary, ...g.experience]
    .map((s) => renderSection(s, ct)).filter(Boolean).join('\n\n');
  const sidebarCell = [...g.customs, ...g.tools, ...g.education]
    .map((s) => renderSidebarSection(s, ct)).filter(Boolean).join('\n\n');
  const grid = `#grid(columns: (1fr, ${ct.sidebarWidthIn}in), column-gutter: 12pt,
  block(inset: (right: 4pt))[
${mainCell}
],
  block(fill: rgb("${ct.sidebarBg}"), inset: 10pt, width: 100%, height: 100%)[
${sidebarCell}
])`;
  return [preamble(model, ct), renderGradientHeader(header, ct), grid, ''].join('\n\n');
}

// Stacked-vertical layout: single column, every section is a boxed card.
// Custom sections are split: highlight customs (type !== 'skills') rendered before
// skills customs (type === 'skills'). Mirrors renderResumeStackedVertical in renderer.js +
// .stacked-vertical-section in resume.css (background: var(--sidebar-bg), border-radius: 8px).
// The accent underline rule is intentionally omitted (mirrors ::after { display:none } in CSS).
function splitCustoms(customs) {
  return {
    highlights: customs.filter((s) => s.attrs?.type !== 'skills'),
    skills:     customs.filter((s) => s.attrs?.type === 'skills'),
  };
}

function renderBoxedSection(section, t) {
  const heading = renderRuns(childContent(section, 'heading'));
  const body = blocksOf(section)
    .filter((n) => n.type !== 'heading')
    .map((b) => renderBlock(b, t))
    .filter(Boolean)
    .join('\n\n');
  const inner = [
    `#text(font: "${t.fontDisplay}", weight: "bold", fill: accent)[${heading}]`,
    body,
  ].filter(Boolean).join('\n\n');
  return `#block(fill: rgb("${t.sidebarBg}"), radius: 8pt, inset: 8pt, width: 100%)[
${inner}
]`;
}

function stackedVerticalLayout(model, t) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const g = groupSections(model);
  const { highlights, skills } = splitCustoms(g.customs);
  const ordered = [...g.summary, ...highlights, ...skills, ...g.experience, ...g.education, ...g.tools];
  const body = ordered.map((s) => renderBoxedSection(s, t)).filter(Boolean).join('\n\n');
  return [preamble(model, t), renderHeader(header, t), body, ''].join('\n\n');
}

// Executive layout: centered gradient header, pulled-out italic summary block (sidebar-bg),
// then a wide (1fr, 2.2in) grid. Mirrors renderResumeExecutive in renderer.js +
// .executive-* in resume.css (linear-gradient header, executive-summary centered italic,
// executive-columns: 1fr 2.2in; main = experience, side = customs + education + tools).
function executiveLayout(model, t) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const g = groupSections(model);

  // Pulled-out summary block — only if there is a summary section.
  // Mirrors .executive-summary: sidebar-bg background, centered, italic text.
  let summaryBlock = '';
  if (g.summary.length) {
    const summarySection = g.summary[0];
    const paragraphs = (summarySection.content ?? [])
      .filter((n) => n.type !== 'heading')
      .map((b) => {
        if (b.type === 'paragraph') return renderRuns(b.content ?? []);
        return renderBlock(b, t);
      })
      .filter(Boolean)
      .join(' ');
    summaryBlock = `#block(fill: rgb("${t.sidebarBg}"), inset: 10pt, width: 100%)[#align(center)[#emph[${paragraphs}]]]`;
  }

  // Main cell: experience labeled "Professional Experience" (via renderClassicSection).
  const mainCell = g.experience.map((s) => renderClassicSection(s, t)).filter(Boolean).join('\n\n');

  // Side cell: customs + education + tools rendered as sidebar sections.
  const sideCell = [...g.customs, ...g.education, ...g.tools]
    .map((s) => renderSidebarSection(s, t)).filter(Boolean).join('\n\n');

  const grid = `#grid(columns: (1fr, 2.2in), column-gutter: 14pt,
  block(inset: (right: 4pt))[
${mainCell}
],
  block(fill: rgb("${t.sidebarBg}"), inset: 12pt, width: 100%, height: 100%)[
${sideCell}
])`;

  return [preamble(model, t), renderGradientHeader(header, t), summaryBlock, grid, ''].filter(Boolean).join('\n\n');
}

const LAYOUTS = { stacked: stackedLayout, sidebar: sidebarLayout, classic: classicLayout, 'right-sidebar': rightSidebarLayout, modern: modernLayout, compact: compactLayout, 'stacked-vertical': stackedVerticalLayout, executive: executiveLayout };

export function modelToTypst(model, { theme, layout = 'stacked' } = {}) {
  const fn = LAYOUTS[layout] ?? LAYOUTS.stacked;
  return fn(model, theme);
}
