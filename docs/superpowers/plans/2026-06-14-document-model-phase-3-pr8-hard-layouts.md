# Phase 3 PR 3.8 — Port timeline + creative to Typst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the final 2 layouts — `timeline` and `creative` — to the Typst generator, taking coverage to **11 of 11**. Each needs a NEW Typst construct (not a variant of the core machinery): timeline draws a **dot/line rail** for the experience section; creative lays custom/tools sections in a **fixed N-column card grid** (Typst has no CSS `auto-fit`). **Non-behavioral** beyond export routing — after this PR every layout exports via Typst, so the `pdf.js` router never falls back to WKWebView capture anymore (router code unchanged; `TYPST_LAYOUTS.has(activeLayout())` is now always true).

**Architecture:** Add one `<layout>Layout(model, theme)` per layout to `src/typst/generate.js`, register in `LAYOUTS`, add the id to `TYPST_LAYOUTS` in `src/typstExport.js`. Reuse helpers from PR 3.2–3.7: `groupSections`, `renderGradientHeader`, `renderSolidCenteredHeader`, `renderSection`, `renderSidebarSection`, `renderExperienceItem`, `renderBlock`, `renderRuns`, `childContent`, `blocksOf`, `preamble`. Four small NEW helpers: `renderTimelineSection` (the rail), `renderGradientCenteredHeader` (centered + gradient), `renderCreativeCard` (sidebar-bg card with a 3pt left accent border), `renderCreativeSection` (a section whose heading is centered).

**Tech Stack:** vitest, `typst` CLI 0.14.2, `pdfjs-dist`. Run all commands from `resume-designer/`.

## On-screen references to MIRROR (read these — the mirror-and-compile contract from PR 3.3/3.6/3.7)

- **`timeline`** — `renderResumeTimeline` (`src/renderer.js:935`), `renderTimelineExperience` (`src/renderer.js:985`), `renderSidebar` (`src/renderer.js:454`); CSS `.timeline-*` (`styles/resume.css:1168–1243`).
  - Gradient header (`.timeline-header` = `linear-gradient(135deg, header-bg, header-bg-end)`).
  - Body is a 2-col grid `grid-template-columns: 1fr var(--sidebar-width, 2.2in)` → **main LEFT (1fr), sidebar RIGHT**. Main emitted first in the DOM → reading order is **main-then-sidebar** (same as `right-sidebar`/`compact`).
  - Main = summary (`Summary`) + experience (as the timeline rail) + education (`Education`).
  - Sidebar = `renderSidebar(data)` = custom sections + tools.
  - The experience rail: each item = `.timeline-item` with a `.timeline-marker` (`.timeline-dot` = 10px accent circle, `.timeline-line` = 2px vertical accent→transparent gradient) + `.timeline-content` (title/company/dates + bullets — identical to `renderExperienceItem`).
- **`creative`** — `renderResumeCreative` (`src/renderer.js:1013`), `renderCreativeSectionContent` (`src/renderer.js:94`), `renderExperience` (`src/renderer.js:514`); CSS `.creative-*` (`styles/resume.css:1249–1318`).
  - **Centered** gradient header (`.creative-header` = `text-align: center` + `linear-gradient(135deg, …)`).
  - Single-column `creative-body` flow: centered italic summary (`.creative-summary`, no heading) → `.creative-grid` (cards) → experience (full width, centered title) → education.
  - `.creative-grid` = `repeat(auto-fit, minmax(180px, 1fr))` of `.creative-card`s. Cards = **every** custom section (the renderer iterates all `data.sections`, no skills/list split) **plus** a `Tools` card. `.creative-card` = `background: sidebar-bg; border-radius: 8px; border-left: 3px solid accent`. `.creative-card-title` = display font, accent, `0.85rem`.

## Shared notes

