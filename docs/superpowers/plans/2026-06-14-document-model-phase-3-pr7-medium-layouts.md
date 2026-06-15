# Phase 3 PR 3.7 — Port executive + classic-featured to Typst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the 2 "medium" layouts — `executive` and `classic-featured` — to the Typst generator, taking coverage to **9 of 11**. Each adds one new structural idea on top of the core-3 machinery: executive has a **pulled-out, centered summary block** before a wide grid; classic-featured **boxes its highlights** after the summary and pushes skills to the bottom. **Non-behavioral** beyond export routing (these now export via Typst; the 2 hard layouts still use capture).

**Architecture:** Add one `<layout>Layout(model, theme)` per layout to `src/typst/generate.js`, register in `LAYOUTS`, add the id to `TYPST_LAYOUTS` in `src/typstExport.js`. Reuse the helpers from PR 3.2–3.6: `groupSections`, `renderGradientHeader`, `renderSolidCenteredHeader`, `renderSidebarSection`, `renderSection`, `renderClassicSection` + `CLASSIC_LABELS`, `renderBoxedSection`, `splitCustoms`, `preamble`. The on-screen references to MIRROR (`src/renderer.js` + `styles/resume.css`):
- `executive` (`renderResumeExecutive`): centered header; **summary pulled out** as a centered, italic, `sidebar-bg`-backed block BEFORE the grid; then `grid(1fr, 2.2in)` with main = experience (label "Professional Experience"), side = customs + education + tools.
- `classic-featured` (`renderResumeClassicFeatured`): centered solid header; order **summary ("Professional Summary") → highlights (boxed) → experience ("Professional Experience") → education → skills (bottom) → tools**; single column. Highlights = custom non-skills (boxed group); skills = custom skills (at the bottom).

**Tech Stack:** vitest, `typst` CLI 0.14.2, `pdfjs-dist`. Run from `resume-designer/`.

## Shared notes
- VERIFY each layout's exact header style (gradient vs solid), partition, sizes, and label overrides against its `renderResume*` function + `.executive-*` / `.classic-featured-*` CSS — the mirror-and-compile contract from PR 3.3/3.6.
- `splitCustoms(customs)` → `{ highlights, skills }` (by `attrs?.type === 'skills'`) already exists (PR 3.6 Task 4). `renderBoxedSection` (boxed card, no accent rule) also exists. `CLASSIC_LABELS = { summary: 'Professional Summary', experience: 'Professional Experience' }` exists.
- **Compile gate** applies (don't commit a layout that doesn't compile). Multi-column `executive` gets an ATS reading-order case; single-column `classic-featured` gets a snapshot + compile.
- Each task adds the id to BOTH `LAYOUTS` (generate.js) and `TYPST_LAYOUTS` (typstExport.js) — keep them in lockstep.
- Commit conventions: lowercase Conventional subject, body ≤100, `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` footer. Explicit `git add`; no `-a`. No push; no `next`/`main`.

---

### Task 1: `executive` (centered header + pulled-out summary + wide grid)

**Files:** `src/typst/generate.js`, `src/typstExport.js`, `test/typstGenerate.test.js`, `test/typstAtsOrder.test.js`.

- [ ] **Step 1: Failing tests** — append `describe('modelToTypst — executive', …)` to `test/typstGenerate.test.js` (model with summary + a skills custom + experience + education + tools). Assert: a `#grid(` is present; the summary block appears BEFORE the grid and uses an italic/centered style (e.g. `typ.indexOf('#"S."')` < `typ.indexOf('#grid(')`); experience uses the label `#"Professional Experience"`; a snapshot.
- [ ] **Step 2:** `npx vitest run test/typstGenerate.test.js` → FAIL (falls back to stacked).
- [ ] **Step 3: Implement** `executiveLayout(model, t)`:
  - Header: mirror `renderResumeExecutive`'s centered header (reuse `renderGradientHeader` or `renderSolidCenteredHeader` per the renderer — VERIFY which; executive is centered).
  - **Pulled-out summary:** if `g.summary.length`, render a centered italic boxed block: `#block(fill: rgb("${t.sidebarBg}"), inset: 10pt, width: 100%)[#align(center)[#emph[<summary runs>]]]` (mirror `.executive-summary`).
  - **Grid:** `#grid(columns: (1fr, 2.2in), column-gutter: 14pt, mainCell, sideCell)` where mainCell = experience rendered with the "Professional Experience" label (reuse `renderSection` but override the heading like `renderClassicSection` does for experience, OR call a small helper); sideCell = `[...g.customs, ...g.education, ...g.tools]` via `renderSidebarSection`.
  - Assemble: `[preamble, header, summaryBlock, grid, '']`. Register `'executive': executiveLayout` in `LAYOUTS`; add `'executive'` to `TYPST_LAYOUTS`.
