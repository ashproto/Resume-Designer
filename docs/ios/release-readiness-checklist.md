# iOS release checklist and review materials

Assessed September 22, 2026 against the current app, starting at commit
`75536fcd2ca429e454dd2f752e531539b9d5a8ac`. Local privacy and import-recovery changes
are in the working tree on top of that snapshot. Older phased plans are
historical context, not a list of features still missing.

## What the local audit establishes

The updated working tree passed **1,816 tests across 113 files**, including the
native Swift regression fixtures. ESLint has zero errors and two pre-existing
warnings. The production frontend build, full Swift iOS typecheck, Rust iOS
target check, and complete normally signed simulator build passed. The live
production dependency audit reported zero vulnerabilities; dependencies were
not changed by these fixes.

A complete **unsigned** iPhone Release archive also compiled using Xcode 27
(`27A266a`) and the iPhoneOS 27 SDK. Its bundle reports `com.onpaper.app`, version
and build `1.0.0`, minimum OS `26.0`, and includes `PrivacyInfo.xcprivacy`.
This checks release compilation and packaging, not distribution signing or
App Store validation. The candidate needs a submission-appropriate build number.

The simulator checks used a separate iPhone 17 / iOS 27.0 instance with no
iCloud account or AI key. The native policy opened, declining left sharing off,
accepting enabled it, and withdrawing disabled it and survived a force-stop and
relaunch. No paid AI request or real user's cloud data was used. The first
unsigned simulator build stopped at CloudKit's required-entitlement check;
normal simulator signing resolved that build-configuration failure.

The final simulator build also completed the keyless **New resume → Start from
scratch** interview, preview, creation, and return to the editor with fictional
data. The created resume remained selected after force-stop and relaunch.
Its PDF preview rendered successfully, and Save opened the iOS share sheet
with the generated 24 KB PDF. No file was sent to another person or service.
On a device signed out of iCloud, automatic first-run onboarding is deferred by
the existing account-readiness gate; the native **New resume** action works.

These checks do not establish distribution signing, App Store acceptance,
production CloudKit behavior, or the complete physical-device workflow.