- **Compile gate applies** (NEVER commit a layout that doesn't compile). After implementing each layout, write a `.typ` via the ESM node snippet and `typst compile … && echo COMPILE_OK` → exit 0. Fix until COMPILE_OK before committing.
- Both layouts are multi-column in the PDF text stream (timeline grid; creative card grid), so **each gets an ATS reading-order case** in `test/typstAtsOrder.test.js`.
- Each task adds the id to BOTH `LAYOUTS` (`generate.js`) and `TYPST_LAYOUTS` (`typstExport.js`) — keep them in **lockstep**.
- Snapshots live in `test/__snapshots__/typstGenerate.test.js.snap`. New `toMatchSnapshot()` assertions write on first run; `npx vitest run -u test/typstGenerate.test.js` to (re)record after inspecting. **`git add` the updated snapshot file** with the source.
- Commit conventions: lowercase Conventional subject (NOT starting with an all-caps word — `subject-case` rejects a leading `ATS …`), body lines ≤100, footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Explicit `git add <paths>`; **no `-a`/`.`**. No push; never touch `next`/`main`.
- **ESM compile-gate snippet** (run from `resume-designer/`, substitute the layout id + tmp filename):

```bash
node --input-type=module -e "
import { flatToModel } from './src/migrateToModel.js';
import { modelToTypst } from './src/typst/generate.js';
import { buildTheme } from './src/typst/theme.js';
import { writeFileSync } from 'node:fs';
const m = flatToModel({ name:'Ada Lovelace', tagline:'Pioneer', contact:{ email:'ada@x.com' },
  summary:'First programmer.',
  sections:[{ id:'s', title:'Skills', type:'skills', content:['Rust','Go'] }],
  experience:[{ id:'e', title:'Collaborator', company:'Analytical Engine', dates:'1842', bullets:['Authored Note G.'] }],
  education:['BSc — Cambridge'], tools:'Figma' });
writeFileSync('/tmp/timeline.typ', modelToTypst(m, { theme: buildTheme({}), layout: 'timeline' }));
"
typst compile --font-path src-tauri/fonts /tmp/timeline.typ /tmp/timeline.pdf && echo COMPILE_OK
```

---

### Task 1: `timeline` (gradient header + main-left timeline rail + right sidebar)

**Files:** `src/typst/generate.js`, `src/typstExport.js`, `test/typstGenerate.test.js`, `test/typstAtsOrder.test.js`, `test/__snapshots__/typstGenerate.test.js.snap`.

- [ ] **Step 1: Write the failing generator tests** — append to `test/typstGenerate.test.js`:

```js
describe('modelToTypst — timeline', () => {
  const t = buildTheme({});
  const m = flatToModel({
    name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
    summary: 'First programmer.',
    sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust'] }],
    experience: [{ id: 'e', title: 'Collaborator', company: 'Acme', dates: '2020', bullets: ['v2'] }],
    education: ['BSc'],
    tools: 'Figma',
  });

  it('emits a 2-column #grid(', () => {
    expect(modelToTypst(m, { theme: t, layout: 'timeline' })).toContain('#grid(');
  });

  it('draws a dot (#circle) and a left-stroke rail for the experience section', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'timeline' });
    expect(typ).toContain('#circle(');
    expect(typ).toContain('stroke: (left:');
  });

  it('reads main-then-sidebar in source order (Summary → Experience → sidebar Skills)', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'timeline' });
    const at = (s) => typ.indexOf(s);
    expect(at('#"Summary"')).toBeGreaterThanOrEqual(0);
    expect(at('#"Experience"')).toBeGreaterThanOrEqual(0);
    expect(at('#"Skills"')).toBeGreaterThanOrEqual(0);
    expect(at('#"Summary"')).toBeLessThan(at('#"Experience"'));
    expect(at('#"Experience"')).toBeLessThan(at('#"Skills"')); // sidebar after main
  });

  it('uses a gradient (not solid) header', () => {
    expect(modelToTypst(m, { theme: t, layout: 'timeline' })).toContain('gradient.linear');
  });

  it('matches the recorded timeline snapshot', () => {
    expect(modelToTypst(m, { theme: t, layout: 'timeline' })).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/typstGenerate.test.js -t timeline`
Expected: FAIL — `timeline` falls back to `stacked` (no `#grid(`, no `#circle(`, no sidebar order).

- [ ] **Step 3: Implement** in `src/typst/generate.js`.

Add the rail-section helper (place it after `renderExperienceItem`, near the other section renderers):

```js
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
#place(top + left, dx: -18pt, dy: 2pt, circle(radius: 3.5pt, fill: accent))
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
```

Add the layout function (mirrors `rightSidebarLayout`, but experience uses `renderTimelineSection`):

```js
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
  const grid = `#grid(columns: (1fr, ${t.sidebarWidthIn}in), column-gutter: 14pt,
  block(inset: (right: 4pt))[
${mainCell}
],
  block(fill: rgb("${t.sidebarBg}"), inset: 12pt, width: 100%, height: 100%)[
${sidebarCell}
])`;
  return [preamble(model, t), renderGradientHeader(header, t), grid, ''].join('\n\n');
}
```

Register in the `LAYOUTS` map (add `timeline: timelineLayout`):