- [ ] **Step 4 + 4b:** PASS + inspect snapshot; **compile gate** (write `/tmp/exec.typ` via the ESM snippet pattern from PR 3.6, `typst compile` → exit 0). Fix until COMPILE_OK; `-u` snapshot if changed.
- [ ] **Step 5: ATS case** — append to `test/typstAtsOrder.test.js`: generate executive, compile, extract, assert order `['Ada Lovelace', 'First programmer', 'Professional Experience', 'Collaborator', ...sideTokens]` (summary, then main experience, then side sections — match your source order). Run → all ATS pass + RAN.
- [ ] **Step 6: Commit** (5 files) — `feat(typst): executive layout (pulled-out summary)`.

---

### Task 2: `classic-featured` (boxed highlights, skills at bottom)

**Files:** `src/typst/generate.js`, `src/typstExport.js`, `test/typstGenerate.test.js`.

- [ ] **Step 1: Failing tests** — append `describe('modelToTypst — classic-featured', …)`. Use a model with a `type:'list'` custom (highlight) AND a `type:'skills'` custom. Assert via `indexOf` the order: `#"Professional Summary"` → highlight title → `#"Professional Experience"` → `#"Education"` → skills title → `#"Tools"`; that the highlights section is boxed (`fill: rgb("`); no `#grid(` (single column); a snapshot.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `classicFeaturedLayout(model, t)` — single column, mirror `renderResumeClassicFeatured`:
  - Header: `renderSolidCenteredHeader` (like classic).
  - `const { highlights, skills } = splitCustoms(g.customs);`
  - Order: summary (`renderClassicSection` → "Professional Summary"), highlights (boxed via `renderBoxedSection`, grouped), experience ("Professional Experience"), education, skills (boxed or plain at the bottom, mirror the renderer), tools.
  - Register `'classic-featured': classicFeaturedLayout` in `LAYOUTS`; add `'classic-featured'` to `TYPST_LAYOUTS`.
- [ ] **Step 4 + 4b:** PASS + inspect snapshot; **compile gate** (`/tmp/cf.typ`). Fix until COMPILE_OK; `-u` if changed.
- [ ] **Step 5: Commit** (4 files — single column, no ATS change needed) — `feat(typst): classic-featured layout (boxed highlights)`.

---

## Final verification (after both tasks)
- [ ] **Full suite + lint + build green.**
- [ ] **All 9 supported layouts compile** via the typst CLI (the 7 from before + executive + classic-featured); the ATS suite passes, all cases RAN.
- [ ] **`TYPST_LAYOUTS` has 9 ids** (the 7 + executive + classic-featured); the remaining 2 (timeline, creative) still fall back to capture.
- [ ] **commitlint** `--from <plan-commit> --to HEAD` exits 0.
- [ ] **Final whole-PR review** + hand the Tauri visual check (the 2 new layouts) to the user.

## Notes
- **HARD layouts deferred to PR 3.8:** timeline (dot/line rail — needs Typst absolute placement or a grid-with-stroke pattern) + creative (auto-fit card grid). Once all 11 are ported, a cleanup PR retires the WKWebView capture path.

## Self-review notes (author)
- **Spec coverage:** design spec §11 (incremental layout coverage); both reuse the §4.5 machinery + the PR-3.6 helpers (`splitCustoms`, `renderBoxedSection`, `CLASSIC_LABELS`). ✓
- **No placeholders:** the arrangement + the new structural bit per layout (pulled-out summary / boxed highlights) + the helpers to reuse + register steps are concrete; visual tuning delegated with a mirror reference + the compile/snapshot/ATS gates. ✓
- **Consistency:** `LAYOUTS` ↔ `TYPST_LAYOUTS` updated together; `splitCustoms`/`renderBoxedSection`/`CLASSIC_LABELS` reused (not re-implemented). ✓
