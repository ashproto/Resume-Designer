# Editor Refinement and iOS Implementation Plan

**Goal:** Make layout editing predictable and expose the same relevant controls in native iOS, then package a local test build.

**Spec:** `docs/superpowers/specs/2026-11-05-editor-refinement-ios-design.md`

**Constraints:** No Git operations, publishing, new dependencies, storage-key changes, or edits to the user's generated Xcode project. Keep canonical resume content paths and reviewed AI changes.

- [x] Diagnose drag scaling and percentage-input clamping with failing regressions.
- [x] Fix drag translation, draft size input, typography isolation, parent hierarchy and text formatting controls.
- [x] Implement template-aware contact metadata, rendering and actual-row measurement.
- [x] Replace desktop break checkboxes with Automatic / Customize row editing.
- [x] Implement native generation, saved notes, Review, unified section and contact parity.
- [x] Independently review the refinements, run full tests/lint/build, and inspect rendered controls.
- [x] Stage a filesystem copy, compile/package iOS simulator and development-device builds, verify signatures/entitlements/checksums, and preserve original project files.

Final source verification: 153 test files / 2,423 tests passed; ESLint reported no errors and two existing warnings. Independent review found no remaining issues. WebKit checks confirmed per-layout contact rows, parent/child typography isolation, stable controls across consecutive edits, and an 843px card retaining its height during a drag over a shorter card. Native production Swift contracts and compilation passed; native runtime and physical-device behavior remain untested.

Final packages are in `resume-designer/release/local-2026-11-05-editor-refinement-ios/`: development IPA, ARM64 simulator ZIP, signed Xcode archive, and Apple Silicon Mac DMG. Fresh native links and export passed. Actual packaged signatures, embedded final frontend asset identifiers, Development entitlements, 23 checksums, all 334 frozen product inputs, and unchanged original project/plist hashes were verified. Installation steps and detailed evidence are included in the release README and build report. No Git operations, installation, simulator launch, provisioning changes, or upload were performed.

## Runtime follow-up requested by the user

- [x] Install and launch the packaged iOS simulator app in a fresh workspace.
- [x] Exercise native contact rows, saved notes/discussion, parent/child typography, size fields, formatting, collapse, and real Review/Apply with synthetic responses.
- [x] Fix the discovered native Form picker hit-target problem and same-destination relocation behavior, add a regression, rebuild, and repeat runtime checks.
- [x] Verify accepted text after a clean relaunch; remove the fake API key, restore AI sharing to Not allowed, and remove the in-memory mock by relaunching.
- [x] Build and verify refreshed iOS packages and a Mac DMG in `resume-designer/release/local-2026-11-05-editor-refinement-runtime/`; record screenshots, diagnostics, signatures, and exact installed/package binary identity.
- [x] After the user's explicit save-and-relaunch approval, run the exact refreshed Mac build, verify controls and a live AI Review/Apply/restart flow in a synthetic workspace, then restore the original profile/document and reopen the normal app.

Runtime follow-up verification: 153 files / 2,424 tests passed; lint zero errors and two existing warnings. Native smoke checks passed on iPhone 18 Pro, iOS 27.2, using synthetic data and a debugger-installed response mock. The verified signed Mac app also passed focused controls and Review/Apply/restart checks using one live AI request in an empty synthetic profile; the original profile/document and normal app were restored afterward. Mac drag testing used the keyboard sensor. Physical devices and live CloudKit were not tested. No Git operations or edits to the original generated Xcode project/plist occurred.

## PR follow-up

The user subsequently authorized a new branch, commits, push, a PR targeting `next`, and a Codex review loop. That authorization supersedes the earlier no-Git constraint for this handoff. The shared chat factory default is Opus 5.5; saved explicit model selections remain respected. Existing user-owned Xcode project/plist edits and local release artifacts remain outside the PR.

Fresh PR validation: 153 files / 2,427 tests passed, including actual assistant-request default/explicit-model coverage and the invalid-selection fallback regression. Production Vite build and 90 release/iOS automation tests passed. Source lint reported zero errors and the same two existing warnings. The final fallback hardening has automated coverage; the earlier packaged runtime checks predate that small shared-JavaScript change.
