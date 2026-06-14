# Document Model — Phase 0 (De-Risking Spikes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the structured-model + Typst architecture end-to-end on throwaway prototypes — Typst output is ATS-correct, Typst embeds cleanly in the Tauri/Rust stack, and a ProseMirror/TipTap schema can faithfully model a résumé — *before* committing weeks to Phases 1–6.

**Architecture:** Five time-boxed spikes on a throwaway `spike/document-model` branch. The durable output is a **findings + decisions document** (Task 6) that feeds the Phase 1 plan; the prototype code itself is reference/throwaway and is **not** merged into `next`. Spikes are deliberately exploratory: the code blocks below are concrete starting points measured against explicit **success criteria**, not guaranteed-final implementations — when a crate/API differs from the sketch, the spike's job is to make it meet the success criterion.

**Tech Stack:** Typst (CLI for fast iteration; `typst-as-lib` + `typst-pdf` + `typst-bake`/`typst-kit` for the Rust-native embedding eval), `pdfjs-dist` (PDF text extraction), `prosemirror-model` (+ `jsdom`) for the schema spike, Node 24, Rust (`resume-designer/src-tauri`).

**Conventions:** Repo root is `/Users/ashshah/Projects/Resume-Designer`. The npm project is under `resume-designer/`. Commits are **gated on Ash's explicit go-ahead** (standing rule) — the "Commit" steps below are for the executor to run *after* that go-ahead. Use `git -C <root>` with root-relative paths; disambiguate the `next` branch from the `next` tag with `refs/heads/next` / `origin/next`.

---

## Pre-flight

- [ ] **Step 1: Branch off `next` for throwaway spike work**

```bash
git -C /Users/ashshah/Projects/Resume-Designer fetch origin
git -C /Users/ashshah/Projects/Resume-Designer switch next
git -C /Users/ashshah/Projects/Resume-Designer merge --ff-only origin/next
git -C /Users/ashshah/Projects/Resume-Designer switch -c spike/document-model
```

- [ ] **Step 2: Install the Typst CLI (fast iteration for Spikes 1–2)**

```bash
cargo install typst-cli   # or: brew install typst
typst --version           # expect: typst 0.12.x or newer
```
Expected: prints a Typst version ≥ 0.12.

- [ ] **Step 3: Create the spike workspace**

```bash
mkdir -p /Users/ashshah/Projects/Resume-Designer/spikes/document-model/typst
mkdir -p /Users/ashshah/Projects/Resume-Designer/spikes/document-model/tiptap
cd /Users/ashshah/Projects/Resume-Designer/spikes/document-model
npm init -y
npm install pdfjs-dist prosemirror-model prosemirror-schema-list jsdom
```
Expected: a `spikes/document-model/package.json` with those deps installed.

---

## Task 1: Typst emits ATS-correct text in document (reading) order

**Why:** The #1 risk. A sidebar/two-column layout must produce a PDF whose *text stream* follows logical order (header → sidebar → main), with **real selectable text** (not vector outlines like Figma). This is the ATS guarantee.

**Files:**
- Create: `spikes/document-model/typst/sample-resume.typ`
- Create: `spikes/document-model/extract-text.mjs`
- Create: `spikes/document-model/ats-order.mjs`

- [ ] **Step 1: Author a two-column Typst résumé (sidebar in source before main)**

`spikes/document-model/typst/sample-resume.typ`:
```typ
#set page(width: 8.5in, height: auto, margin: 0.5in)
#set text(size: 10pt)

#text(size: 18pt, weight: "bold")[Ada Lovelace]
#linebreak()
#text(size: 11pt)[Analytical Engine Pioneer]
#v(8pt)

#grid(
  columns: (2.4in, 1fr),
  gutter: 16pt,
  // SIDEBAR — appears first in source
  [
    == Skills
    - Mathematics
    - Algorithm Design
    == Tools
    - Difference Engine
  ],
  // MAIN — appears second in source
  [
    == Summary
    First published computer algorithm author.
    == Experience
    *Collaborator* — Analytical Engine
    - Authored Note G, the first published algorithm.
  ],
)
```

- [ ] **Step 2: Compile to PDF**