```js
const LAYOUTS = { stacked: stackedLayout, sidebar: sidebarLayout, classic: classicLayout, 'right-sidebar': rightSidebarLayout, modern: modernLayout, compact: compactLayout, 'stacked-vertical': stackedVerticalLayout, executive: executiveLayout, 'classic-featured': classicFeaturedLayout, timeline: timelineLayout };
```

Add `'timeline'` to `TYPST_LAYOUTS` in `src/typstExport.js`:

```js
export const TYPST_LAYOUTS = new Set(['sidebar', 'stacked', 'classic', 'right-sidebar', 'modern', 'compact', 'stacked-vertical', 'executive', 'classic-featured', 'timeline']);
```

- [ ] **Step 4: Run generator tests to verify they pass**

Run: `npx vitest run test/typstGenerate.test.js -t timeline`
Expected: PASS (snapshot written on first run — open the `.snap` and eyeball the timeline block: a `#block(… stroke: (left: 1.5pt + accent))[ #stack(… block[ #place(… circle …) … ]) ]`).

- [ ] **Step 4b: Compile gate** — run the ESM snippet (Shared notes) for `timeline` → `typst compile --font-path src-tauri/fonts /tmp/timeline.typ /tmp/timeline.pdf && echo COMPILE_OK`. Must print `COMPILE_OK`. If `#place`/`#circle`/`#stack` syntax errors, fix and re-record the snapshot (`npx vitest run -u test/typstGenerate.test.js -t timeline`).

- [ ] **Step 5: ATS reading-order case** — append to `test/typstAtsOrder.test.js` (inside the `describe.skipIf(...)` block, alongside the others):

```js
  it('timeline reads main-then-sidebar (Summary/Experience before SKILLS/Rust)', async () => {
    const model = flatToModel({
      name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
      summary: 'First programmer.',
      sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
      experience: [{ id: 'e', title: 'Collaborator', company: 'Analytical Engine', dates: '1842', bullets: ['Authored Note G.'] }],
      tools: 'Figma',
    });
    const typ = modelToTypst(model, { theme: buildTheme({}), layout: 'timeline' });
    const dir = mkdtempSync(join(tmpdir(), 'rd-ats-tl-'));
    const typPath = join(dir, 'r.typ'); const pdfPath = join(dir, 'r.pdf');
    writeFileSync(typPath, typ);
    execFileSync('typst', ['compile', typPath, pdfPath]);
    const text = await extractText(pdfPath);
    // main (Summary/Experience) emitted before sidebar; sidebar titles use #upper -> UPPERCASE
    const order = ['Ada Lovelace', 'Summary', 'Experience', 'Collaborator', 'SKILLS', 'Rust'];
    const pos = order.map((tok) => ({ tok, at: text.indexOf(tok) }));
    for (const { tok, at } of pos) expect(at, `"${tok}" missing`).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < pos.length; i++) expect(pos[i].at, `"${pos[i].tok}" after "${pos[i-1].tok}"`).toBeGreaterThan(pos[i-1].at);
  });
```

Run: `npx vitest run test/typstAtsOrder.test.js`
Expected: PASS, all cases RAN (not skipped — `typst` is on PATH).

- [ ] **Step 6: Commit** (5 files)

