# Fix Codex P2 review findings on PR #46 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the two verified P2 findings Codex raised on [#46](https://github.com/SiriusA7/Resume-Designer/pull/46): (1) the document-model migration silently drops machine-readable `startDate`/`endDate` on round-trip; (2) the Typst export ignores non-preset (Google/System) font selections. These commits land on `feat/document-model` (updating PR #46) — verify each with the same gates as PR 3.9.

**Architecture:** Four independent tasks, each leaving a green tree. F1 is a self-contained schema+migration round-trip. F2 is three layered pieces: (2) wire the selected font families through `buildTheme`/`resumeTheme` (the actual bug — fixes already-bundled fonts immediately); (3) add system-font resolution to the Rust Typst compile so installed fonts render; (4) vendor the remaining curated Google fonts so `google`-mode picks render without being installed. Order matters: the family passthrough (Task 2) must precede the font-availability work (Tasks 3-4), or neither takes effect.

**Tech Stack:** vitest, prosemirror-model, cargo (typst-as-lib 0.15.5), google-webfonts-helper. JS from `resume-designer/`; Rust from `resume-designer/src-tauri/`.

## Shared notes
- Commit conventions: lowercase Conventional subject NOT starting with an all-caps word; body lines ≤100 (now a *warning*, but keep them ≤100 anyway); footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Explicit `git add <paths>` — never `-a`/`.`. No push; never touch `next`/`main`.
- JS gate: `npx vitest run` green, `npm run lint`, `npm run build`. Rust gate: `cargo check` + `cargo clippy` from `src-tauri/`.
- Keep golden migration round-trips byte-for-byte: new attrs must be emitted **conditionally** (only when present), exactly like `_relevanceRank` is today.

---

### Task 1: F1 — round-trip `startDate`/`endDate` through the model

**Files:** `src/documentModel.js`, `src/migrateToModel.js`, `test/migrateToModel.test.js`.

**Context:** `experienceItem` carries only `{id, relevanceRank}` (documentModel.js:71). AI-tailored/onboarding resumes set machine-readable `startDate`/`endDate` (`aiService.js`, `onboardingLogic.js`); `store.js` uses `endDate` for chronological sort. Since `variant.data` persists as `modelToFlat()` output, those fields vanish on the first save. Fix: carry them as `experienceItem` attrs, conditionally re-emitted.

- [ ] **Step 1: Failing test** — append to `test/migrateToModel.test.js`:

```js
describe('experience startDate/endDate round-trip', () => {
  it('preserves machine-readable dates through flat → model → flat', () => {
    const flat = {
      name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
      experience: [{
        id: 'e1', title: 'Eng', company: 'Acme', dates: 'Jan 2020 – Present',
        startDate: '2020-01', endDate: 'Present', bullets: ['Did X'],
      }],
    };
    const model = flatToModel(flat);
    const back = modelToFlat(model);
    expect(back.experience[0].startDate).toBe('2020-01');
    expect(back.experience[0].endDate).toBe('Present');
  });

  it('omits the date fields when absent (flat shape unchanged for date-less resumes)', () => {
    const flat = {
      name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
      experience: [{ id: 'e1', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['X'] }],
    };
    const back = modelToFlat(flatToModel(flat));
    expect('startDate' in back.experience[0]).toBe(false);
    expect('endDate' in back.experience[0]).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run test/migrateToModel.test.js -t "startDate"` (the dates are dropped today).

- [ ] **Step 3: Schema** — `src/documentModel.js:71`, extend the `experienceItem` attrs:

```js
      attrs: { id: { default: '' }, relevanceRank: { default: null }, startDate: { default: '' }, endDate: { default: '' } },
```