```bash
cd /Users/ashshah/Projects/Resume-Designer/spikes/document-model
typst compile typst/sample-resume.typ typst/sample-resume.pdf
```
Expected: `typst/sample-resume.pdf` is created.

- [ ] **Step 3: Write the text-extraction helper**

`spikes/document-model/extract-text.mjs`:
```js
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Returns the PDF's text items joined in content-stream order — i.e., the
// order an ATS / text extractor reads. Node needs the legacy build with the
// worker disabled.
export async function extractOrderedText(pdfPath) {
  const data = new Uint8Array(readFileSync(pdfPath));
  const pdf = await getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
  const items = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items) if (it.str) items.push(it.str);
  }
  return items.join(' ').replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Write the ATS-order assertion (the spike's "test")**

`spikes/document-model/ats-order.mjs`:
```js
import { extractOrderedText } from './extract-text.mjs';

const text = await extractOrderedText(process.argv[2] ?? 'typst/sample-resume.pdf');

// 1) Real selectable text present (not blank / outlined).
const expectedTokens = ['Ada Lovelace', 'Skills', 'Mathematics', 'Tools', 'Summary', 'Experience', 'Note G'];
const missing = expectedTokens.filter((t) => !text.includes(t));

// 2) Reading order = document order: header, then SIDEBAR, then MAIN.
const order = ['Ada Lovelace', 'Skills', 'Tools', 'Summary', 'Experience'];
const positions = order.map((t) => text.indexOf(t));
const inOrder = positions.every((p, i) => i === 0 || (p > positions[i - 1] && p >= 0));

console.log('Extracted text:\n', text, '\n');
console.log('Missing tokens:', missing);
console.log('Positions:', Object.fromEntries(order.map((t, i) => [t, positions[i]])));
if (missing.length || !inOrder) {
  console.error('❌ FAIL: text incomplete or out of reading order');
  process.exit(1);
}
console.log('✅ PASS: real text, correct reading order');
```

- [ ] **Step 5: Run it — verify PASS**

```bash
cd /Users/ashshah/Projects/Resume-Designer/spikes/document-model
node ats-order.mjs typst/sample-resume.pdf
```
Expected: prints `✅ PASS: real text, correct reading order`. **Success criterion:** all tokens present (text is real, not outlined) and `Skills`/`Tools` appear before `Summary`/`Experience` (sidebar-before-main = document order, independent of visual columns).

- [ ] **Step 6: Sanity-check selectability in a viewer (manual)**

Open `typst/sample-resume.pdf` in Preview/a browser and confirm you can select and copy the text. Expected: text selects as text (proves it is not vector-outlined).

- [ ] **Step 7: Commit (gated)**

```bash
git -C /Users/ashshah/Projects/Resume-Designer add spikes/document-model
git -C /Users/ashshah/Projects/Resume-Designer commit -m "spike(typst): ATS reading-order check passes on a two-column résumé"
```

---

## Task 2: `model → Typst → PDF` end to end

**Why:** Proves the real data flow — a document-model JSON drives Typst generation — and that the model's reading order survives to the PDF.

**Files:**
- Create: `spikes/document-model/typst/model.sample.json`
- Create: `spikes/document-model/typst/model-to-typst.mjs`

- [ ] **Step 1: Hand-author a document-model sample (spec §5 shape)**

`spikes/document-model/typst/model.sample.json`:
```json
{
  "docType": "resume",
  "schemaVersion": 1,
  "pageSize": "auto",
  "layout": "sidebar",
  "content": [
    { "type": "header", "name": "Ada Lovelace", "tagline": "Analytical Engine Pioneer" },
    { "type": "section", "sectionKind": "skills", "heading": "Skills", "items": ["Mathematics", "Algorithm Design"] },
    { "type": "section", "sectionKind": "tools", "heading": "Tools", "items": ["Difference Engine"] },
    { "type": "section", "sectionKind": "summary", "heading": "Summary", "paragraphs": ["First published computer algorithm author."] },
    { "type": "section", "sectionKind": "experience", "heading": "Experience",
      "experienceItems": [ { "title": "Collaborator", "org": "Analytical Engine", "bullets": ["Authored Note G, the first published algorithm."] } ] }
  ]
}
```

- [ ] **Step 2: Write a minimal model→Typst generator**

`spikes/document-model/typst/model-to-typst.mjs`:
```js
import { readFileSync, writeFileSync } from 'node:fs';

