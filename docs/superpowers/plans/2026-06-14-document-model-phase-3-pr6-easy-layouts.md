# Phase 3 PR 3.6 — Port the 4 "easy" layouts to Typst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Typst generator from the core-3 layouts to **7 of the 11** by adding the 4 "easy" variants — `right-sidebar`, `stacked-vertical`, `compact`, `modern` — and routing them to the Typst export screen. Each is a thin variant of an existing template (column swap / narrower column / scaled sizes / boxed cards), reusing the helpers from PR 3.2–3.3. **Non-behavioral** beyond the export routing (these layouts now export via Typst instead of WKWebView capture; the medium/hard layouts still use capture).

**Architecture:** Add one `<layout>Layout(model, theme)` function per layout to `src/typst/generate.js`, register it in the `LAYOUTS` map, and add the id to `TYPST_LAYOUTS` in `src/typstExport.js` (so the `pdf.js` router sends it to the Typst screen). Reuse `groupSections`, `renderGradientHeader`, `renderSidebarSection`, `renderSection`, `renderBlock`, `preamble`. The on-screen references to MIRROR (in `src/renderer.js` + `styles/resume.css`):
- `right-sidebar` (`renderResumeRightSidebar`): sidebar with columns swapped — `grid(1fr, sidebarWidth)`, **main cell first** (summary/experience/education), then sidebar cell (customs, tools).
- `stacked-vertical` (`renderResumeStackedVertical`): single column — summary → highlight customs → skills customs → experience → education → tools, each section a **boxed card** (`sidebar-bg` bg, rounded). Splits customs into highlights (non-skills) vs skills.
- `compact` (`renderResumeCompact`): sidebar, **scaled down** — main = [summary, experience]; sidebar = [customs, education, tools]; smaller fonts/margins.
- `modern` (`renderResumeModern`): sidebar with a **narrow sidebar** (1.8in) + horizontal gradient header — sidebar = [customs, education]; main = [summary, experience].

**Tech Stack:** vitest, the local `typst` CLI 0.14.2, `pdfjs-dist`. Commands run from `resume-designer/`.

---

## Shared notes for every task
- **Reading order = source order.** For the 2-column layouts, whichever cell is emitted first in source is read first. right-sidebar/compact/modern read **main-then-sidebar OR sidebar-then-main per the renderer** — match the renderer's DOM order (right-sidebar = main first; compact/modern = sidebar first, like core sidebar). The ATS test asserts the chosen order.
- **Custom-section split (stacked-vertical):** a custom section's model node carries `attrs.type` (`'skills'` vs `'list'`/other). Split `groupSections(model).customs` into skills (`attrs.type === 'skills'`) and non-skills via a small local helper.
- **Verify each layout COMPILES** (typst CLI) before committing — the PR 3.2/3.3 compile gate applies.
- Each task: add the layout fn + register in `LAYOUTS` (generate.js) + add the id to `TYPST_LAYOUTS` (typstExport.js) + a snapshot + targeted assertions + a compile check; multi-column layouts also get an ATS reading-order case.
- Commit conventions: lowercase Conventional subject (no leading all-caps word), body ≤100, `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` footer. Explicit `git add`; no `-a`. Do NOT push; do NOT touch `next`/`main`.

---

### Task 1: `right-sidebar` (sidebar, columns swapped)

**Files:** `src/typst/generate.js`, `src/typstExport.js`, `test/typstGenerate.test.js`, `test/typstAtsOrder.test.js`.