- [ ] **Step 4: Migration** — `src/migrateToModel.js`:
  - `experienceItemNode` (line ~22-24) — add the two attrs:
    ```js
    attrs: {
      id: e.id ?? '',
      relevanceRank: Number.isFinite(e._relevanceRank) ? e._relevanceRank : null,
      startDate: e.startDate ?? '',
      endDate: e.endDate ?? '',
    },
    ```
  - `modelToFlat` experience map (after the `_relevanceRank` line, ~line 125) — re-emit conditionally:
    ```js
    if (Number.isFinite(it.attrs?.relevanceRank)) e._relevanceRank = it.attrs.relevanceRank;
    if (it.attrs?.startDate) e.startDate = it.attrs.startDate;
    if (it.attrs?.endDate) e.endDate = it.attrs.endDate;
    ```

- [ ] **Step 5: Run → PASS** — `npx vitest run test/migrateToModel.test.js` (new tests pass; the existing golden round-trips stay green because absent dates emit nothing).

- [ ] **Step 6: Full gate + commit** — `npx vitest run` green; commit (3 files):

```bash
git add src/documentModel.js src/migrateToModel.js test/migrateToModel.test.js
git commit -m "$(cat <<'EOF'
fix(model): round-trip experience startDate/endDate through the migration

buildResumeData sets machine-readable startDate/endDate so the date sort keeps
precision, but the model carried only id + relevanceRank, so modelToFlat dropped
them on the first save. Carry them as experienceItem attrs, re-emitted only when
present (golden round-trips stay byte-identical for date-less resumes).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: F2 core — pass the selected font families into the Typst theme

**Files:** `src/typst/theme.js`, `src/typstExport.js`, `src/fontService.js`, `test/typstTheme.test.js` (create or append).

**Context:** `resumeTheme()` passes only `getCurrentFontSettings().pairingId` to `buildTheme`. For `mode: 'google'`/`'system'` there is no `pairingId`, so `buildTheme` falls back to the default Cormorant/DM Sans pairing. Fix: resolve the actual selected families and pass them as overrides. (Whether Typst can render them is Tasks 3-4; this task is the wiring.)

- [ ] **Step 1: Failing tests** — append to `test/typstTheme.test.js` (create if missing; mirror the import style of `test/typstGenerate.test.js`):

```js
import { describe, it, expect } from 'vitest';
import { buildTheme } from '../src/typst/theme.js';

