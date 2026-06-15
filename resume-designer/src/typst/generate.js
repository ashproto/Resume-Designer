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
// Full-bleed: no outer page margin, so colored headers/sidebars reach the paper
// edge (matching the on-screen design). The configured margins are applied as
// INTERNAL padding via pagePad/headerPad and the sidebar grid insets below.
function pageRule(pageSize) {
  return PAPER[pageSize]
    ? `#set page(paper: "${PAPER[pageSize]}", margin: 0pt)`
    : `#set page(width: 8.5in, height: auto, margin: 0pt)`;
}

function preamble(model, t) {
  return [
    pageRule(model.attrs?.pageSize ?? 'auto'),
    `#set text(font: "${t.fontBody}", size: ${t.baseSizePt}pt, fill: rgb("${t.textColor}"))`,
    `#set par(leading: ${(t.lineHeight - 1).toFixed(3)}em, justify: false)`,
    `#let accent = rgb("${t.accent}")`,
  ].join('\n');
}

// Full-bleed page model helpers: the configured margins become INTERNAL padding.
const pagePad = (t) => `(top: ${t.marginTopIn}in, bottom: ${t.marginBottomIn}in, left: ${t.marginLeftIn}in, right: ${t.marginRightIn}in)`;
const headerPad = (t) => `(top: ${t.marginTopIn}in, bottom: 0.28in, left: ${t.marginLeftIn}in, right: ${t.marginRightIn}in)`;
// Wrap single-column body content so its text is padded by the margins while
// colored headers above it stay full-bleed. `above: 0pt` keeps it flush against
// the header (the colored header sets `below: 0pt`).
function bodyWrap(content, t) {
  return `#block(width: 100%, above: 0pt, inset: ${pagePad(t)})[
${content}
]`;
}
// Place a (grid) block flush below the full-bleed header — no inter-block gap,
// still breakable across pages for multi-page résumés.
function flushBelowHeader(content) {
  return `#block(width: 100%, above: 0pt, breakable: true)[
${content}
]`;
}
// Per-column inset for two-column (sidebar) grids: POSITION-based — the LEFT
// column gets the left page margin + an inner gutter; the RIGHT column the inner
// gutter + the right page margin. Which column is the colored sidebar is decided
// by the grid's `fill`, independent of these insets.
function gridInset(t) {
  const inner = '0.18in';
  const left = `(top: ${t.marginTopIn}in, bottom: ${t.marginBottomIn}in, left: ${t.marginLeftIn}in, right: ${inner})`;
  const right = `(top: ${t.marginTopIn}in, bottom: ${t.marginBottomIn}in, left: ${inner}, right: ${t.marginRightIn}in)`;
  return `(col, row) => if col == 0 { ${left} } else { ${right} }`;
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
  const body = bodyWrap([renderHeader(header, theme), ...sections].join('\n\n'), theme);
  return [preamble(model, theme), body, ''].join('\n\n');
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
  return `#block(width: 100%, fill: gradient.linear(angle: 135deg, rgb("${t.headerBg}"), rgb("${t.headerBgEnd}")), inset: ${headerPad(t)}, below: 0pt)[
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
  const grid = `#grid(columns: (${t.sidebarWidthIn}in, 1fr),
  fill: (col, row) => if col == 0 { rgb("${t.sidebarBg}") } else { none },
  inset: ${gridInset(t)},
  [
${sidebarCell}
],
  [
${mainCell}
])`;
  return [preamble(model, t), renderGradientHeader(header, t), flushBelowHeader(grid), ''].join('\n\n');
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
  return `#block(width: 100%, fill: rgb("${t.headerBg}"), inset: ${headerPad(t)}, below: 0pt)[#align(center)[
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
  const body = bodyWrap(ordered.map((s) => renderClassicSection(s, t)).filter(Boolean).join('\n\n'), t);
  return [preamble(model, t), renderSolidCenteredHeader(header, t), body, ''].join('\n\n');
}