- [ ] **Step 1: Failing tests** — append to `test/typstGenerate.test.js`:
```js
describe('modelToTypst — right-sidebar', () => {
  const t = buildTheme({});
  const m = flatToModel({ name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' }, summary: 'S.',
    sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust'] }],
    experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['v2'] }], tools: 'Figma' });
  it('emits a grid and reads main (Summary, Experience) BEFORE sidebar (Skills, Tools)', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'right-sidebar' });
    expect(typ).toContain('#grid(');
    const at = (s) => typ.indexOf(s);
    expect(at('#"Summary"')).toBeLessThan(at('#"SKILLS"') >= 0 ? at('#"SKILLS"') : at('#"Skills"'));
    expect(at('#"Experience"')).toBeLessThan(at('#"Tools"') >= 0 ? at('#"Tools"') : at('#"TOOLS"'));
  });
  it('matches the recorded right-sidebar snapshot', () => {
    expect(modelToTypst(m, { theme: t, layout: 'right-sidebar' })).toMatchSnapshot();
  });
});
```
- [ ] **Step 2:** `npx vitest run test/typstGenerate.test.js` → FAIL (falls back to stacked; no grid).
- [ ] **Step 3: Implement** `rightSidebarLayout(model, t)` in `generate.js` — like `sidebarLayout` but: emit the **main cell first**, sidebar cell second, with `grid(columns: (1fr, ${t.sidebarWidthIn}in), ...)`. Main = `[...g.summary, ...g.experience, ...g.education]` via `renderSection`; sidebar = `[...g.customs, ...g.tools]` via `renderSidebarSection` (colored fill). Keep the gradient header (`renderGradientHeader`). Register `'right-sidebar': rightSidebarLayout` in `LAYOUTS`, and add `'right-sidebar'` to `TYPST_LAYOUTS` in `src/typstExport.js`.
- [ ] **Step 4: Pass + inspect snapshot.** `npx vitest run test/typstGenerate.test.js` → pass.
- [ ] **Step 4b: Compile gate** (ESM snippet writing `modelToTypst(m,{theme:buildTheme({}),layout:'right-sidebar'})` to `/tmp/rs.typ`, then `typst compile /tmp/rs.typ /tmp/rs.pdf` → exit 0). Fix until it compiles.
- [ ] **Step 5: ATS case** — add to `test/typstAtsOrder.test.js` (inside the `describe.skipIf`): generate right-sidebar, compile, extract, assert main tokens precede sidebar tokens (e.g. order `['Ada Lovelace','Summary','Experience','SKILLS']` — note `#upper` uppercases sidebar titles). Run → passes (RAN, not skipped).
- [ ] **Step 6: Commit** — `git add src/typst/generate.js src/typstExport.js test/typstGenerate.test.js test/typstAtsOrder.test.js test/__snapshots__/typstGenerate.test.js.snap`
```
feat(typst): right-sidebar layout (columns swapped)
```
body: "Mirror renderResumeRightSidebar: grid(1fr, sidebar) with the main column emitted before the sidebar; reads main-then-sidebar. Routed to the Typst screen."

---

### Task 2: `modern` (narrow sidebar + horizontal header)

**Files:** `src/typst/generate.js`, `src/typstExport.js`, `test/typstGenerate.test.js`, `test/typstAtsOrder.test.js`.

`modern` = sidebar with a 1.8in sidebar and a horizontal gradient header (name/tagline left, contact right). Sidebar = `[...g.customs, ...g.education]`; main = `[...g.summary, ...g.experience]`. Confirm the exact partition + header against `renderResumeModern` + resume.css `.modern-*`.

- [ ] **Step 1: Failing tests** — append a `describe('modelToTypst — modern', …)` mirroring Task 1's shape: assert `#grid(` present, sidebar (Skills) before main (Summary/Experience) in source order, and a snapshot.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `modernLayout(model, t)` — a `renderHorizontalGradientHeader` (or parameterize `renderGradientHeader` for the horizontal/contact-right layout) + `grid(columns: (1.8in, 1fr), ...)` with sidebar cell (`[...g.customs, ...g.education]`, `renderSidebarSection`) first, then main (`[...g.summary, ...g.experience]`, `renderSection`). Register in `LAYOUTS` + add `'modern'` to `TYPST_LAYOUTS`.
- [ ] **Step 4 + 4b:** pass + snapshot inspect + compile gate (`/tmp/modern.typ`).
- [ ] **Step 5: ATS case** — sidebar-then-main order.
- [ ] **Step 6: Commit** — `feat(typst): modern layout (narrow sidebar)`.

---

### Task 3: `compact` (sidebar, scaled down)

**Files:** `src/typst/generate.js`, `src/typstExport.js`, `test/typstGenerate.test.js`, `test/typstAtsOrder.test.js`.

