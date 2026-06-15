# Phase 3 PR 3.4 — Rust Typst compile + bundled fonts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the JS generator's `.typ` output into the **Rust** backend so it compiles to a PDF in-process: vendor the pairing fonts, add `typst-as-lib`, and expose two Tauri commands — `typst_render_preview` (→ PDF bytes for the PDF.js preview) and `typst_export_pdf` (→ writes to the user-picked save path). This is the backend half of the export feature; the UI lands in PR 3.5. The app's existing behavior is unchanged (the new commands have no caller yet).

**Architecture:** JS builds `.typ` (done, PRs 3.2–3.3); Rust compiles it. A `commands/typst_compile.rs` module holds a pure `compile(typ: &str) -> Result<Vec<u8>, String>` that loads the bundled fonts and runs `typst-as-lib`. The two `#[tauri::command]`s wrap it: preview returns the bytes via `tauri::ipc::Response`; export recompiles and writes to the `PendingPdfPath` slot (the same server-side save-path security pattern as `capture_pdf_from_window` — the renderer never supplies the path).

**Tech Stack:** Rust (cargo 1.92), `typst-as-lib` 0.15.5 + `typst-pdf` 0.14.2 (transitively typst 0.14.2 — matches the installed CLI, validated in Phase 0), Tauri 2. Fonts from google-webfonts-helper (OFL/Apache, latin subset, static TTF). The `typst` CLI 0.14.2 is on PATH for verification.

**Verification reality (read this):** `cargo build` pulls ~330 crates the first time — **the first build is slow (minutes)**; subsequent builds are fast. The headless env can't visually inspect a PDF, so correctness is gated by: (a) a `cargo test` that compiles a fixture `.typ` and asserts the output is a non-empty PDF (`%PDF` magic); (b) typst-CLI compiles of the *same* generator output (already green via the PR-3.2/3.3 ATS tests — the Rust path uses the identical typst version, so same input → same output). Final visual review on macOS/Windows is the user's, in PR 3.5.

---

## File Structure

| File | Change |
|---|---|
| `resume-designer/src-tauri/fonts/*.ttf` | **new** — vendored pairing fonts (≈57 files, ~2 MB) |
| `resume-designer/src-tauri/fonts/OFL.txt` + `NOTICE.md` | **new** — license + attribution |
| `resume-designer/src-tauri/Cargo.toml` | add `typst-as-lib`, `typst-pdf` (desktop targets) |
| `resume-designer/src-tauri/build.rs` | generate the embedded font-bytes array from `fonts/` |
| `resume-designer/src-tauri/src/commands/typst_compile.rs` | **new** — `compile()` + the two commands |
| `resume-designer/src-tauri/src/commands/mod.rs` | `pub mod typst_compile;` |
| `resume-designer/src-tauri/src/lib.rs` | register the two commands in `generate_handler!` |

One commit per task. Conventional Commits (lowercase subject — not starting with an all-caps word; body ≤100; `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` footer). Explicit `git add <paths>` — never `-a`. Do NOT push; do NOT touch `next`/`main`.

---

### Task 1: Vendor the pairing fonts

**Files:** create `src-tauri/fonts/` (TTFs + `OFL.txt` + `NOTICE.md`).

Download static latin-subset TTFs (regular + 700 + italic where available) for the 19 families used by `FONT_PAIRINGS` (`src/fontService.js`), via google-webfonts-helper. The font's INTERNAL family name must match the string the generator emits (e.g. `theme.js`/`FONT_PAIRINGS` family `"DM Sans"`).

The 19 gwfh ids (family → id): cormorant-garamond, dm-sans, inter, playfair-display, source-sans-3 *(see name caveat)*, ibm-plex-serif, ibm-plex-sans, libre-baskerville, karla, oswald, roboto, merriweather, open-sans, raleway, lato, lora, nunito-sans, poppins, work-sans.