function rightSidebarLayout(model, t) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const g = groupSections(model);
  const mainCell = [...g.summary, ...g.experience, ...g.education].map((s) => renderSection(s, t)).filter(Boolean).join('\n\n');
  const sidebarCell = [...g.customs, ...g.tools].map((s) => renderSidebarSection(s, t)).filter(Boolean).join('\n\n');
  const grid = `#grid(columns: (1fr, ${t.sidebarWidthIn}in),
  fill: (col, row) => if col == 1 { rgb("${t.sidebarBg}") } else { none },
  inset: ${gridInset(t)},
  [
${mainCell}
],
  [
${sidebarCell}
])`;
  return [preamble(model, t), renderGradientHeader(header, t), flushBelowHeader(grid), ''].join('\n\n');
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
  return `#block(width: 100%, fill: gradient.linear(angle: 135deg, rgb("${t.headerBg}"), rgb("${t.headerBgEnd}")), inset: ${headerPad(t)}, below: 0pt)[
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
  const grid = `#grid(columns: (1.8in, 1fr),
  fill: (col, row) => if col == 0 { rgb("${t.sidebarBg}") } else { none },
  inset: ${gridInset(t)},
  [
${sidebarCell}
],
  [
${mainCell}
])`;
  return [preamble(model, t), renderModernGradientHeader(header, t), flushBelowHeader(grid), ''].join('\n\n');
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
  const grid = `#grid(columns: (1fr, ${ct.sidebarWidthIn}in),
  fill: (col, row) => if col == 1 { rgb("${ct.sidebarBg}") } else { none },
  inset: ${gridInset(ct)},
  [
${mainCell}
],
  [
${sidebarCell}
])`;
  return [preamble(model, ct), renderGradientHeader(header, ct), flushBelowHeader(grid), ''].join('\n\n');
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
  const sections = ordered.map((s) => renderBoxedSection(s, t)).filter(Boolean).join('\n\n');
  const body = bodyWrap([renderHeader(header, t), sections].join('\n\n'), t);
  return [preamble(model, t), body, ''].join('\n\n');
}

// Classic-featured layout: solid centered header (same as classic), single column.
// Order: summary → highlights (boxed non-skills customs) → experience → education
//        → skills (skills customs, at the bottom) → tools.
// Mirrors renderResumeClassicFeatured in renderer.js + .classic-featured-* in resume.css.
// Highlights rendered as boxed cards (renderBoxedSection); skills rendered plain (renderClassicSection).
function classicFeaturedLayout(model, t) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const g = groupSections(model);
  const { highlights, skills } = splitCustoms(g.customs);
  const parts = [
    ...g.summary.map((s) => renderClassicSection(s, t)),
    ...highlights.map((s) => renderBoxedSection(s, t)),
    ...g.experience.map((s) => renderClassicSection(s, t)),
    ...g.education.map((s) => renderClassicSection(s, t)),
    ...skills.map((s) => renderClassicSection(s, t)),
    ...g.tools.map((s) => renderSection(s, t)),
  ].filter(Boolean);
  return [preamble(model, t), renderSolidCenteredHeader(header, t), bodyWrap(parts.join('\n\n'), t), ''].join('\n\n');
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
    summaryBlock = `#block(fill: rgb("${t.sidebarBg}"), inset: ${headerPad(t)}, width: 100%, below: 0pt)[#align(center)[#emph[${paragraphs}]]]`;
  }

  // Main cell: experience labeled "Professional Experience" (via renderClassicSection).
  const mainCell = g.experience.map((s) => renderClassicSection(s, t)).filter(Boolean).join('\n\n');

  // Side cell: customs + tools + education (matches the renderer + modern/compact order).
  const sideCell = [...g.customs, ...g.tools, ...g.education]
    .map((s) => renderSidebarSection(s, t)).filter(Boolean).join('\n\n');

  const grid = `#grid(columns: (1fr, 2.2in),
  fill: (col, row) => if col == 1 { rgb("${t.sidebarBg}") } else { none },
  inset: ${gridInset(t)},
  [
${mainCell}
],
  [
${sideCell}
])`;

  return [preamble(model, t), renderGradientHeader(header, t), summaryBlock, flushBelowHeader(grid), ''].filter(Boolean).join('\n\n');
}

