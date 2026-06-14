# Phase 0 Findings — Structured Document Model + Typst

**Date:** 2026-06-14
**Outcome:** ✅ **GO** — the architecture is validated end-to-end on throwaway spikes. All five validations pass.
**Spike branch:** `spike/document-model` (throwaway — prototypes under `spikes/document-model/`, not merged). This doc is the durable output.

## 1. Typst is ATS-correct (Tasks 1–2) — PASS

A two-column (sidebar) résumé compiled with Typst, then text-extracted with `pdfjs-dist`:

- **Real selectable text** (not vector outlines like Figma): all expected tokens present in the extracted stream.
- **Reading order = document/source order**, independent of the visual columns: extracted positions were `Ada Lovelace(0) → Skills(39) → Tools(79) → Summary(105) → Experience(156)` — the entire sidebar precedes the main column in the text stream, never column-interleaved.
- **`model → Typst → PDF` preserves order:** a hand-authored document-model JSON, run through a minimal generator, produced a byte-identical PDF (19,782 bytes) that passes the same check.

This is the single biggest risk, and it is cleanly cleared: Typst-from-an-ordered-model gives ATS-parseable output, which is exactly what canvas/Figma export does **not** (its native export outlines text → "ATS reads blank").

## 2. Embedding decision (Task 3) — Rust-native `typst-as-lib`

- **Chosen: Rust-native, in-process** via `typst-as-lib 0.15.5` + `typst-pdf 0.14.2` (transitively `typst 0.14.2`, matching the installed CLI). No CLI sidecar.
- **Evidence:**
  - Lockfile resolved to a **single `typst 0.14.2`** across all crates (no version conflict) — 329 packages.
  - **In-process compile: ~14 ms** for the résumé → 21,678-byte PDF.
  - **Standalone release binary: 38 MB** (std + Typst + embedded font). This is the footprint to budget when adding Typst to the app; comparable to the ~22 MB WASM alternative but in-process and faster, and it reuses the existing Rust backend that already owns PDF/save commands.
  - The Rust-generated PDF **passes the same ATS reading-order check** as the CLI output.
- **API gotcha for Phase 1:** use `engine.compile()` (no input). `engine.compile_with_input(())` fails to compile in 0.15.5 because `()` does not implement `Into<Dict>`; the output document type infers as `PagedDocument` from the `typst_pdf::pdf(&doc, …)` call.
- **Fonts:** Typst needs fonts supplied explicitly (`.fonts([include_bytes!(...)])`). For the app, embed the chosen résumé fonts; `typst-bake` (built on `typst-as-lib`) can bake fonts/templates into the binary for fully offline compilation — a good fit for this local-first app.
- **Fallback (unused):** CLI sidecar remains viable if a future blocker appears, at the cost of a ~30 MB shipped binary + process-spawn latency + extra signing surface.

## 3. Schema feasibility (Task 4) — PASS

- A minimal **ProseMirror résumé schema** (`doc = header section+`; typed `section`/`heading`/`bulletList`/`experienceItem`; `bold`/`italic`/`link` marks) **round-trips the résumé JSON losslessly**.
- **DOM order == model order:** serializing the doc and reading `textContent` gives `Ada Lovelace → Skills → Mathematics → Experience → Authored Note G` in order — so the *on-screen* HTML projection also carries correct reading order, fixing the current sidebar defect by construction.
- Schema notes for Phase 1: the node set is a starting point; expand for contact items, tags (skills/tools), education items, custom sections. TipTap wraps this same ProseMirror schema.

## 4. Page-size mechanic (Task 5) — PASS

- `#set page(height: auto)` → **1 page** (the open-ended mode = today's behavior).
- Fixed `height: 11in` (Letter), long content → **6 pages** — real pagination across pages, for free from Typst. The page-size feature's core mechanic is sound.

## 5. Spec adjustments for Phase 1

- Record the `.compile()` API + font-supply requirement in the Phase 1 plan (spec §7).
- Budget ~35–40 MB binary growth for embedding Typst (spec §7/§14 Q1 — resolved in favor of Rust-native).
- The `model → Typst` generator must cover the layout set chosen for Phase 2/3 (spec §11 risk — start with sidebar + stacked + classic).
- No change needed to the core model shape (§5) or the layered architecture (§4); both held up.

## 6. Go / no-go

**GO.** Typst produces ATS-correct, real-text, paginated PDFs from an ordered model; it embeds natively in Rust in ~14 ms; and a ProseMirror schema models the résumé with reading order intact on both the HTML and PDF sides. Proceed to the Phase 1 plan (document model + schema + flat→model migration).
