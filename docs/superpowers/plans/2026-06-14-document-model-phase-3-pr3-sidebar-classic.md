# Phase 3 PR 3.3 — Sidebar + classic layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the **core-3** Typst layouts by adding **sidebar** (two-column grid — the default layout, and the case where the model-order reading guarantee actually matters) and **classic** (single-column, traditional) to the generator, reusing `theme.js` and the ATS harness from PR 3.2. **Non-behavioral** (nothing imports the generator outside tests; the running app is unchanged).

**Architecture:** Each layout *rearranges* the model's sections — so the generator gains a per-layout **arrangement** step plus a layout **dispatch**. A shared `groupSections(model)` buckets sections by `sectionKind`; each layout template arranges those buckets to match its `renderer.js` function and emits them in **source order = that layout's reading order**:
- **stacked** (done, unchanged): sections in model order.
- **sidebar**: gradient header, then `#grid(sidebar-column, main-column)` where sidebar = `[customs…, tools]` and main = `[summary, experience, education]`. Sidebar content precedes main in source order → ATS reads sidebar-then-main.
- **classic**: solid centered header, then `summary → experience → education → customs → tools`, with hardcoded "Professional …" labels.

**Tech Stack:** vitest (jsdom), the local `typst` CLI 0.14.2, `pdfjs-dist`. Commands run from `resume-designer/`. The on-screen references to MIRROR: `renderResume` (sidebar) and `renderResumeClassic` in `src/renderer.js`, with `styles/resume.css`.

---

## Reference facts (from renderer.js + resume.css — cite these; mirror them)

**Sidebar** (`renderResume` renderer.js:166; `renderSidebar` ~454):
- Header: gradient `linear-gradient(135deg, var(--header-bg) 0%, var(--header-bg-end) 100%)`, white text (resume.css:54-63).
- Grid: `grid-template-columns: var(--sidebar-width, 2.4in) 1fr` (resume.css:113-120).
- Sidebar column (`.resume-sidebar`, resume.css:126-134): `background: var(--sidebar-bg)`; holds **all custom `sections[]`, then Tools**; titles use `<h3 class="sidebar-title">` — display font, `0.8rem`, **uppercase**, `letter-spacing:0.08em`, accent color, accent `border-bottom: 2px` (resume.css:139-149).
- Main column (`.resume-main`): **Summary, Experience, Education**, `<h2 class="section-title">` (labels "Summary"/"Experience").

**Classic** (`renderResumeClassic` renderer.js:716):
- Header `.classic-header` (resume.css:923-929): centered, **solid `var(--header-bg)`, NO gradient**, white text, corner triangle hidden.
- Body single-column (`.classic-body` block): **"Professional Summary" → "Professional Experience" → Education → custom sections → Tools** (all `<h2 class="section-title">`). Custom/Tools content render as inline flex chips `.classic-skill-item` (`background: var(--sidebar-bg)`, `border-radius:4px`, `0.75rem`) (resume.css:996-1012).

**Tools:** `toolsAreBulleted(data) = data.toolsDisplay !== 'skills'` (default bulleted). In the MODEL, tools are a `tagGroup`; render the tags (the existing `renderTags` from PR 3.2 is fine for both — a `toolsDisplay`-driven bulleted vs inline refinement can come later; note it).

---

## File Structure

| File | Change |
|---|---|
| `resume-designer/src/typst/generate.js` | layout dispatch + `groupSections` + `sidebarLayout` + `classicLayout` |
| `resume-designer/src/typst/theme.js` | expose `fontScale` (so layout templates can scale rem sizes) |
| `resume-designer/test/typstTheme.test.js` | + fontScale assertion |
| `resume-designer/test/typstGenerate.test.js` | + dispatch / sidebar / classic tests + snapshots |
| `resume-designer/test/typstAtsOrder.test.js` | + sidebar reading-order case |

One commit per task. Conventional Commits (lowercase subject — **do not start the subject with an all-caps word**, e.g. write "sidebar layout" not "Sidebar layout"; body lines ≤100; `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` footer). Explicit `git add <paths>` — never `-a`. Do NOT push; do NOT touch `next`/`main`. The `typst` compile gate from PR 3.2 applies to each new layout: **do not commit a layout until its generated `.typ` compiles** (exit 0).

---

### Task 1: Layout dispatch + `groupSections` + theme `fontScale` (non-behavioral refactor)

**Files:** Modify `src/typst/generate.js`, `src/typst/theme.js`; tests `test/typstGenerate.test.js`, `test/typstTheme.test.js`.

Extract the current stacked body into `stackedLayout`, add a dispatch keyed on `opts.layout` (default + unknown → stacked, so all PR-3.2 tests/snapshot stay identical), add `groupSections`, and expose `fontScale` from the theme.