Earlier **Development** builds already have documented Mac-to-iPhone and
iPhone-to-Mac verification, including matching documents and 100 history
entries; see the [September 21 verification record](../superpowers/plans/2026-09-19-macos-cloudkit-sync-plan.md#latest-verification-2026-09-21-implementation-b9594c38).
That evidence is retained, but does not replace testing the final candidate
against the **Production** CloudKit environment.

The current target has a scene manifest, CloudKit entitlements, separate
development/production APNs settings, a bundled required-reason privacy
manifest, and an opaque 1024 × 1024 marketing icon. Its bundle identifier is
`com.onpaper.app`; its minimum OS is iOS/iPadOS 26.0. The desktop identifier
remains `com.resumedesigner.app`. iOS does not install desktop updater artifacts.

The source fixes cover the following release blockers:

- Malformed resume JSON is refused before it can replace current work. Existing
  damaged records remain available for backup, and startup selects healthy work
  or safely clears the editor. Local/remote deletion uses the same recovery path.
- Incoming CloudKit documents and restored/undo/redo history cannot replace a
  healthy document with malformed data. Recovery copies remain intact.
- AI content requests require a durable, explicit permission on this device.
  The permission is excluded from backups and CloudKit, and Settings can revoke
  it. Native prompts handle cancellation, reloads, and lost replies; web prompts
  appear above onboarding.
- An offline privacy policy is accessible in Settings and the permission prompt.
- The native keyless wizard's preview now includes the fields Swift requires.
  Previously, finishing its interview advanced JavaScript but froze the native
  screen because the entire snapshot was rejected. Real Swift decoder tests
  cover interview, imported, and generated draft previews.

The policy text now lives in
[`privacyPolicy.js`](../../resume-designer/src/privacyPolicy.js), and the public
page is prepared at [`website/privacy.html`](../../website/privacy.html).
The public page is prepared locally; its publication has not been performed.

The current CloudKit behavior is automatic when iCloud is available, with a
device suspension after the user removes cloud data.
[`isSyncEnabled`](../../resume-designer/src/sync/syncModel.js) checks the
suspension flag, and native Settings offers **Resume syncing** after
a purge. API-key synchronization uses iCloud Keychain separately, within the
app's access group; it does not use CloudKit document records. The iPhone/iPad
and Mac apps currently have separate keychain access groups.

## Required before public submission

| Gate | Concrete completion evidence | Current evidence |
| --- | --- | --- |
| In-app privacy and AI permission | On a fresh installation, open the policy offline; decline AI sharing; exercise chat, import analysis, interview, job analysis, and generation; confirm declining makes no AI content request. Accept, run an AI action, withdraw in Settings, and confirm later actions require permission again. | Network-boundary regression tests and native simulator policy/decline/accept/revoke/restart checks passed. A funded live AI action and all physical-device entry points remain unrun. |
| Hosted privacy and support | Publish `website/privacy.html` to `https://onpaper.pro/privacy.html`, verify it returns the current policy without login, and enter it in App Store Connect. Verify the support route below. | Prepared locally only; publication and live checks remain outstanding. |
| Distribution artifact | Archive the complete Swift/Rust/web app with a supported shipping Xcode and iOS SDK, export for App Store Connect, and obtain successful upload/processing with no unresolved validation errors. Verify the signed bundle identifier, build number, CloudKit container, production APNs entitlement, and bundled privacy manifest. | Unsigned device Release archive compiled and bundle metadata/manifest checked. Distribution signing, validation, export, upload, and processing remain unverified. |
| Production CloudKit | Confirm `iCloud.com.onpaper.app` has the current schema deployed to production, including `kind`, `modifiedAt`, `payload`, and `asset`. Test sync from the distributed build on physical devices, including offline edits, conflicts, larger asset-backed data, account changes, deletion, and cloud-purge/resume. | Owner deployed the schema on 2026-09-22; the Production console shows all four fields with the expected types. Local code and automated checks exist; distributed-build physical-device results remain unverified. |
| Core device workflow | Test fresh install without a key, save/force-quit/relaunch, import, editing with the keyboard, PDF export/share, backups, profile switching, and optional AI on an iPhone and iPad. Check that malformed JSON is refused without replacing current work, and that a previously damaged saved resume can be backed up without blocking launch or losing later edits. Include offline/error states, landscape, larger text, and VoiceOver. Preserve the build number and results. | Final simulator keyless interview/create/relaunch and PDF preview/system share passed. Malformed import, sync, deletion, and history recovery passed automated regressions. Full physical iPhone/iPad workflow and accessibility matrix remain unrun. |
| Store metadata and review access | Complete the app record, screenshots, age-rating answers, app privacy answers, pricing/availability, support/privacy URLs, and reviewer access to AI. Confirm the record uses `com.onpaper.app`. | App record created as OnPaper - Career Workspace, Apple ID 6815088694; API verification confirms `com.onpaper.app`. Remaining store metadata and review access are unverified. |

Apple currently requires uploads to use the iOS/iPadOS 26 SDK or newer; that is
separate from the app's minimum supported OS. See
[Apple's SDK requirement](https://developer.apple.com/news/?id=ueeok6yw).

The committed `gen/apple/ExportOptions.plist` currently selects `debugging`.
Do not use that as proof of distribution readiness. The installed Tauri CLI
supports `--export-method app-store-connect` and `--build-number`; a release
operator can use those or Xcode's distribution flow. Select a new build number
appropriate to the actual App Store Connect record. No archive or upload is
authorized merely by this checklist.

An automated iOS release workflow is prepared in PR #133; see the
[TestFlight automation runbook](testflight-automation.md) for its activation and
pilot gates. The updated CI includes the SwiftUI target, simulator compilation,
and unsigned device archive. Hosted CI passed on the reviewed implementation;
account configuration and read-only API preflight are complete. Merge, Cloud
signing and an actual TestFlight pilot remain separate verification gates. A
reproducible, validated manual archive and upload are also sufficient for the first release. Broader OS
support, more templates, and deeper desktop parity can follow once the shipped
workflow is verified.

The signed-out empty canvas and automatic-onboarding deferral can be improved
after these blockers: native New resume remains available and was exercised.

## Privacy answers to resolve in App Store Connect

Do not copy the manifest's empty collected-data list into the store listing
without checking the outside services the release can use. A bundled privacy
manifest, the store's privacy answers, the public policy, and the consent screen
serve different purposes and need to agree with actual behavior.

| Data path | Current app behavior | Submission decision |
| --- | --- | --- |
| Local documents and settings | Stored on the device; new JSON backups exclude the API key. | On-device-only processing is not collection for Apple's label. Exported/shared copies are controlled by the user. |
| CloudKit | Workspace content and history sync automatically through the user's Apple account when available; cloud deletion suspends the device until the user resumes. | Apply Apple's rule for data handled by Apple; do not infer developer collection solely because iCloud is used. Confirm actual production configuration. |
| OpenRouter and downstream providers | AI requests can carry contact details, profile/resume content, job descriptions, chats, and imported text. Fallback can change providers; web search adds a search service. No app-level zero-retention restriction is currently sent. | Review allowed providers and retention/account settings. Resolve applicable contact information and user-content categories, purposes, and identity linkage. Do not claim universal zero retention, no training, or “Data Not Collected” without evidence. |
| Google Fonts | A Google-hosted saved/default font can trigger a font request. System fonts avoid new downloads for that style. | Review network metadata handling against Google's current policy. No resume text is included by the font loader. |
| GitHub and support | Desktop update/release requests and website hosting use GitHub. Public support posts can contain information the person chooses to submit. | Describe those uses accurately; never request resumes or credentials in a public issue. |

Apple defines collection by retention beyond servicing a real-time request, not
by every off-device transfer. Its disclosure exception for optional data has
several conditions; optional AI alone does not establish an exception. Use
[Apple's privacy definitions](https://developer.apple.com/app-store/app-privacy-details/)
alongside the current [OpenRouter policy](https://openrouter.ai/privacy) and
[provider policies](https://openrouter.ai/providers).

The policy reports provider differences honestly. Before submission, verify that
the providers and routing permitted by the app satisfy Apple's third-party data
protection requirements; do not replace that review with an unsupported promise
in the policy.

## App Store inputs prepared for review

- **App name:** On Paper.
- **Bundle identifier:** `com.onpaper.app`.
- **Privacy URL after publication:** `https://onpaper.pro/privacy.html`.
- **Existing public support route:**
  `https://github.com/ashproto/Resume-Designer/issues`. It is public; verify it is
  usable before entering it as the Support URL.
- **Screenshots:** capture the distributed candidate on supported iPhone/iPad
  sizes, using fictional career information. Show the editor, library/profile,
  and PDF result. Confirm the current required sizes in App Store Connect.
- **Age rating:** answer for the actual AI, web-search, and document features;
  do not copy the desktop website's assumptions.
- **AI review credential:** supply a funded, review-only OpenRouter key privately
  in App Store Connect's review information. Do not commit it, put it in a
  screenshot, or post it to GitHub. Keep it usable throughout review and revoke
  it afterward. This assessment did not create or provide a key.

Suggested review notes, to use only after checking them against the candidate:

> On Paper is a resume editor with optional AI assistance. No On Paper account
> is required. On the welcome screen, choose “Skip for now” to use the app
> without an OpenRouter key. Create or import a resume, edit it, and export a
> PDF through the system share sheet. On Apple devices, workspace data syncs
> through the user's own iCloud account when iCloud is available.
>
> To review AI, enter the review-only OpenRouter key supplied separately in the
> review information, then open the assistant or a generation feature. The app
> explains the information shared with OpenRouter and its model providers and
> asks for permission before sending it. Declining leaves document editing and
> export available. Settings provides the privacy policy and a way to withdraw
> permission for future AI requests. AI suggestions are reviewed before they
> change the resume.

Before submitting these notes, attach any exact navigation needed for the final
build and verify the reviewer credential. Do not assert production sync or
device checks passed until their results are recorded.

## Evidence to retain with the release candidate

Record the commit plus local changes included, app version/build number, Xcode
and SDK versions, focused and full test results, archive validation/upload
result, TestFlight installation results, production schema confirmation,
two-device sync results, policy URL response, and the completed metadata review.
Keep actual failures, unrun checks, and externally unverified checks separate
from passed checks.

Policy copy is shared by the in-app module and the static website page. When it
changes, update both and check that their section text matches. Publishing the
website and distributing an app are separate actions.

Relevant official references:

- [Apple review guidelines: privacy and data sharing](https://developer.apple.com/app-store/review/guidelines/#privacy)
- [Archive distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)
- [CloudKit production schema deployment](https://developer.apple.com/documentation/CloudKit/deploying-an-icloud-container-s-schema)
- [GitHub privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
- [Google privacy policy](https://policies.google.com/privacy)