// Timeline experience section: heading + accent rule, then a continuous accent
// rail. The rail is one #block with a left stroke; each experience item is a
// child block that #place()s its dot (#circle) out-of-flow onto the rail (the
// dot overflows left into the inset — no dynamic-height math needed).
// Mirrors .timeline-container/.timeline-marker/.timeline-dot/.timeline-line +
// renderTimelineExperience (renderer.js).
function renderTimelineSection(section, t) {
  const heading = renderRuns(childContent(section, 'heading'));
  const items = blocksOf(section).filter((n) => n.type === 'experienceItem');
  const rail = items
    .map((it) => `block(width: 100%)[
#place(top + left, dx: -18pt, dy: 2pt)[#circle(radius: 3.5pt, fill: accent)]
${renderExperienceItem(it, t)}
]`)
    .join(',\n');
  return [
    `#text(font: "${t.fontDisplay}", weight: "bold", fill: accent)[${heading}]`,
    '#line(length: 100%, stroke: 0.5pt + accent)',
    `#block(width: 100%, inset: (left: 14pt), stroke: (left: 1.5pt + accent))[
#stack(spacing: 10pt,
${rail}
)
]`,
  ].join('\n\n');
}

// Timeline layout: gradient header, main-left (1fr) / sidebar-right grid (same
// shape as right-sidebar). Main = summary + experience-as-timeline + education;
// sidebar = customs + tools. Mirrors renderResumeTimeline + .timeline-* CSS.
function timelineLayout(model, t) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const g = groupSections(model);
  const mainCell = [
    ...g.summary.map((s) => renderSection(s, t)),
    ...g.experience.map((s) => renderTimelineSection(s, t)),
    ...g.education.map((s) => renderSection(s, t)),
  ].filter(Boolean).join('\n\n');
  const sidebarCell = [...g.customs, ...g.tools]
    .map((s) => renderSidebarSection(s, t)).filter(Boolean).join('\n\n');
  const grid = `#grid(columns: (1fr, ${t.sidebarWidthIn}in),
  fill: (col, row) => if col == 1 { rgb("${t.sidebarBg}") } else { none },
  inset: ${gridInset(t)},
  [
${mainCell}
],
  [
${sidebarCell}
])`;
  return [preamble(model, t), renderGradientHeader(header, t), flushBelowHeader(grid), ''].join('\n\n');
}

// Centered gradient header (mirrors .creative-header: text-align center + linear-gradient).
function renderGradientCenteredHeader(header, t) {
  const name = renderRuns(childContent(header, 'name'));
  const tagline = renderRuns(childContent(header, 'tagline'));
  const contacts = (childOfType(header, 'contactList')?.content ?? [])
    .filter((n) => n.type === 'contactItem').map((ci) => renderRuns(ci.content)).filter(Boolean).join(' #" • " ');
  return `#block(width: 100%, fill: gradient.linear(angle: 135deg, rgb("${t.headerBg}"), rgb("${t.headerBgEnd}")), inset: ${headerPad(t)}, below: 0pt)[#align(center)[
  #text(font: "${t.fontDisplay}", size: ${t.nameSizePt}pt, weight: "bold", fill: white)[${name}]

  #text(size: ${t.taglineSizePt}pt, fill: white)[${tagline}]
${contacts ? `\n  #text(size: ${(8 * t.fontScale).toFixed(2)}pt, fill: white)[${contacts}]` : ''}
]]`;
}

// Creative card: sidebar-bg rounded block with a 3pt left accent border, a
// display/accent title, then the section body. Returned WITHOUT a leading "#"
// because it is used as a #grid() cell. Mirrors .creative-card + .creative-card-title.
function renderCreativeCard(section, t) {
  const heading = renderRuns(childContent(section, 'heading'));
  const body = blocksOf(section)
    .filter((n) => n.type !== 'heading')
    .map((b) => renderBlock(b, t)).filter(Boolean).join('\n\n');
  const inner = [
    `#text(font: "${t.fontDisplay}", size: ${(0.85 * 12 * t.fontScale).toFixed(2)}pt, weight: "bold", fill: accent)[${heading}]`,
    body,
  ].filter(Boolean).join('\n\n');
  return `block(fill: rgb("${t.sidebarBg}"), radius: 8pt, inset: 8pt, stroke: (left: 3pt + accent), width: 100%)[
${inner}
]`;
}