const esc = (s) => String(s).replace(/([#$\\*_`\[\]])/g, '\\$1'); // escape Typst specials

function sectionTypst(sec) {
  const head = `== ${esc(sec.heading)}\n`;
  if (sec.items) return head + sec.items.map((i) => `- ${esc(i)}`).join('\n') + '\n';
  if (sec.paragraphs) return head + sec.paragraphs.map(esc).join('\n\n') + '\n';
  if (sec.experienceItems) return head + sec.experienceItems.map((e) =>
    `*${esc(e.title)}* — ${esc(e.org)}\n` + (e.bullets ?? []).map((b) => `- ${esc(b)}`).join('\n')
  ).join('\n\n') + '\n';
  return head;
}

function modelToTypst(model) {
  const header = model.content.find((n) => n.type === 'header');
  const sections = model.content.filter((n) => n.type === 'section');
  const sidebarKinds = new Set(['skills', 'tools']);
  const sidebar = sections.filter((s) => sidebarKinds.has(s.sectionKind));
  const main = sections.filter((s) => !sidebarKinds.has(s.sectionKind));
  const pageHeight = model.pageSize === 'auto' ? 'auto' : '11in'; // letter for the spike
  return `#set page(width: 8.5in, height: ${pageHeight}, margin: 0.5in)
#set text(size: 10pt)

#text(size: 18pt, weight: "bold")[${esc(header.name)}]
#linebreak()
#text(size: 11pt)[${esc(header.tagline)}]
#v(8pt)

#grid(
  columns: (2.4in, 1fr),
  gutter: 16pt,
  [
${sidebar.map(sectionTypst).join('\n')}
  ],
  [
${main.map(sectionTypst).join('\n')}
  ],
)
`;
}

const model = JSON.parse(readFileSync(process.argv[2] ?? 'typst/model.sample.json', 'utf8'));
writeFileSync('typst/generated.typ', modelToTypst(model));
console.log('Wrote typst/generated.typ');
```

- [ ] **Step 3: Generate, compile, and re-run the ATS check**

```bash
cd /Users/ashshah/Projects/Resume-Designer/spikes/document-model
node typst/model-to-typst.mjs typst/model.sample.json
typst compile typst/generated.typ typst/generated.pdf
node ats-order.mjs typst/generated.pdf
```
Expected: `✅ PASS`. **Success criterion:** the model-generated PDF passes the same reading-order + real-text checks as the hand-authored one.

- [ ] **Step 4: Commit (gated)**

```bash
git -C /Users/ashshah/Projects/Resume-Designer add spikes/document-model
git -C /Users/ashshah/Projects/Resume-Designer commit -m "spike(typst): model→typst→PDF pipeline preserves reading order"
```

---

## Task 3: Typst embedding decision (Rust-native vs CLI sidecar)

**Why:** Determines how Typst ships in the app. Spec §7/§14 Q1 lean Rust-native (`typst-as-lib`) to avoid the ~22 MB WASM bundle and reuse the existing Rust process; this spike validates that and records measurements.

**Files:**
- Create: `resume-designer/src-tauri/examples/typst_spike.rs`
- Modify (spike branch only): `resume-designer/src-tauri/Cargo.toml` (add dev/example deps)

- [ ] **Step 1: Add the Typst crates as example-only deps (spike branch)**

In `resume-designer/src-tauri/Cargo.toml`, add a `[dev-dependencies]` block (examples can use dev-deps):
```toml
[dev-dependencies]
typst-as-lib = "*"   # pin the resolved version after first build
typst-pdf = "*"
```
> Note: `typst-as-lib` wraps the `World` trait setup (filesystem, fonts, packages). Confirm the current API at https://docs.rs/typst-as-lib and https://crates.io/crates/typst-as-lib — the sketch below is a starting point to make compile, not a guaranteed signature.

- [ ] **Step 2: Write a Rust example that compiles `.typ` → PDF bytes**

`resume-designer/src-tauri/examples/typst_spike.rs` (starting sketch — adapt to the crate's real API until it produces a valid PDF):
```rust
// Spike: compile a Typst source string to PDF bytes via typst-as-lib.
// Goal is a working call path + measurements, not production code.
use std::time::Instant;

const SOURCE: &str = r#"
#set page(width: 8.5in, height: auto, margin: 0.5in)
#set text(size: 10pt)
= Ada Lovelace
Analytical Engine Pioneer
== Skills
- Mathematics
"#;

fn main() {
    let t = Instant::now();
    // Adapt these calls to typst-as-lib's current API (see docs.rs):
    //   build an engine/template from SOURCE, compile, then typst_pdf::pdf(...).
    let engine = typst_as_lib::TypstEngine::builder()
        .main_file(SOURCE)
        .with_static_file_resolver([]) // fonts/packages as needed
        .build();
    let doc = engine.compile().output.expect("compile failed");
    let pdf = typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default()).expect("pdf failed");
    std::fs::write("/tmp/typst_spike.pdf", &pdf).unwrap();
    eprintln!("compiled {} bytes in {:?}", pdf.len(), t.elapsed());
}
```

- [ ] **Step 3: Run the example, then validate the output with the Task 1 checker**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer/src-tauri
cargo run --example typst_spike 2>&1 | tail -3
node /Users/ashshah/Projects/Resume-Designer/spikes/document-model/ats-order.mjs /tmp/typst_spike.pdf || true
```
Expected: prints byte count + compile time; `/tmp/typst_spike.pdf` opens and contains real "Ada Lovelace"/"Skills" text. **Success criterion:** a Rust call path produces a valid, selectable-text PDF.

- [ ] **Step 4: Measure the bundle-size impact**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer/src-tauri
cargo build --release 2>&1 | tail -2        # baseline + with the deps
ls -lh target/release/ | grep -iE 'resume|app' || true
```
Record: release binary size delta from adding `typst-as-lib`/`typst-pdf`, and the compile time printed in Step 3.

- [ ] **Step 5: Note the sidecar alternative (no code — comparison only)**

In the findings doc (Task 6), record the CLI-sidecar comparison qualitatively: Tauri ships the `typst` binary as a sidecar and invokes it. Pros: trivial, always-current Typst. Cons: ~30 MB binary shipped, process-spawn latency, extra signing/notarization surface. Also note **`typst-bake`** (builds on `typst-as-lib`) which embeds fonts/templates/packages into the binary for fully offline, file-free compilation — a strong fit for this local-first app.

- [ ] **Step 6: Decide and record** (no commit of `Cargo.toml` to `next`)

Write the decision into Task 6's doc: **Rust-native via `typst-as-lib` (+ `typst-bake` for embedded fonts)** unless the spike surfaces a blocker (e.g., build/link failure, prohibitive size) — in which case CLI-sidecar is the fallback. Capture the actual measurements as evidence.

---

## Task 4: ProseMirror/TipTap schema can model a résumé (round-trip + DOM order)

**Why:** Proves the generic-block-tree schema can represent the résumé *and* that the editor's DOM order equals the model's reading order (the on-screen half of the ATS guarantee). TipTap is built on ProseMirror; we validate the schema with `prosemirror-model` directly and defer full TipTap editor wiring to Phase 2.

**Files:**
- Create: `spikes/document-model/tiptap/schema.mjs`
- Create: `spikes/document-model/tiptap/roundtrip.mjs`

- [ ] **Step 1: Define a minimal résumé schema**

`spikes/document-model/tiptap/schema.mjs`:
```js
import { Schema } from 'prosemirror-model';

// Minimal résumé schema. Reading order = depth-first node order.
export const resumeSchema = new Schema({
  nodes: {
    doc: { content: 'header section+' },
    header: { content: 'inline*', toDOM: () => ['header', 0], parseDOM: [{ tag: 'header' }] },
    section: {
      attrs: { sectionKind: { default: 'custom' } },
      content: 'heading block+',
      toDOM: (n) => ['section', { 'data-kind': n.attrs.sectionKind }, 0],
      parseDOM: [{ tag: 'section', getAttrs: (el) => ({ sectionKind: el.getAttribute('data-kind') || 'custom' }) }],
    },
    heading: { content: 'inline*', toDOM: () => ['h2', 0], parseDOM: [{ tag: 'h2' }] },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    bulletList: { group: 'block', content: 'listItem+', toDOM: () => ['ul', 0], parseDOM: [{ tag: 'ul' }] },
    listItem: { content: 'paragraph', toDOM: () => ['li', 0], parseDOM: [{ tag: 'li' }] },
    experienceItem: {
      group: 'block',
      attrs: { title: { default: '' }, org: { default: '' } },
      content: 'bulletList',
      toDOM: (n) => ['div', { class: 'exp', 'data-title': n.attrs.title, 'data-org': n.attrs.org }, 0],
      parseDOM: [{ tag: 'div.exp' }],
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }] },
    italic: { toDOM: () => ['em', 0], parseDOM: [{ tag: 'em' }] },
    link: { attrs: { href: {} }, toDOM: (m) => ['a', { href: m.attrs.href }, 0], parseDOM: [{ tag: 'a[href]', getAttrs: (el) => ({ href: el.getAttribute('href') }) }] },
  },
});
```

- [ ] **Step 2: Write the round-trip + DOM-order check**

`spikes/document-model/tiptap/roundtrip.mjs`:
```js
import { JSDOM } from 'jsdom';
import { DOMSerializer } from 'prosemirror-model';
import { resumeSchema as schema } from './schema.mjs';