`compact` = sidebar, smaller. Main = `[...g.summary, ...g.experience]`; sidebar = `[...g.customs, ...g.education, ...g.tools]`. Scale fonts/margins/spacing down (mirror `renderResumeCompact` + `.compact-*` sizes — e.g. main section titles ~`0.9rem`, condensed margins). The cleanest approach: a per-layout scale factor applied to the emitted sizes (or smaller local size constants), keeping the same sidebar structure.

- [ ] **Step 1: Failing tests** — `describe('modelToTypst — compact', …)`: `#grid(` present, sidebar (Skills, Education) before main, snapshot.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `compactLayout(model, t)` — like `sidebarLayout` with the compact partition (education in the sidebar) + reduced sizes/insets. Register + add to `TYPST_LAYOUTS`.
- [ ] **Step 4 + 4b:** pass + inspect + compile gate (`/tmp/compact.typ`).
- [ ] **Step 5: ATS case.**
- [ ] **Step 6: Commit** — `feat(typst): compact layout (condensed sidebar)`.

---

### Task 4: `stacked-vertical` (boxed cards, single column)

**Files:** `src/typst/generate.js`, `src/typstExport.js`, `test/typstGenerate.test.js`.

`stacked-vertical` = single column: summary → highlight customs → skills customs → experience → education → tools, each section a boxed card (`fill: rgb(sidebarBg)`, rounded, inset). Split customs by `attrs.type === 'skills'`. (Single column → reading order is trivial; a snapshot + compile suffice — no new ATS case needed, though you may add one.)

- [ ] **Step 1: Failing tests** — `describe('modelToTypst — stacked-vertical', …)`: assert the order summary → (highlight custom) → (skills custom) → experience → education → tools via `indexOf`, that section cards use `fill: rgb("` (the boxed background), and a snapshot. Use a model with one `type:'list'` custom (highlight) AND one `type:'skills'` custom to exercise the split.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `stackedVerticalLayout(model, t)` + a local `splitCustoms(customs)` → `{ highlights, skills }` by `attrs.type`. Render each section inside a `#block(fill: rgb("${t.sidebarBg}"), radius: 8pt, inset: ...)[ ... ]`. Order: summary, highlights, skills, experience, education, tools. Register + add `'stacked-vertical'` to `TYPST_LAYOUTS`.
- [ ] **Step 4 + 4b:** pass + inspect + compile gate (`/tmp/sv.typ`).
- [ ] **Step 5: Commit** — `feat(typst): stacked-vertical layout (boxed sections)`.

---

## Final verification (after all 4 tasks)
- [ ] **Full suite + lint + build green:** `npm test`, `npm run lint`, `npm run build`.
- [ ] **All 7 supported layouts compile** via the typst CLI; the ATS suite (now covering the multi-column additions) passes, all cases RAN.
- [ ] **`TYPST_LAYOUTS` has 7 ids** (sidebar, stacked, classic, right-sidebar, modern, compact, stacked-vertical) — confirm the router sends exactly these to the Typst screen; the remaining 4 (executive, classic-featured, timeline, creative) still fall back to capture.
- [ ] **commitlint** `--from <plan-commit> --to HEAD` exits 0.
- [ ] **Final whole-PR review** + hand the Tauri visual check (the 4 new layouts) to the user.

## Notes
- **MEDIUM/HARD deferred:** executive + classic-featured → PR 3.7; timeline + creative → PR 3.8 (need new Typst constructs: a timeline rail, an auto-fit card grid). Once all 11 are ported, a cleanup PR retires the WKWebView capture path.
- Each layout's exact partition + sizes are lifted from its `renderResume*` function + the `.<layout>-*` CSS during implementation (the mirror-and-compile contract from PR 3.3).

## Self-review notes (author)
- **Spec coverage:** design spec §11 (expand layout coverage incrementally); each new layout reuses the §4.5 template machinery. ✓
- **No placeholders:** the arrangement (buckets per layout) + the helpers to reuse + the register steps are concrete; the visual tuning is delegated with a mirror reference + the hard compile gate + snapshot + ATS (the contract proven in 3.3). ✓
- **Consistency:** every task adds its id to BOTH `LAYOUTS` (generate.js dispatch) and `TYPST_LAYOUTS` (router) — keep them in lockstep or the router and generator disagree. ✓