// Like renderSection, but the heading is centered (mirrors
// .creative-experience .section-title { text-align: center }).
function renderCreativeSection(section, t) {
  const heading = renderRuns(childContent(section, 'heading'));
  const body = blocksOf(section).filter((n) => n.type !== 'heading').map((b) => renderBlock(b, t)).filter(Boolean);
  return [
    `#align(center)[#text(font: "${t.fontDisplay}", weight: "bold", fill: accent)[${heading}]]`,
    '#line(length: 100%, stroke: 0.5pt + accent)',
    ...body,
  ].join('\n\n');
}

// Creative layout: centered gradient header, centered italic summary (no
// heading), a fixed N-column card grid of custom + tools sections (Typst has no
// CSS auto-fit; N = min(3, cardCount)), then full-width experience (centered
// title) + education. Mirrors renderResumeCreative + .creative-* CSS.
function creativeLayout(model, t) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const g = groupSections(model);

  // Centered italic summary — mirrors .creative-summary (no section heading).
  let summaryBlock = '';
  if (g.summary.length) {
    const paras = (g.summary[0].content ?? [])
      .filter((n) => n.type !== 'heading')
      .map((b) => (b.type === 'paragraph' ? renderRuns(b.content ?? []) : renderBlock(b, t)))
      .filter(Boolean).join(' ');
    summaryBlock = `#align(center)[#emph[${paras}]]`;
  }

  // Card grid: every custom section + a tools card. Fixed N columns (no auto-fit).
  const cardSections = [...g.customs, ...g.tools];
  let gridBlock = '';
  if (cardSections.length) {
    const cards = cardSections.map((s) => renderCreativeCard(s, t));
    const ncol = Math.min(3, cards.length);
    const cols = Array(ncol).fill('1fr').join(', ');
    gridBlock = `#grid(columns: (${cols}), column-gutter: 10pt, row-gutter: 10pt,
${cards.join(',\n')}
)`;
  }

  const exp = g.experience.map((s) => renderCreativeSection(s, t)).filter(Boolean).join('\n\n');
  const edu = g.education.map((s) => renderSection(s, t)).filter(Boolean).join('\n\n');

  const bodyContent = [summaryBlock, gridBlock, exp, edu].filter(Boolean).join('\n\n');
  return [preamble(model, t), renderGradientCenteredHeader(header, t), bodyWrap(bodyContent, t), '']
    .filter(Boolean).join('\n\n');
}

const LAYOUTS = { stacked: stackedLayout, sidebar: sidebarLayout, classic: classicLayout, 'right-sidebar': rightSidebarLayout, modern: modernLayout, compact: compactLayout, 'stacked-vertical': stackedVerticalLayout, executive: executiveLayout, 'classic-featured': classicFeaturedLayout, timeline: timelineLayout, creative: creativeLayout };

export function modelToTypst(model, { theme, layout = 'stacked' } = {}) {
  const fn = LAYOUTS[layout] ?? LAYOUTS.stacked;
  return fn(model, theme);
}