// A résumé as ProseMirror JSON (sidebar kinds first, then main — model order).
const docJSON = {
  type: 'doc',
  content: [
    { type: 'header', content: [{ type: 'text', text: 'Ada Lovelace' }] },
    { type: 'section', attrs: { sectionKind: 'skills' }, content: [
      { type: 'heading', content: [{ type: 'text', text: 'Skills' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mathematics' }] }] }] },
    ]},
    { type: 'section', attrs: { sectionKind: 'experience' }, content: [
      { type: 'heading', content: [{ type: 'text', text: 'Experience' }] },
      { type: 'experienceItem', attrs: { title: 'Collaborator', org: 'Analytical Engine' }, content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Authored Note G.' }] }] }] },
      ]},
    ]},
  ],
};

// 1) Schema accepts it and round-trips losslessly.
const doc = schema.nodeFromJSON(docJSON);
const back = JSON.stringify(doc.toJSON());
if (back !== JSON.stringify(docJSON)) { console.error('❌ round-trip mismatch'); process.exit(1); }

// 2) DOM order == model order.
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
const serializer = DOMSerializer.fromSchema(schema);
const frag = serializer.serializeFragment(doc.content);
const wrap = dom.window.document.createElement('div');
wrap.appendChild(frag);
const domText = wrap.textContent.replace(/\s+/g, ' ').trim();
const order = ['Ada Lovelace', 'Skills', 'Mathematics', 'Experience', 'Authored Note G'];
const pos = order.map((t) => domText.indexOf(t));
const ok = pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1]));