```bash
git add src/typst/generate.js src/typstExport.js test/typstGenerate.test.js test/typstAtsOrder.test.js test/__snapshots__/typstGenerate.test.js.snap
git commit -m "$(cat <<'EOF'
feat(typst): timeline layout (dot/line rail experience)

Port the timeline layout: gradient header, main-left/sidebar-right grid, and the
experience section as a continuous accent rail (a left-stroked #block) with each
job's dot #place()d onto it. Takes Typst coverage to 10 of 11.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `creative` (centered gradient header + centered summary + fixed N-col card grid)

**Files:** `src/typst/generate.js`, `src/typstExport.js`, `test/typstGenerate.test.js`, `test/typstAtsOrder.test.js`, `test/__snapshots__/typstGenerate.test.js.snap`.

- [ ] **Step 1: Write the failing generator tests** — append to `test/typstGenerate.test.js`:

```js
describe('modelToTypst — creative', () => {
  const t = buildTheme({});
  const m = flatToModel({
    name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
    summary: 'S.',
    sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust'] }],
    experience: [{ id: 'e', title: 'Collaborator', company: 'Acme', dates: '2020', bullets: ['v2'] }],
    education: ['BSc'],
    tools: 'Figma',
  });

  it('uses a centered gradient header', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'creative' });
    expect(typ).toContain('gradient.linear');
    expect(typ).toContain('#align(center)');
  });

  it('renders the summary centered + italic BEFORE the card grid', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'creative' });
    const iSummary = typ.indexOf('#"S."');
    const iGrid = typ.indexOf('#grid(');
    expect(iSummary).toBeGreaterThanOrEqual(0);
    expect(iGrid).toBeGreaterThanOrEqual(0);
    expect(iSummary).toBeLessThan(iGrid);
    expect(typ).toContain('#emph[');
  });

  it('emits a fixed-column card grid with a 3pt left accent border', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'creative' });
    expect(typ).toContain('#grid(');
    expect(typ).toContain('stroke: (left: 3pt'); // creative-card border-left
    expect(typ).toContain('radius: 8pt');        // rounded card
  });

  it('includes a Tools card and orders cards → Experience → Education', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'creative' });
    const at = (s) => typ.indexOf(s);
    expect(at('#"Tools"')).toBeGreaterThanOrEqual(0);
    expect(at('#grid(')).toBeLessThan(at('#"Experience"'));
    expect(at('#"Experience"')).toBeLessThan(at('#"Education"'));
  });

  it('matches the recorded creative snapshot', () => {
    expect(modelToTypst(m, { theme: t, layout: 'creative' })).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/typstGenerate.test.js -t creative`
Expected: FAIL (falls back to stacked — no centered gradient header, no card grid).

- [ ] **Step 3: Implement** in `src/typst/generate.js`.

Add the centered gradient header (place next to `renderSolidCenteredHeader`):

```js
// Centered gradient header (mirrors .creative-header: text-align center + linear-gradient).
function renderGradientCenteredHeader(header, t) {
  const name = renderRuns(childContent(header, 'name'));
  const tagline = renderRuns(childContent(header, 'tagline'));
  const contacts = (childOfType(header, 'contactList')?.content ?? [])
    .filter((n) => n.type === 'contactItem').map((ci) => renderRuns(ci.content)).filter(Boolean).join(' #" • " ');
  return `#block(width: 100%, fill: gradient.linear(angle: 135deg, rgb("${t.headerBg}"), rgb("${t.headerBgEnd}")), inset: 16pt)[#align(center)[
  #text(font: "${t.fontDisplay}", size: ${t.nameSizePt}pt, weight: "bold", fill: white)[${name}]

  #text(size: ${t.taglineSizePt}pt, fill: white)[${tagline}]
${contacts ? `\n  #text(size: ${(8 * t.fontScale).toFixed(2)}pt, fill: white)[${contacts}]` : ''}
]]`;
}
```

Add the creative card (a grid CELL — returns `block(...)[...]` with NO leading `#`, like the other grid cells), and a centered-heading section for the experience block:

```js
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
```

Add the layout function:

```js
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

  return [preamble(model, t), renderGradientCenteredHeader(header, t), summaryBlock, gridBlock, exp, edu, '']
    .filter(Boolean).join('\n\n');
}
```

Register `creative: creativeLayout` in `LAYOUTS`, and add `'creative'` to `TYPST_LAYOUTS` in `src/typstExport.js` (now **all 11 ids**):

```js
const LAYOUTS = { stacked: stackedLayout, sidebar: sidebarLayout, classic: classicLayout, 'right-sidebar': rightSidebarLayout, modern: modernLayout, compact: compactLayout, 'stacked-vertical': stackedVerticalLayout, executive: executiveLayout, 'classic-featured': classicFeaturedLayout, timeline: timelineLayout, creative: creativeLayout };
```

```js
export const TYPST_LAYOUTS = new Set(['sidebar', 'stacked', 'classic', 'right-sidebar', 'modern', 'compact', 'stacked-vertical', 'executive', 'classic-featured', 'timeline', 'creative']);
```

- [ ] **Step 4: Run generator tests to verify they pass**

Run: `npx vitest run test/typstGenerate.test.js -t creative`
Expected: PASS (inspect the snapshot — centered gradient header, `#align(center)[#emph[…]]` summary, a `#grid(columns: (1fr, 1fr), …)` of `block(… stroke: (left: 3pt + accent) …)` cards, then a centered "Experience" heading).

- [ ] **Step 4b: Compile gate** — ESM snippet for `creative` → `typst compile --font-path src-tauri/fonts /tmp/creative.typ /tmp/creative.pdf && echo COMPILE_OK`. Must print `COMPILE_OK`. Re-record snapshot if changed.

- [ ] **Step 5: ATS reading-order case** — append to `test/typstAtsOrder.test.js`:

```js
  it('creative reads: summary → cards → experience → education', async () => {
    const model = flatToModel({
      name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
      summary: 'First programmer.',
      sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
      experience: [{ id: 'e', title: 'Collaborator', company: 'Analytical Engine', dates: '1842', bullets: ['Authored Note G.'] }],
      education: ['BSc Cambridge'],
      tools: 'Figma',
    });
    const typ = modelToTypst(model, { theme: buildTheme({}), layout: 'creative' });
    const dir = mkdtempSync(join(tmpdir(), 'rd-ats-cr-'));
    const typPath = join(dir, 'r.typ'); const pdfPath = join(dir, 'r.pdf');
    writeFileSync(typPath, typ);
    execFileSync('typst', ['compile', typPath, pdfPath]);
    const text = await extractText(pdfPath);
    // creative card titles are NOT #upper -> normal case ('Skills'); experience full-width below the grid
    const order = ['Ada Lovelace', 'First programmer', 'Skills', 'Experience', 'Collaborator', 'BSc'];
    const pos = order.map((tok) => ({ tok, at: text.indexOf(tok) }));
    for (const { tok, at } of pos) expect(at, `"${tok}" missing`).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < pos.length; i++) expect(pos[i].at, `"${pos[i].tok}" after "${pos[i-1].tok}"`).toBeGreaterThan(pos[i-1].at);
  });
```

Run: `npx vitest run test/typstAtsOrder.test.js`
Expected: PASS, all cases RAN. (If the grid's row-major order ever places `Tools` before `Skills`, that's fine — the test asserts section-level order, not intra-grid card order.)

- [ ] **Step 6: Commit** (5 files)

```bash
git add src/typst/generate.js src/typstExport.js test/typstGenerate.test.js test/typstAtsOrder.test.js test/__snapshots__/typstGenerate.test.js.snap
git commit -m "$(cat <<'EOF'
feat(typst): creative layout (card grid)

Port the creative layout: centered gradient header, centered italic summary, a
fixed N-column card grid (N = min(3, cardCount), since Typst has no CSS auto-fit)
of custom + tools sections with a 3pt left accent border, then full-width
experience + education. Completes Typst coverage at 11 of 11 layouts.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification (after both tasks)

- [ ] **Full suite + lint + build green:** `npx vitest run` (all green), `npm run lint`, `npm run build`.
- [ ] **All 11 layouts compile** via the typst CLI (write each via the ESM snippet, loop the 11 ids, `typst compile` each → exit 0).
- [ ] **ATS suite passes, all cases RAN** (`npx vitest run test/typstAtsOrder.test.js` — including the new timeline + creative cases; none skipped).
- [ ] **`TYPST_LAYOUTS` has all 11 ids;** no layout falls back to capture (the `pdf.js` router now always routes Tauri → Typst — no router edit needed, verify by reading `src/pdf.js`).
- [ ] **commitlint** `npx commitlint --from <plan-commit-sha> --to HEAD` exits 0.
- [ ] **Final whole-PR review** (spec compliance + code quality) + hand the Tauri visual check (timeline + creative) to the user.

## Notes

- After this PR, **all 11 layouts are on Typst** → the next PR (the **capture-path cleanup**, deferred) can retire the WKWebView `generatePdfNative`/print-window path and simplify the router (Tauri → always Typst). `renderer.js`/`inlineEditor.js` STAY (on-screen render/edit). Keep the browser-build `html2pdf` fallback.

## Self-review notes (author)

- **Spec coverage:** design spec §11 (incremental layout coverage). timeline reuses the right-sidebar grid shape + `renderExperienceItem`, adding only the rail; creative reuses `groupSections`/`renderBlock`/`renderSection`, adding the card grid + 3 small header/card/centered-section helpers. ✓
- **No placeholders:** every new helper + layout fn is complete code; the only delegated tuning is the dot `dx`/`dy` offset (visual, guarded by the compile gate + the user's Tauri review), explicitly flagged. ✓
- **Type/name consistency:** `renderTimelineSection`, `renderGradientCenteredHeader`, `renderCreativeCard`, `renderCreativeSection`, `timelineLayout`, `creativeLayout` are referenced exactly as defined; `LAYOUTS` ↔ `TYPST_LAYOUTS` updated together in both tasks; grid cells (`renderCreativeCard`) return `block(...)` with no leading `#`, matching existing `#grid()` cell usage. ✓
- **Capability gap handled:** CSS `auto-fit` → explicit `Math.min(3, cardCount)` column count computed in JS (Typst has no responsive track count). ✓
