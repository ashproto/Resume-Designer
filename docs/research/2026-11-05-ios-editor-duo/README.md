# iOS editor polish and iPhone Duo research

Research date: November 5, 2026 Pacific. This package combines current Apple guidance, installed SDK evidence, the two supplied screenshots, and a source audit. The recommendation was subsequently approved and implemented locally; see the current status below. The audit and platform inventory describe the pre-change research snapshot.

## Recommendation

Use a concise section navigator that opens a focused content editor. Let the same navigator and editor appear together when the containing window has enough usable space. Move section placement, typography, grouping and deletion out of the main writing flow. Replace the custom floating action palette with native toolbar actions, and give the document canvas a single, measured geometry policy that respects each safe-area edge.

This is our proposed design for On Paper, informed by Apple’s guidance. Apple does not mandate a particular resume editor.

## What the screenshots and source reveal

The first screenshot is mostly a hierarchy problem. A section exposes its name, movement controls, placement, parent group, typography, content and deletion in one expanded row. The same title appears several times. Every section starts expanded, so routine writing begins with configuration and a long scroll.

The second screenshot shows expected Duo system UI alongside an app layout that was designed around a horizontal top/bottom bar arrangement. The side status region should remain system-owned. The app must adapt its content and controls around it.

The source confirms two risks:

- `NativeSectionCard` and `StructureSheet` combine writing and administration, with permanently active edit mode and no focused section destination.
- `CanvasHost` ignores all safe-area edges, while native CSS removes horizontal safe-area padding and reserves a fixed 52px only at the top and bottom. The custom bottom palette is an overlay with fixed horizontal geometry, rather than adaptive system toolbar content.

These explain the poor hierarchy and create a credible overlap risk. At the research stage, Duo insets and view frames still needed runtime measurement; screenshot pixels were insufficient evidence for a rail width or offset. Subsequent measurements are recorded in the runtime validation report. See the [source audit](current-ui-audit.md) for exact locations, existing safeguards, and regression risks.

## Apple guidance that changes the implementation

| Area | Verified guidance | Consequence for On Paper |
|---|---|---|
| Duo bars | Native navigation and toolbar actions can move into the side region; custom composite views do not adapt the same way. | Use individual native actions with a title and SF Symbol. Let the system arrange and overflow them. |
| Available space | Use the containing scene/view, size classes and independent safe-area edges; avoid device-name and screen-size assumptions. | Fit the document to the usable viewport. Preserve manual zoom, selection and drafts when the device changes pose. |
| Editing hierarchy | Succinct lists support navigation into details; secondary settings should not overwhelm the primary task. | A section row opens its content. Placement and appearance become contextual destinations. |
| Materials | Glass belongs to functional navigation/controls, with restrained use. | Use semantic grouped content surfaces and standard native chrome; adding blur to every card will not solve the hierarchy. |
| Accessibility | Layout must accommodate larger text, readable contrast, VoiceOver and alternatives to gestures. | Choose 44pt or larger tap surfaces for this editor, retain accessible Move commands, and adapt at large text sizes. |