console.log('DOM text:', domText);
if (!ok) { console.error('❌ DOM order ≠ model order'); process.exit(1); }
console.log('✅ PASS: schema round-trips and DOM order = model order');
```

- [ ] **Step 3: Run it — verify PASS**

```bash
cd /Users/ashshah/Projects/Resume-Designer/spikes/document-model
node tiptap/roundtrip.mjs
```
Expected: `✅ PASS: schema round-trips and DOM order = model order`. **Success criterion:** the schema represents the résumé, JSON round-trips losslessly, and the serialized DOM's text order equals model order.

- [ ] **Step 4: Commit (gated)**

```bash
git -C /Users/ashshah/Projects/Resume-Designer add spikes/document-model
git -C /Users/ashshah/Projects/Resume-Designer commit -m "spike(schema): résumé prosemirror schema round-trips, DOM order = model order"
```

---

## Task 5: Page-size pagination sanity check (Typst)

**Why:** Confirms the page-size feature's core mechanic — a fixed page size produces *real multi-page* output with content flowing across pages, while `auto` stays one tall page.

**Files:**
- Create: `spikes/document-model/typst/paged.typ`

- [ ] **Step 1: Author a long résumé at US-Letter**

`spikes/document-model/typst/paged.typ`:
```typ
#set page(width: 8.5in, height: 11in, margin: 0.5in)  // fixed Letter
#set text(size: 10pt)
= Ada Lovelace
#for i in range(60) [
  == Section #i
  Lorem ipsum dolor sit amet, consectetur adipiscing elit. #lorem(30)
]
```

- [ ] **Step 2: Compile and count pages**

```bash
cd /Users/ashshah/Projects/Resume-Designer/spikes/document-model
typst compile typst/paged.typ typst/paged.pdf
node -e "import('pdfjs-dist/legacy/build/pdf.mjs').then(async m=>{const d=await m.getDocument({data:new Uint8Array(require('fs').readFileSync('typst/paged.pdf'))}).promise;console.log('pages:',d.numPages);process.exit(d.numPages>1?0:1)})"
```
Expected: `pages: N` with N > 1. **Success criterion:** fixed page size paginates across multiple real pages (vs. `height: auto` which would be one tall page). Confirms pagination is "free" from Typst, validating the page-size feature mechanic.

- [ ] **Step 3: Commit (gated)**

```bash
git -C /Users/ashshah/Projects/Resume-Designer add spikes/document-model
git -C /Users/ashshah/Projects/Resume-Designer commit -m "spike(typst): fixed page size paginates; auto stays one page"
```

---

## Task 6: Findings & decisions document (the durable output)

**Why:** The prototypes are throwaway; *this* is what Phase 1 consumes. Records what worked, the embedding decision with measurements, and any spec adjustments.

**Files:**
- Create: `docs/superpowers/specs/2026-06-14-phase-0-findings.md`

- [ ] **Step 1: Write the findings doc**

`docs/superpowers/specs/2026-06-14-phase-0-findings.md` — fill each section with the spike's actual results:
```markdown
# Phase 0 Findings — Structured Document Model + Typst