- [ ] **Step 1: Write the failing tests**

In `test/typstGenerate.test.js`, add to the existing `describe('modelToTypst — preamble & header', …)` (or a new describe) — reuse the `model`/`theme` already defined in that file:
```js
  it('defaults to the stacked layout and falls back for an unknown layout', () => {
    const base = modelToTypst(model('auto'), { theme });
    expect(modelToTypst(model('auto'), { theme, layout: 'stacked' })).toBe(base);
    expect(modelToTypst(model('auto'), { theme, layout: 'nope' })).toBe(base); // unknown → stacked
  });
```
In `test/typstTheme.test.js`, add to `describe('buildTheme', …)`:
```js
  it('exposes fontScale for layout size scaling', () => {
    expect(buildTheme({}).fontScale).toBe(1);
    expect(buildTheme({ spacing: { fontScale: 1.5 } }).fontScale).toBe(1.5);
  });
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/typstGenerate.test.js test/typstTheme.test.js` → the new cases fail (`layout` ignored; `fontScale` undefined).

- [ ] **Step 3: Implement**

In `src/typst/theme.js`, add `fontScale,` to the returned token object (it's already computed as the local `fontScale`).

In `src/typst/generate.js`, (a) rename the current `modelToTypst` body into a `stackedLayout(model, theme)` function (identical body), (b) add `groupSections`, (c) add the dispatch:
```js
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

const LAYOUTS = { stacked: stackedLayout }; // sidebar/classic registered in Tasks 2–3

export function modelToTypst(model, { theme, layout = 'stacked' } = {}) {
  const fn = LAYOUTS[layout] ?? LAYOUTS.stacked;
  return fn(model, theme);
}
```

- [ ] **Step 4: Run to verify PASS** — `npx vitest run test/typstGenerate.test.js test/typstTheme.test.js`. All pass, including the **existing stacked snapshot unchanged** (the refactor is output-identical for stacked).

- [ ] **Step 5: Commit**

```bash
git add src/typst/generate.js src/typst/theme.js test/typstGenerate.test.js test/typstTheme.test.js
git commit -m "feat(typst): layout dispatch and section grouping" -m "Extract stackedLayout, add a layout-keyed dispatch (default/unknown -> stacked,
output identical), a groupSections helper, and expose fontScale from the theme.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Sidebar layout

**Files:** Modify `src/typst/generate.js`, `test/typstGenerate.test.js`, `test/typstAtsOrder.test.js`.

Add `sidebarLayout` and register it. Gradient header (white text), then a two-column `#grid`: the sidebar column (colored fill, `[customs…, tools]`, h3 accent-uppercase titles) BEFORE the main column (`[summary, experience, education]`, h2 titles). Emit sidebar content first in source order → ATS reads sidebar-then-main. Mirror `renderResume` + the resume.css rules quoted above; tune sizes via `theme.fontScale` (sidebar-title = `0.8rem`).

- [ ] **Step 1: Write the failing tests**

Append to `test/typstGenerate.test.js`:
```js
describe('modelToTypst — sidebar', () => {
  const theme2 = buildTheme({});
  const m = flatToModel({
    name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
    summary: 'S.', sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
    experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['v2'] }],
    tools: 'Figma • git',
  });
  it('emits a grid and puts the sidebar (Skills, Tools) before main (Summary, Experience)', () => {
    const typ = modelToTypst(m, { theme: theme2, layout: 'sidebar' });
    expect(typ).toContain('#grid(');
    const iSkills = typ.indexOf('#"Skills"');
    const iTools = typ.indexOf('#"Tools"');
    const iSummary = typ.indexOf('#"Summary"');
    const iExp = typ.indexOf('#"Experience"');
    expect(iSkills).toBeGreaterThanOrEqual(0);
    expect(iSkills).toBeLessThan(iSummary);   // sidebar column before main column
    expect(iTools).toBeLessThan(iSummary);
    expect(iSummary).toBeLessThan(iExp);
  });
  it('uses the gradient header fill', () => {
    expect(modelToTypst(m, { theme: theme2, layout: 'sidebar' })).toContain('gradient.linear');
  });
  it('matches the recorded sidebar snapshot', () => {
    expect(modelToTypst(m, { theme: theme2, layout: 'sidebar' })).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/typstGenerate.test.js` → sidebar cases fail (layout falls back to stacked: no `#grid`, wrong order).

- [ ] **Step 3: Implement** in `src/typst/generate.js`. Deterministic skeleton (then tune visuals to mirror `renderResume`/resume.css — gradient angle 135deg, sidebar bg, h3 uppercase accent titles, paddings):
```js
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
```
(The sidebar title uses Typst's `#upper[…]`, mirroring `.sidebar-title { text-transform: uppercase }`.) Register it: `const LAYOUTS = { stacked: stackedLayout, sidebar: sidebarLayout };`.

- [ ] **Step 4: Run + inspect snapshot** — `npx vitest run test/typstGenerate.test.js` → sidebar cases pass; snapshot records. Open `test/__snapshots__/typstGenerate.test.js.snap`, confirm the sidebar entry is well-formed Typst with sidebar content (Skills, Tools) before main (Summary, Experience).

- [ ] **Step 4b: COMPILE GATE** — generate the sidebar output and compile (ESM snippet; the project is ESM):
```bash
node --input-type=module -e "import {modelToTypst} from './src/typst/generate.js'; import {buildTheme} from './src/typst/theme.js'; import {flatToModel} from './src/migrateToModel.js'; import {writeFileSync} from 'node:fs'; const m=flatToModel({name:'Ada',tagline:'P',contact:{email:'a@x.com'},summary:'S.',sections:[{id:'s',title:'Skills',type:'skills',content:['Rust','Go']}],experience:[{id:'e',title:'Eng',company:'Acme',dates:'2020',bullets:['v2']}],tools:'Figma'}); writeFileSync('/tmp/rd_sidebar.typ', modelToTypst(m,{theme:buildTheme({}),layout:'sidebar'}));"
typst compile /tmp/rd_sidebar.typ /tmp/rd_sidebar.pdf && echo COMPILE_OK || echo COMPILE_FAILED
```
Must print `COMPILE_OK` (unknown-font warnings are fine). If it fails, read the typst error, fix the generator, re-run tests + this gate. Update the snapshot (`-u`) if a fix changes output, and re-inspect.

- [ ] **Step 5: Add the sidebar ATS reading-order case** in `test/typstAtsOrder.test.js` — inside the existing `describe.skipIf(...)`, add:
```js
  it('sidebar PDF text stream reads sidebar-then-main (not column-interleaved)', async () => {
    const model = flatToModel({
      name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
      summary: 'First programmer.',
      sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
      experience: [{ id: 'e', title: 'Collaborator', company: 'Analytical Engine', dates: '1842', bullets: ['Authored Note G.'] }],
      tools: 'Figma',
    });
    const typ = modelToTypst(model, { theme: buildTheme({}), layout: 'sidebar' });
    const dir = mkdtempSync(join(tmpdir(), 'rd-ats-sb-'));
    const typPath = join(dir, 'r.typ'); const pdfPath = join(dir, 'r.pdf');
    writeFileSync(typPath, typ);
    execFileSync('typst', ['compile', typPath, pdfPath]);
    const text = await extractText(pdfPath);
    // Sidebar (Skills, Rust, Tools) must all precede main (Summary, Experience).
    const order = ['Ada Lovelace', 'Skills', 'Rust', 'Summary', 'Experience', 'Collaborator'];
    const positions = order.map((tok) => ({ tok, at: text.indexOf(tok) }));
    for (const { tok, at } of positions) expect(at, `"${tok}" missing`).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i].at, `"${positions[i].tok}" should follow "${positions[i - 1].tok}"`).toBeGreaterThan(positions[i - 1].at);
    }
  });
```
Run `npx vitest run test/typstAtsOrder.test.js` → both ATS cases pass (RAN, not skipped). If the order assertion fails, the sidebar source order is wrong (main leaking before sidebar, or columns interleaved) — fix `sidebarLayout`.

- [ ] **Step 6: Commit**

```bash
git add src/typst/generate.js test/typstGenerate.test.js test/typstAtsOrder.test.js test/__snapshots__/typstGenerate.test.js.snap
git commit -m "feat(typst): sidebar layout with two-column grid" -m "Gradient header + #grid(sidebar | main): custom sections and tools in the
colored sidebar, summary/experience/education in main. ATS test proves the PDF
reads sidebar-then-main, not column-interleaved.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Classic layout

**Files:** Modify `src/typst/generate.js`, `test/typstGenerate.test.js`.

Add `classicLayout` and register it. Solid centered header (no gradient, white text on `headerBg`), single column: Summary → Experience → Education → customs → Tools, with hardcoded labels "Professional Summary" / "Professional Experience". Mirror `renderResumeClassic`/resume.css.

- [ ] **Step 1: Write the failing tests** — append to `test/typstGenerate.test.js`:
```js
describe('modelToTypst — classic', () => {
  const t3 = buildTheme({});
  const m = flatToModel({
    name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
    summary: 'S.', sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust'] }],
    experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['v2'] }],
    education: ['BSc — MIT — 2018'], tools: 'Figma',
  });
  it('uses the Professional Summary/Experience labels and a solid (non-gradient) header', () => {
    const typ = modelToTypst(m, { theme: t3, layout: 'classic' });
    expect(typ).toContain('#"Professional Summary"');
    expect(typ).toContain('#"Professional Experience"');
    expect(typ).not.toContain('gradient.linear');     // solid header, no gradient
  });
  it('orders summary → experience → education → custom → tools', () => {
    const typ = modelToTypst(m, { theme: t3, layout: 'classic' });
    const at = (s) => typ.indexOf(s);
    expect(at('#"Professional Summary"')).toBeLessThan(at('#"Professional Experience"'));
    expect(at('#"Professional Experience"')).toBeLessThan(at('#"Education"'));
    expect(at('#"Education"')).toBeLessThan(at('#"Skills"'));   // custom after education
    expect(at('#"Skills"')).toBeLessThan(at('#"Tools"'));
  });
  it('matches the recorded classic snapshot', () => {
    expect(modelToTypst(m, { theme: t3, layout: 'classic' })).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/typstGenerate.test.js` → classic cases fail (falls back to stacked).

- [ ] **Step 3: Implement** in `src/typst/generate.js` (tune visuals to mirror `renderResumeClassic`):
```js
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
```
Register: `const LAYOUTS = { stacked: stackedLayout, sidebar: sidebarLayout, classic: classicLayout };`. (Note: `#"Professional Summary"` is emitted as a literal string label here — that's fine since it's generator-controlled, not user text; user text still goes through `escapeTypstString`.)

- [ ] **Step 4: Run + inspect snapshot** — `npx vitest run test/typstGenerate.test.js` → classic cases pass; inspect the recorded classic snapshot for well-formed Typst.

- [ ] **Step 4b: COMPILE GATE** — compile the classic output:
```bash
node --input-type=module -e "import {modelToTypst} from './src/typst/generate.js'; import {buildTheme} from './src/typst/theme.js'; import {flatToModel} from './src/migrateToModel.js'; import {writeFileSync} from 'node:fs'; const m=flatToModel({name:'Ada',tagline:'P',contact:{email:'a@x.com'},summary:'S.',sections:[{id:'s',title:'Skills',type:'skills',content:['Rust']}],experience:[{id:'e',title:'Eng',company:'Acme',dates:'2020',bullets:['v2']}],education:['BSc'],tools:'Figma'}); writeFileSync('/tmp/rd_classic.typ', modelToTypst(m,{theme:buildTheme({}),layout:'classic'}));"
typst compile /tmp/rd_classic.typ /tmp/rd_classic.pdf && echo COMPILE_OK || echo COMPILE_FAILED
```
Must print `COMPILE_OK`. Fix + re-run on failure; update snapshot if output changes.

- [ ] **Step 5: Commit**

```bash
git add src/typst/generate.js test/typstGenerate.test.js test/__snapshots__/typstGenerate.test.js.snap
git commit -m "feat(typst): classic single-column layout" -m "Solid centered header (no gradient); summary/experience/education then custom
sections and tools; hardcoded Professional Summary/Experience labels.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all 3 tasks)

- [ ] **Full suite green:** `npm test` — all prior tests + the new dispatch/sidebar/classic cases + the second ATS case pass.
- [ ] **Lint + build clean:** `npm run lint` and `npm run build`.
- [ ] **All three core-3 layouts compile:** `/tmp/rd_stacked.pdf`, `/tmp/rd_sidebar.pdf`, `/tmp/rd_classic.pdf` all produced by the real typst CLI.
- [ ] **Non-behavioral:** still nothing outside `src/typst/**` + tests imports the generator; the running app is byte-identical (only `main.js`'s palette import from PR 3.2 touches production).

---

## Notes / known minor gaps (out of scope; revisit in a fidelity pass or later PR)

- **Stacked tools position:** the stacked layout still emits sections in model order (tools last), whereas `renderResumeStacked` groups custom + tools in a responsive grid right after the summary. Coherent + ATS-valid, but not a pixel-match. Deferred.
- **Tools bulleted vs inline** (`toolsDisplay`) and the classic inline skill-chip backgrounds: rendered simply for now; refine when the export screen lands if visual review asks for it.
- **Section heading sizes per layout:** anchored to base/name/tagline + `fontScale`; fine-grained per-element sizes can be lifted from resume.css as visual review demands.

## Self-review notes (author)
- **Spec coverage:** design spec §4.5 (sidebar + classic templates), §11/§13 (ATS test extended to the multi-column case — the architecturally important guarantee). Completes core-3. ✓
- **No placeholders:** dispatch, `groupSections`, arrangement, label overrides, and the ATS cases have exact code; layout *visuals* are delegated with a concrete mirror reference + a hard compile gate + snapshot + ATS verification (the contract that worked for stacked in 3.2). ✓
- **Consistency:** `groupSections` buckets and the per-layout arrangements are used consistently; `theme.fontScale` (added Task 1) is consumed by the Task-2/3 templates; the `LAYOUTS` map grows by one entry per task. ✓