Primary sources: [Duo preparation](https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo), [Raise the bar with iPhone Duo](https://developer.apple.com/videos/play/tech-talks/111462/), [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables), [Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls), [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), and [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).

The [Apple guidance synthesis](apple-guidance.md) covers fifteen core sources, links to additional API documentation, separates guidance from design inferences, and records exact availability.

## Two viable design directions

| Direction | What changes | Tradeoff |
|---|---|---|
| **Focused editing with adaptive columns — recommended** | An outline for Header & Contact, Main content and Sidebar. Short section previews/counts. Selecting a section opens a dedicated content editor; the outline can remain beside it at wider usable sizes. Section options contain appearance/placement controls. Arrangement is an explicit mode. | The clearest writing experience and best use of Duo space. Navigation, focus and selection need deliberate lifecycle handling. |
| **Refined collapsible form** | Keep the current screen, start sections collapsed, remove duplicate headings, and move secondary controls into section options. | Smaller interaction change and less implementation work, but the long-form structure and limited wide-screen experience remain. |

The proposed focused flow keeps the existing capability set:

- Header & Contact opens values first; template-aware row arrangement is a secondary destination.
- Summary opens a comfortable multiline editor, rather than an eight-line field inside a deep card.
- Experience, education and list sections use compact item rows leading to the relevant fields.
- Section options keep rename, area, parent group, independent heading/content typography, and confirmed deletion available.
- Arrange exposes drag handles with accessible movement alternatives. Add, Restore and parent-group controls stay contextual to the relevant area.
- A parent group remains visually distinct from its children and edits only its own heading style.

This work should preserve existing canonical Markdown and formatting. Clean outline previews can omit syntax visually; converting all native editing to a new rich-text storage/selection model would require a separate, tested round-trip design and is not implied by spacing polish.

## Duo and SDK strategy

The installed Xcode is 27.2 and an iPhone Duo simulator with its matching runtime is available. Existing CI uses Xcode 26.6. New iOS 27.1 symbols cannot compile with an older SDK merely because they are behind a runtime availability check.

Prefer existing system navigation, toolbar and safe-area APIs for the baseline. When built with the new SDK, standard controls receive Duo adaptation. Introduce `ReservedRegion` or `toolbarVerticalEdge` only where custom geometry actually needs them, with a deliberate build-toolchain/compilation strategy. Keep support for older supported iOS versions. The [platform note](duo-platform.md) records official sources, installed declarations, availability and the simulator inventory.

## Safeguards and acceptance criteria

Keep the shared JS store authoritative. Retain undo, native Review/Apply, canonical content paths, stable section identities, workspace/revision guards, save-failure messaging and focused-edit sync protection. A fold or resize must not reconstruct the document or discard a draft. Positional experience paths must not become long-lived navigation identities without validation.

Validate with the newer SDK on Duo outer/inner displays, portrait/landscape, partially folded poses and Split View on either side. Measure actual host/WebKit safe areas and viewports. Check keyboard dismissal, long content/names, focus and caret retention, manual zoom, fit behavior, toolbar overflow, share anchoring, and the ability to reach every field/action. Repeat with large Dynamic Type, VoiceOver, RTL, light/dark appearance, Increase Contrast and Reduce Transparency. Also run a conventional iPhone and older-supported-OS check.

Use existing shared/native parity tests for model and command behavior. Layout quality and geometry need runtime evidence, not tests that merely search Swift source strings. Report simulator, physical-device and live-provider validation separately.

## Current status

The user approved focused editing with adaptive columns. The implementation follows the [accepted design](../../superpowers/specs/2026-11-05-ios-editor-duo-design.md) and [implementation plan](../../superpowers/plans/2026-11-05-ios-editor-duo.md). The November 5 implementation phase left product changes local and uncommitted; no dependency or original native project/plist changes were needed. The owner subsequently authorized a separate feature PR and controlled TestFlight pilot, following the infrastructure bootstrap.

The implementation and local builds are ready. The final source passed 2,437 tests, the production frontend build passed, and lint had no errors with two existing warnings. Actual Xcode 27.2 apps ran on Duo, conventional iPhone and wide iPad simulators. Checks covered focused navigation, explicit Done, real text persistence, legacy consecutive formatting, wide columns/rotation, Arrange/item reordering, native Review/Apply and PDF/share. Runtime findings were corrected before final packaging.

Measured native/WebKit geometry confirms that the canvas excludes the Duo's right system rail exactly once, with native vertical toolbar actions. The local build package includes the device IPA, simulator app, screenshots, checksums and detailed QA. Those artifacts are retained locally and are intentionally excluded from this public repository. See [runtime validation](runtime-validation.md) for exact evidence and boundaries. Actual Duo Open/fold behavior remains unverified after black display captures; wide iPad testing is separate. Physical-device runtime, extended accessibility and local Xcode 26.6 validation were not performed.