## 1. Typst is ATS-correct (Tasks 1–2)
- Reading order = document/source order, independent of visual columns: PASS / FAIL (evidence).
- Text is real & selectable (not outlined, unlike Figma): PASS / FAIL.
- model→typst→PDF preserves order: PASS / FAIL.

## 2. Embedding decision (Task 3)
- Chosen: Rust-native `typst-as-lib` (+ `typst-bake` embedded fonts) | CLI sidecar.
- Evidence: release-binary size delta = ___ ; compile time = ___ ms ; build issues = ___.
- Rationale: ___.

## 3. Schema feasibility (Task 4)
- prosemirror schema round-trips résumé JSON losslessly: PASS / FAIL.
- DOM order = model order: PASS / FAIL.
- Schema notes feeding Phase 1 (node set adjustments): ___.

## 4. Page-size mechanic (Task 5)
- Fixed size paginates to multiple pages; auto = one tall page: PASS / FAIL.

## 5. Spec adjustments for Phase 1
- ___ (any changes to §5 model shape, §7 embedding, §11 phasing discovered here).

## 6. Go / no-go
- Architecture validated end-to-end? YES / NO. If NO: blocker + alternative.
```

- [ ] **Step 2: Commit the findings doc (gated) — this is the only artifact kept**

```bash
git -C /Users/ashshah/Projects/Resume-Designer add docs/superpowers/specs/2026-06-14-phase-0-findings.md
git -C /Users/ashshah/Projects/Resume-Designer commit -m "docs(spec): phase 0 spike findings + Typst embedding decision"
```

- [ ] **Step 3: Disposition the spike branch**

Decide with Ash: cherry-pick only the findings doc onto a `docs/` branch → PR into `next`, and leave `spike/document-model` unmerged (throwaway), or keep the spike branch for reference. Do **not** merge prototype code or the example-only `Cargo.toml` deps into `next`.

---

## Self-review notes (author)

- **Spec coverage (spec §11 Phase 0):** Typst-renders-a-résumé → Tasks 1–2; ATS extraction correctness → Tasks 1–2 (`ats-order.mjs`); TipTap schema prototype → Task 4; embedding decision → Task 3; (bonus) page-size mechanic → Task 5; durable decision record → Task 6. All Phase-0 gate items covered.
- **Throwaway discipline:** prototypes live under `spikes/` and example-only Cargo deps; only the findings doc is merged. Prevents spike code leaking into `next`.
- **Honesty on uncertainty:** Task 3's Rust sketch is explicitly a starting point to adapt to `typst-as-lib`'s real API; its success criterion (valid selectable-text PDF + measurements) is unambiguous.
- **Gating:** every commit step is marked gated on Ash's go-ahead, per the standing rule.
```
