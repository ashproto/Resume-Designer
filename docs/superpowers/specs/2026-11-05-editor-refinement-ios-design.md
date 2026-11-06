# Editor refinement and native iOS parity

The user reported confusing contact breaks, drag squashing, percentage-input jumps, inherited parent typography, weak parent-heading hierarchy, and missing text-formatting controls. They requested full native iOS parity, a repaired Review button, and a local iOS build.

## Approved contact approach

The initial proposals of fixed visible rows and a line picker did not account for template defaults. The user approved a template-aware Automatic / Customize approach: preserve the selected template's actual flow by default, including wrapping; customization begins from the rows currently rendered in the resume and offers join, split, and move controls. Save custom arrangements separately for each layout. Reset restores that template's default without altering other layouts or contact values.

Use additive `contactLayouts[layout] = { mode: 'auto' }` or `{ mode: 'custom', rows: string[][] }`. Preserve old global order/break metadata until a layout is explicitly customized or reset. Read actual contact item geometry from the rendered header; do not guess the initial row arrangement. Empty contact values remain hidden and newly populated fields must remain visible. Existing link safety and inline field paths remain intact. Rows can still wrap if they exceed the available width; surface the actual rendered rows rather than implying a guaranteed fit.

## Section fixes and typography

Use translation without dnd-kit scale transforms for sortable cards. Size fields keep a local percentage draft, commit on Enter or blur, and clamp to 50–200 only on commit. Group typography applies to its heading only: groups contain no independent body, so hide group content typography controls. Child nodes reset their own variables. Parent headings use the same font role as child headings, with a larger and stronger default. Add independent title/content bold, italic, and underline flags, preserving each template's defaults when flags are absent.

## Native iOS

Expose the same generation assessment, corrections, independent writing detail and page targets, direct editor handoff, and saved-note access. Fix the native Review projection to accept actual change-set objects. Native section controls must support Main/Sidebar/Tools as peers, collapse, reorder, deletion, area changes, parent groups and typography, using the existing shared metadata and content paths. Native contacts use the same template-aware arrangement model and actual rendered-row snapshot.

## Verification and packaging

Use regression tests for actual drag transforms, draft input events, typography scope/defaults, contact measurement and transitions, bridge command guards and native projection. Build the shared frontend and native Swift sources. Preserve the user's maintained Xcode project and plist by building a filesystem copy, not a Git checkout. Produce a development IPA for registered devices and an ARM64 simulator package if available; do not publish or install over user data. Distinguish compiled/tested behavior from actual device and live-provider validation.