describe('buildTheme font overrides', () => {
  it('uses explicit fontDisplay/fontBody over the pairing', () => {
    const t = buildTheme({ pairingId: 'classic-elegant', fontDisplay: 'Montserrat', fontBody: 'Bitter' });
    expect(t.fontDisplay).toBe('Montserrat');
    expect(t.fontBody).toBe('Bitter');
  });
  it('falls back to the pairing when no overrides', () => {
    const t = buildTheme({ pairingId: 'classic-elegant' });
    expect(t.fontDisplay).toBe('Cormorant Garamond');
    expect(t.fontBody).toBe('DM Sans');
  });
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run test/typstTheme.test.js`.

- [ ] **Step 3: `buildTheme` overrides** — `src/typst/theme.js`: accept `fontDisplay`/`fontBody` in the params and prefer them:
  - add `fontDisplay`/`fontBody` to the destructured `buildTheme({ ... })` signature.
  - change the two token lines to:
    ```js
    fontDisplay: fontDisplay ?? pairing.display.family,
    fontBody:    fontBody    ?? pairing.body.family,
    ```

- [ ] **Step 4: Resolver in `fontService.js`** — add an exported helper that returns the BARE selected family names (no CSS fallback stack), reusing the same resolution `applyFontSettings` does:

```js
/**
 * Resolve the currently-selected display/body font FAMILY NAMES (bare, no CSS
 * stack) for consumers that need the raw family — e.g. the Typst export, which
 * matches fonts by family name. Returns {} for preset mode (use the pairing).
 */
export function getSelectedFontFamilies() {
  const s = getCurrentFontSettings();
  if (s.mode === 'google') {
    return { fontDisplay: s.displayFont?.family, fontBody: s.bodyFont?.family };
  }
  if (s.mode === 'system') {
    const resolve = (f) => (f && SYSTEM_FONT_STACKS[f]?.family) || f || undefined;
    return { fontDisplay: resolve(s.displayFont), fontBody: resolve(s.bodyFont) };
  }
  return {}; // preset → buildTheme resolves from pairingId
}
```
  (Confirm `SYSTEM_FONT_STACKS` is in scope in fontService.js — it is, used by `applyFontSettings`.)

- [ ] **Step 5: Wire `resumeTheme`** — `src/typstExport.js`: import `getSelectedFontFamilies` and spread it into the `buildTheme` call:
```js
import { getCurrentFontSettings, getSelectedFontFamilies } from './fontService.js';
// ...
function resumeTheme() {
  const s = getSettings();
  return buildTheme({
    pairingId: getCurrentFontSettings().pairingId,
    ...getSelectedFontFamilies(),
    colorPalette: s.colorPalette,
    customColor: s.customColor,
    spacing: getSpacingSettings(),
    accent: getAccentSettings(),
  });
}
```

- [ ] **Step 6: Source Sans naming fix** — `src/fontService.js`: in `POPULAR_GOOGLE_FONTS`, rename `'Source Sans Pro'` → `'Source Sans 3'` so the family string matches the bundled `source-sans-3` file and the `sharp-professional` pairing (otherwise a `google`-mode pick of that font names a font Typst doesn't have). (This subsumes the long-standing follow-up chip.)

- [ ] **Step 7: Run → PASS + full gate** — `npx vitest run`, `npm run lint`, `npm run build`. Commit (4 files):

```bash
git add src/typst/theme.js src/typstExport.js src/fontService.js test/typstTheme.test.js
git commit -m "$(cat <<'EOF'
fix(typst): honor google/system font selections in the export theme

resumeTheme only forwarded pairingId, so google/system font picks fell back to the
default pairing. buildTheme now accepts explicit fontDisplay/fontBody, and
resumeTheme resolves the selected families via a new getSelectedFontFamilies()
helper. Also align 'Source Sans Pro' to the bundled 'Source Sans 3' name.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: F2 system fonts — let the Rust Typst compile resolve installed fonts

**Files:** `src-tauri/Cargo.toml`, `src-tauri/src/commands/typst_compile.rs`.

**Context:** `compile()` supplies only `BUNDLED_FONTS`, so `system`-mode (and any un-bundled) font resolves to a fallback. typst-as-lib's `typst-kit-fonts` feature adds `search_fonts_with(TypstKitFontOptions)` to resolve system-installed fonts. Keep the bundled fonts AND add system search.

- [ ] **Step 1: Enable the feature** — `src-tauri/Cargo.toml`, change the dep:
```toml
typst-as-lib = { version = "0.15.5", features = ["typst-kit-fonts"] }
```
(`typst-kit-fonts` adds system-font searching. Do NOT add `typst-kit-embed-fonts` — we ship our own bundled fonts and don't need typst-assets embedded.)

- [ ] **Step 2: Use system search in `compile()`** — `src-tauri/src/commands/typst_compile.rs`:
```rust
use tauri::State;
use typst_as_lib::{TypstEngine, typst_kit_options::TypstKitFontOptions};
use super::{PdfResult, PendingPdfPath};

pub fn compile(typ: &str) -> Result<Vec<u8>, String> {
    let engine = TypstEngine::builder()
        .main_file(typ)
        .fonts(BUNDLED_FONTS.iter().copied())
        .search_fonts_with(
            TypstKitFontOptions::default()
                .include_system_fonts(true)
                .include_embedded_fonts(false),
        )
        .build();

    let doc = engine
        .compile()
        .output
        .map_err(|e| format!("Typst compile error: {e:?}"))?;

    typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default())
        .map_err(|e| format!("Typst PDF error: {e:?}"))
}
```
  (Remove the now-redundant `use typst_as_lib::TypstEngine;` inside the fn if you hoist the import to the top, as shown. **VERIFY** `.fonts(...)` and `.search_fonts_with(...)` chain together on this builder version — if the API rejects both, consult the [font_searcher example](https://github.com/Relacibo/typst-as-lib/blob/main/examples/font_searcher.rs) and adapt; the `cargo check` below is the gate.)

- [ ] **Step 3: Rust gate** — from `resume-designer/src-tauri/`:
```
cargo check     # compiles (first build pulls typst-kit — may take a few min)
cargo clippy    # no new warnings
cargo test --lib typst_compile   # the existing compiles_minimal_typ_to_pdf test still passes
```
  If `cargo check` fails to resolve `TypstKitFontOptions` / `typst_kit_options`, confirm the import path against the crate docs (the example uses `typst_as_lib::typst_kit_options::TypstKitFontOptions`). If the feature pulls a heavy/unbuildable dep in this environment, report BLOCKED rather than guessing.

- [ ] **Step 4: Commit** (2 files):
```bash
git add src-tauri/Cargo.toml src-tauri/src/commands/typst_compile.rs
git commit -m "$(cat <<'EOF'
feat(typst): resolve system-installed fonts in the Rust compile

Enable typst-as-lib's typst-kit-fonts feature and add search_fonts_with(
include_system_fonts: true) alongside the bundled fonts, so system-mode font
selections (and any non-bundled family the user has installed) render in the PDF
instead of falling back to a default.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: F2 fonts — vendor the remaining curated Google fonts (NETWORK-DEPENDENT)

**Files:** `src-tauri/fonts/*.ttf` (new), `src-tauri/fonts/NOTICE.md`, possibly `src/fontService.js` (family-name reconciliation). `build.rs` auto-scans `fonts/*.ttf` — no build edit needed.

**Context:** Of the 28 `POPULAR_GOOGLE_FONTS`, 9 are NOT bundled, so a `google`-mode pick of one renders as a fallback (unless the user has it installed → Task 3). Vendor them so every curated pick renders. **This step needs network access** to google-webfonts-helper (`https://gwfh.mranftl.com`). If the sandbox blocks it, report BLOCKED — Tasks 1-3 already fix the bug for the common (bundled) case + system-installed fonts; the merge can proceed and this becomes a follow-up.

Missing families: **Crimson Text, Source Serif Pro, PT Serif, Bitter, Montserrat, Rubik, Bebas Neue, Abril Fatface, Righteous**.

- [ ] **Step 1: Per-font license + name check FIRST (the Merriweather lesson).** For EACH of the 9, before bundling, determine from its upstream OFL whether it has a **Reserved Font Name (RFN)** and what its **actual current family name** is (Google renames: e.g. "Source Sans Pro" → "Source Sans 3", so "Source Serif Pro" is likely "Source Serif 4"). Rules (mirror the existing `NOTICE.md` precedent):
  - **No RFN:** a gwfh latin-subset TTF (regular + 700 + italic where available) is OFL-permitted — bundle those, named like the existing files (`<family>-vNN-latin-<variant>.ttf`).
  - **Has RFN:** do NOT use a subset that keeps the name (that violates OFL, as with Merriweather). Bundle the **unmodified upstream** TTF from github.com/google/fonts instead, and document it.
  - Skip + flag any font whose license is not OFL/Apache-2.0 (rare for Google Fonts).

- [ ] **Step 2: Fetch + place the TTFs** into `src-tauri/fonts/`. Example gwfh download (verify the current version slug per font):
```bash
# from resume-designer/src-tauri/fonts — illustrative; the agent resolves real URLs via gwfh
curl -sL "https://gwfh.mranftl.com/api/fonts/montserrat?download=zip&subsets=latin&variants=regular,700,italic&formats=ttf" -o /tmp/montserrat.zip
unzip -o /tmp/montserrat.zip -d .
```
  Keep the gwfh file naming. Confirm each file's embedded family name with `fc-query <file>.ttf | grep family` (or `python3 -c "from fontTools.ttLib import TTFont; print(TTFont('f.ttf')['name'].getDebugName(1))"`).

- [ ] **Step 3: Reconcile family names** — for any font whose embedded family name differs from its `POPULAR_GOOGLE_FONTS` string (e.g. "Source Serif Pro" → "Source Serif 4"), update the string in `src/fontService.js` so the app passes the name Typst will match. (Same fix shape as the Source Sans 3 rename in Task 2.)

- [ ] **Step 4: Document** — add each vendored family to `src-tauri/fonts/NOTICE.md` under the correct license section, noting any RFN handling / no-italic / rename, exactly like the existing entries.

- [ ] **Step 5: Compile-gate each new family** — for each newly bundled family, generate a tiny `.typ` that sets that family as the body font and `typst compile --font-path src-tauri/fonts /tmp/f.typ /tmp/f.pdf 2>&1`, asserting **no `unknown font family` warning** for it (proves Typst resolves the bundled file by the name the app uses). Fix name mismatches until clean.

- [ ] **Step 6: Rust gate + commit** — `cargo check` (build.rs regenerates `BUNDLED_FONTS` from the new files); commit the fonts + docs (+ any fontService rename):
```bash
git add src-tauri/fonts/ src/fontService.js
git commit -m "$(cat <<'EOF'
feat(typst): vendor the remaining curated Google fonts for export

Bundle latin-subset TTFs for the curated fonts that were missing (Crimson Text,
Source Serif Pro, PT Serif, Bitter, Montserrat, Rubik, Bebas Neue, Abril Fatface,
Righteous) so google-mode picks render in the PDF without relying on a system
install. RFN fonts bundled unmodified per the OFL; NOTICE.md updated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification (after all tasks)
- [ ] **JS green:** `npx vitest run`, `npm run lint`, `npm run build`.
- [ ] **Rust green:** `cargo check` + `cargo clippy` + `cargo test --lib` from `src-tauri/`.
- [ ] **All 11 layouts still compile** via the typst CLI (regression check from PR 3.8).
- [ ] **commitlint** `npx commitlint --from <pre-fix sha> --to HEAD` exits 0 (errors; warnings OK).
- [ ] **Final whole-PR review** of the new commits + push (updates PR #46) + re-check CI + Codex.
- [ ] **Hand to user (Tauri review):** confirm a google-mode font and a system-mode font both render correctly in the desktop PDF preview/export, and that a generated resume's chronological sort survives a save/reload.

## Notes
- If Task 4 is BLOCKED (no network for gwfh), ship Tasks 1-3 (which fix the bug for bundled + system-installed fonts) and leave font-vendoring as a tracked follow-up — note it on PR #46.
- These four commits update the open PR #46; no new PR. After they land + CI/Codex are green, the path is unchanged: user's Tauri review → merge `next` → `main`.

## Self-review notes (author)
- **Both findings covered:** F1 = Task 1 (round-trip dates); F2 = Tasks 2 (wiring, the actual bug) + 3 (system fonts) + 4 (bundle missing) — the full scope the user chose. ✓
- **No placeholders:** complete code for Tasks 1-3; Task 4's per-font specifics (versions, RFN, real family names) are genuine runtime discoveries, bounded by explicit rules + a compile-gate, with the network risk flagged. ✓
- **Round-trip safety:** new attrs emitted conditionally → golden samples stay byte-identical (mirrors `_relevanceRank`). ✓
- **Ordering:** family passthrough (Task 2) precedes font-availability (Tasks 3-4), else neither renders; fonts (Task 4, riskiest/network) last so a block doesn't strand the rest. ✓
- **Consistency:** `getSelectedFontFamilies` defined in fontService.js and consumed in typstExport.js; `buildTheme` override names (`fontDisplay`/`fontBody`) match the token names it already emits. ✓