- [ ] **Step 1: Download script** — run from `resume-designer/src-tauri/`:
```bash
mkdir -p fonts && cd fonts
IDS="cormorant-garamond dm-sans inter playfair-display source-sans-3 ibm-plex-serif ibm-plex-sans libre-baskerville karla oswald roboto merriweather open-sans raleway lato lora nunito-sans poppins work-sans"
for id in $IDS; do
  url="https://gwfh.mranftl.com/api/fonts/$id?download=zip&subsets=latin&variants=regular,700,italic&formats=ttf"
  curl -fsSL "$url" -o "$id.zip" && unzip -oq "$id.zip" -d "$id" && rm "$id.zip" \
    && echo "OK   $id ($(ls "$id"/*.ttf 2>/dev/null | wc -l | tr -d ' ') ttf)" \
    || echo "FAIL $id (try variants=regular,700 — some families lack italic; or check the id)"
done
# Flatten into fonts/ (typst loads any *.ttf found):
find . -mindepth 2 -name '*.ttf' -exec mv -n {} . \; && find . -type d -empty -delete
ls *.ttf | wc -l   # expect ~50-57
```
For any `FAIL`: retry with `variants=regular,700` (families like Oswald may lack a true italic), or correct the gwfh id by checking `curl -s https://gwfh.mranftl.com/api/fonts/<id> | head -c 200`.

