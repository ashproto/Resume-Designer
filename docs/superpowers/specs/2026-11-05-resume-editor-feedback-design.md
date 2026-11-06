# Resume generation feedback and editor controls

The goal is to let users refine a generated resume in one continuous conversation and give them direct control over its length, sections, typography, and contact lines.

Use the existing React editor, local document storage, AI services, and reviewed change flow. Keep stored fields and inline editing paths compatible. Do not change release, native packaging, extension, or Git state.

## Approach

Continue from generation into the real editor with durable generation notes. Remove the intermediate reduced resume summary from generated-resume flows. The ready screen supports correcting assumptions through revision, and notes remain available after saving. Add concise, balanced, and detailed writing guidance independently of the existing approximate page target. Failed or cancelled revisions preserve the last usable draft.

Use one conversational, structured assistant protocol that returns a short reply and optional changes to the open resume. Every turn receives previous user and assistant turns, the current resume, target context, and generation notes. Advice and questions may return no edits; editing requests enter the existing change review. Exclude unchanged array entries from diffs.

Use additive section metadata to arrange built-in and custom sections together without migrating content out of existing fields. All section cards can collapse, move, and be removed. Sidebar sections can share visible parent group headings. Section heading and content typography can be adjusted. Resume rendering must honor ordering, grouping, and styling in every layout while preserving original inline editing paths and legacy defaults.

Add a start-new-line control to individual contact fields, alongside existing ordering. Save line breaks with the resume and honor them in all layouts, with safe links and inline editing intact. Empty fields must not produce empty lines or dangling separators.

The alternatives were isolated patches to the current split workflows, which leave conversation and section models fragmented, and a wholesale content migration, which risks existing AI/native/inline consumers. Additive metadata and a single assistant protocol cover the requested behavior with a smaller compatibility surface.

## Validation

Use request-level and component regression tests for assistant history, advice versus edits, generation revision and handoff, section controls, and contact rows. Test renderer behavior across all eleven layouts and old documents without metadata. Run the complete frontend suite, production build, and lint. Inspect rendered editor interactions and state in a browser where available. Distinguish automated validation from live AI-provider and native WKWebView validation.
