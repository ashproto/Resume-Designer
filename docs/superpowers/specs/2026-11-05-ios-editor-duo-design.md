# Focused iOS resume editing and Duo adaptation

The user authorized proceeding with the recommendation in the [research package](../../research/2026-11-05-ios-editor-duo/README.md), delegating the remaining design decisions. The November 5 implementation authorization required uncommitted changes with no new Git operations, dependencies or release actions. The owner later authorized publication as a separate feature PR and a controlled TestFlight pilot after the infrastructure bootstrap.

## Intended experience

Edit Resume opens a concise native outline for Header & Contact, Main content and Sidebar. Rows have one meaningful title, a short readable preview/count, and clear parent/child hierarchy. Selecting a row opens its focused editor. On sufficiently wide usable space the outline and selected editor coexist in a native split view; compact layouts use normal back navigation. Selecting a group opens its own heading/options and its child list. The same selection and drafts survive layout changes.

Content is primary. Placement and typography live in secondary section options, with independent title/content styles and heading-only group styles. Arrangement is explicit rather than permanently active. Add, Restore, grouping, safe movement and confirmed deletion remain available. Header values come before template-aware contact-row settings. Multiline editing uses native space appropriately and preserves existing Markdown; display-only previews omit syntax. A rich-text storage conversion is outside this change.

Use semantic grouped surfaces and system text styles, restrained separators, appropriate SF Symbols and at least 44pt tap surfaces for this editor. Long labels and accessibility text sizes wrap or stack. Preserve save-failure notices and clear keyboard completion.

## Adaptive app shell

Replace the manually positioned bottom action capsule with native toolbar actions on the navigation container. Supply both titles and symbols so the system can choose horizontal, vertical and overflow representations. Preserve Undo, Redo, Assistant, Edit Resume, Design/Format, Share and Zoom. Zoom can open a small native control surface instead of taking permanent width away from every action; maintain existing fit/manual zoom semantics. Preserve format-selection ownership and export busy gating.

The canvas background may extend behind chrome, while meaningful document content and controls use measured usable bounds. Handle all safe-area edges independently, including a leading rail, and update geometry on resize, safe-area and keyboard changes. Swift/UIKit and WebKit must have one explicit inset owner; remove the parallel fixed 52px bar reservation. Avoid device-name checks, screen-size constants or guessed Duo rail/fold widths. Preserve native controller containment and custom pinch arbitration.

Prefer established navigation/toolbar/safe-area APIs so the source still compiles with the existing Xcode26.6 CI. Build and test with installed Xcode27.2 for actual Duo adaptation. Do not reference unknown27 SDK symbols solely behind a runtime availability check. Use new region APIs only if measured validation shows a need and compile compatibility is explicitly solved.

## Safety contracts

- JS store remains authoritative, with existing canonical paths, undo, section identity materialization, revision/workspace guards and signature-bound deletion.
- Re-resolve selected sections from current snapshots by stable card key. Invalidate unavailable or stale destinations rather than editing a different positional item.
- Retain focused native drafts and edit holders through selection, resize and keyboard changes; release/commit them on legitimate dismissal. Preserve data adoption protections.
- Keep groups and child typography isolated, percentage drafts stable, and same-destination moves as no-ops.
- Native Review/Apply, export/share, document switching and ordinary iPhone behavior must remain usable.

## Alternatives considered

The smaller alternative was a refined collapsible all-in-one form. It reduces immediate clutter but retains the long-form editing problem and limited use of wider space. The selected focused outline/detail direction provides a clearer writing task and a shared adaptive hierarchy. A permanent three-pane canvas/outline/editor workspace is deferred; it is unnecessary for this polish and would require more space and navigation complexity.

## Validation

Run meaningful behavioral regressions for shared geometry and existing native command/parity contracts, the Swift decoder tests, full shared-app tests, source lint and the production build. Compile the actual native app in an isolated filesystem stage that preserves the maintained original project. Test a Duo and conventional iPhone with synthetic content: focused editing, options, arrangement, grouping, typography, contact rows, undo, keyboard, share and Review. Check Duo inner/outer/rotated/folded configurations where simulator tooling permits; record unsupported poses instead of claiming coverage. Verify actual insets, fit/manual zoom, Dynamic Type, light/dark and accessible controls. Separate runtime evidence from source inspection and physical-device validation.