- [ ] **Step 2: License compliance** — these are OFL/Apache fonts being redistributed in the repo + the app binary. Add `fonts/OFL.txt` (the SIL Open Font License 1.1 text) and a `fonts/NOTICE.md` listing each bundled family + its license (OFL-1.1 for most; Apache-2.0 for Roboto/Open Sans). (Source the OFL text from any bundled family's license or the SIL site.)

- [ ] **Step 3: Verify typst uses EVERY family (catches name mismatches)** — the critical check. Write a probe `.typ` that sets each pairing family and compile it against the vendored fonts; **zero "unknown font" warnings** means every emitted family name resolves to a bundled file:
```bash
cd resume-designer/src-tauri
node --input-type=module -e "import {FONT_PAIRINGS} from '../src/fontService.js'; const fams=[...new Set(Object.values(FONT_PAIRINGS).flatMap(p=>[p.display.family,p.body.family]))]; import('node:fs').then(fs=>fs.writeFileSync('/tmp/probe.typ', fams.map((f,i)=>'#text(font: \"'+f+'\")[Probe '+i+' regular *bold* _italic_]\\n\\n').join('')));"
typst compile --font-path fonts /tmp/probe.typ /tmp/probe.pdf 2>&1 | grep -i 'unknown font' && echo "MISMATCH ^^^ — reconcile family name(s)" || echo "ALL FAMILIES RESOLVE"
```
**Name caveat — likely the one mismatch:** `FONT_PAIRINGS.creative.body.family` is `"Source Sans Pro"`, but the current Google font is "Source Sans 3" (gwfh id `source-sans-3`, internal name "Source Sans 3"). If the probe reports `unknown font family: source sans pro`, fix it the lightweight way: in `src/fontService.js` change that `family` to `"Source Sans 3"` (and confirm `renderer.js`/CSS still load it — it's a superset rename), OR bundle a "Source Sans Pro"-named file. Pick the rename; note it in the commit. Resolve any other mismatch the same way (the probe is the source of truth).

- [ ] **Step 4: Commit**
```bash
git add src-tauri/fonts
git commit -m "feat(typst): vendor pairing fonts for in-app compilation" -m "Bundle latin-subset TTFs (regular/700/italic) for the 19 FONT_PAIRINGS families
via google-webfonts-helper, plus OFL/Apache license + attribution. ~2 MB.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
(If Step 3 required a `fontService.js` rename, add that file to the commit and mention it in the body.)

---

### Task 2: Cargo deps + the Rust compile module

**Files:** modify `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/src/commands/mod.rs`; create `src-tauri/src/commands/typst_compile.rs`.

- [ ] **Step 1: Add the deps** (desktop targets only — Typst isn't needed on mobile). In `Cargo.toml`, under the existing `[target."cfg(not(any(target_os = \"android\", target_os = \"ios\")))".dependencies]` block (next to `tauri-plugin-updater`):
```toml
typst-as-lib = "0.15.5"
typst-pdf = "0.14.2"
```

- [ ] **Step 2: Embed the fonts via `build.rs`.** Append to `src-tauri/build.rs` a step that scans `fonts/*.ttf` and writes a generated array to `OUT_DIR`:
```rust
// --- bundle Typst fonts ---
let fonts_dir = std::path::Path::new("fonts");
let mut entries: Vec<String> = std::fs::read_dir(fonts_dir)
    .map(|rd| rd.filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("ttf"))
        .map(|p| format!("include_bytes!(r\"{}\").as_slice()", std::fs::canonicalize(&p).unwrap().display()))
        .collect())
    .unwrap_or_default();
entries.sort();
let generated = format!("pub static BUNDLED_FONTS: &[&[u8]] = &[\n{}\n];\n", entries.join(",\n"));
std::fs::write(std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("fonts.rs"), generated).unwrap();
println!("cargo:rerun-if-changed=fonts");
```
(Keep the existing `tauri_build::build()` call. The `build.rs` runs before `tauri_build::build()` or after — either is fine; just don't remove the existing call.)

- [ ] **Step 3: Write the compile module** — create `src-tauri/src/commands/typst_compile.rs`. Use the Phase-0-validated API (`docs/superpowers/specs/2026-06-14-phase-0-findings.md`): supply fonts explicitly, `engine.compile()` (NOT `compile_with_input(())`), then `typst_pdf::pdf(&doc, &PdfOptions::default())`. The exact `typst-as-lib` 0.15.5 builder API must be confirmed against the crate docs (`https://docs.rs/typst-as-lib/0.15.5`); the shape is:
```rust
include!(concat!(env!("OUT_DIR"), "/fonts.rs")); // pub static BUNDLED_FONTS

/// Compile Typst source to PDF bytes using the bundled fonts. Pure; no IO.
pub fn compile(typ: &str) -> Result<Vec<u8>, String> {
    use typst_as_lib::TypstEngine;
    let engine = TypstEngine::builder()
        .main_file(typ.to_string())
        .fonts(BUNDLED_FONTS.iter().copied())
        .build();
    let doc = engine.compile().output.map_err(|e| format!("Typst compile error: {e:?}"))?;
    typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default())
        .map_err(|e| format!("Typst PDF error: {e:?}"))
}
```
*(Adjust to the real 0.15.5 API — method names like `main_file`/`with_static_source`/`fonts`/`compile` may differ; the contract is "source + font bytes in → `Vec<u8>` PDF out". Make the error paths return `Err(String)`, never panic.)*

- [ ] **Step 4: Unit test** — append a `#[cfg(test)]` module to `typst_compile.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::compile;
    #[test]
    fn compiles_minimal_typ_to_pdf() {
        let pdf = compile("#set page(width: 8.5in, height: auto)\nHello *world*.").expect("compile ok");
        assert!(pdf.len() > 1000, "pdf suspiciously small: {}", pdf.len());
        assert_eq!(&pdf[..5], b"%PDF-", "missing PDF magic");
    }
}
```
Register the module: add `pub mod typst_compile;` to `src-tauri/src/commands/mod.rs` (gate it `#[cfg(not(any(target_os = "android", target_os = "ios")))]` to match the deps).

- [ ] **Step 5: Build + test** — from `src-tauri/`: `cargo build` (first build is slow — be patient), then `cargo test typst_compile` → the test passes (non-empty `%PDF`). Fix any API mismatches against the crate docs until green.

- [ ] **Step 6: Commit**
```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/build.rs src-tauri/src/commands/typst_compile.rs src-tauri/src/commands/mod.rs
git commit -m "feat(typst): rust typst-as-lib compile with bundled fonts" -m "Add typst-as-lib/typst-pdf; build.rs embeds the bundled fonts; compile(typ) ->
PDF bytes, covered by a cargo test asserting a non-empty %PDF.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The two Tauri commands + registration

**Files:** modify `src-tauri/src/commands/typst_compile.rs`, `src-tauri/src/lib.rs`.

Wrap `compile()` in two commands, reusing `PendingPdfPath` + `PdfResult` from `commands/mod.rs` (same security pattern as `capture_pdf_from_window`: the save path comes from the server-side slot, never the renderer).

- [ ] **Step 1: Add the commands** to `typst_compile.rs`:
```rust
use tauri::State;
use super::{PdfResult, PendingPdfPath};

/// Compile .typ -> PDF bytes, returned for the in-app PDF.js preview.
#[tauri::command]
pub async fn typst_render_preview(typ: String) -> Result<tauri::ipc::Response, String> {
    let bytes = compile(&typ)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Compile .typ -> PDF and write it to the path stashed by pick_pdf_save_path.
/// The renderer cannot supply a path — it's taken from PendingPdfPath.
#[tauri::command]
pub async fn typst_export_pdf(typ: String, pending: State<'_, PendingPdfPath>) -> Result<PdfResult, String> {
    let save_path = {
        let mut slot = pending.0.lock().map_err(|_| "PDF save-path slot lock poisoned".to_string())?;
        match slot.take() {
            Some(p) => p,
            None => return Ok(PdfResult::error("No pending PDF save path. Call pick_pdf_save_path first.")),
        }
    };
    let bytes = match compile(&typ) { Ok(b) => b, Err(e) => return Ok(PdfResult::error(e)) };
    match std::fs::write(&save_path, &bytes) {
        Ok(()) => Ok(PdfResult::success(save_path.to_string_lossy().into_owned())),
        Err(e) => Ok(PdfResult::error(format!("Failed to write PDF file: {e}"))),
    }
}
```
*(Confirm `tauri::ipc::Response::new(Vec<u8>)` is the correct Tauri 2 raw-bytes return; if the API differs, use the documented Tauri 2 mechanism for returning binary from a command. `PdfResult`/`PendingPdfPath` already exist in `commands/mod.rs`.)*

- [ ] **Step 2: Register** in `src-tauri/src/lib.rs` `generate_handler!` — add (gated to desktop, like the updater entries):
```rust
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            commands::typst_compile::typst_render_preview,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            commands::typst_compile::typst_export_pdf,
```

- [ ] **Step 3: Build** — from `src-tauri/`: `cargo build` succeeds; `cargo test` stays green. (No new unit test here — the commands are thin wrappers over the tested `compile()`; they're exercised end-to-end in PR 3.5.)

- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/commands/typst_compile.rs src-tauri/src/lib.rs
git commit -m "feat(typst): typst_render_preview and typst_export_pdf commands" -m "Two Tauri commands over compile(): preview returns PDF bytes; export writes to
the PendingPdfPath slot (renderer never supplies the path). Wired in PR 3.5.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all 3 tasks)

- [ ] **Rust builds + tests:** `cargo build` and `cargo test` from `src-tauri/` both succeed; `compiles_minimal_typ_to_pdf` passes.
- [ ] **End-to-end (CLI proxy):** the generator output already compiles via the typst CLI (PR 3.2/3.3 ATS tests, same typst version) — re-run `npm test` to confirm the JS suite (incl. ATS) is still green; nothing in this PR touches JS except a possible `fontService.js` family rename.
- [ ] **Every pairing font resolves:** the Task-1 probe reports `ALL FAMILIES RESOLVE` (no unknown-font warnings).
- [ ] **No behavior change:** the new commands have no caller yet (grep confirms `typst_render_preview`/`typst_export_pdf` are unreferenced in JS); the app runs identically. Lint + JS build still clean.

---

## Notes / risks

- **First `cargo build` is slow** (~330 crates). Expected; not a failure.
- **typst-as-lib 0.15.5 API:** method names in Task 2/3 are best-effort from Phase 0 + the contract; the implementer must reconcile against `docs.rs/typst-as-lib/0.15.5` and make `cargo test` green — that's the gate, not the literal snippet.
- **Binary size:** Phase 0 measured ~38 MB for typst + one font; the bundled ~2 MB of fonts adds little. Budget noted.
- **Font family-name reconciliation** (Task 1 Step 3) is the most likely snag — the probe makes it explicit and cheap to fix.

## Self-review notes (author)
- **Spec coverage:** design spec §6 (deps, the two commands, the `PendingPdfPath` security reuse, return-bytes), §9 (font bundling — resolved to gwfh latin-subset TTFs). ✓
- **No placeholders:** the font pipeline (verified working) and the command signatures are concrete; the one genuinely-unpinnable piece (the exact 0.15.5 builder API) is delegated with the Phase-0 gotchas + a hard `cargo test` gate + the docs.rs pointer — the honest contract for an external-crate integration. ✓
- **Consistency:** `compile()` is the single compile path both commands use; `PdfResult`/`PendingPdfPath` reuse matches `capture_pdf_from_window`; desktop cfg-gating matches the existing updater pattern. ✓
