# On Paper Companion submission candidate — September 24, 2026

**Status: automated checks, main-candidate local live QA, final-build review/reconnect checks, and the native Library close recheck passed; production submission gates remain open.** This report records the pre-commit verification checkpoint. No Store upload, publication, or website deployment was performed. The owner subsequently authorized committing and pushing the Companion work and opening a draft PR to `next`; merge and release remain pending.

## September 25 security review candidate — 0.1.3

Version **0.1.3** supersedes both 0.1.2 and the uploaded 0.1.1 draft. Replace the Dashboard package before submission.

- Pairing now accepts only the official Store extension origin, matches the requested client ID to that origin, and derives claim identity from the browser origin. Approved grants are bound to that client. The known unpacked development ID requires both native debug and frontend DEV builds.
- Disconnect aborts extension mutation requests and invalidates desktop authorization before pending AI results can commit. Already committed writes retain durable success and idempotent replay; new authorization can replace revoked in-flight work.
- RED evidence: two pairing JavaScript cases and one Rust case, six extension disconnect races, three desktop stale-save cases, and one same-request retry case failed before their fixes.
- GREEN: **424 extension tests/14 files**, **2,065 desktop tests/129 files**, **11 Rust bridge tests**, and Windows cross-target compilation. The release-config origin helper rejects the unpacked ID. Extension lint passes; desktop lint has no errors and two existing unrelated warnings.
- Production build, strict Store validator, and ZIP integrity pass. ZIP: [`extension/artifacts/on-paper-companion-0.1.3.zip`](../extension/artifacts/on-paper-companion-0.1.3.zip), **674,051 bytes**, **12 files**; SHA-256 `09b56c74fb08c550208a889ca31d6194853a7f34087557094b14b2328bc1dd7c`.
- These changes have automated coverage and independent source review. The live Chrome sequence has not been repeated on 0.1.3, and no signed compatible production desktop installer has been released. Production pairing, cold launch/browser restart, and Store installation/update remain open gates.

## September 25 review-fix candidate — 0.1.2 (superseded)

Historical 0.1.2 evidence is retained below. Use 0.1.3 for the replacement package.

- Fix: if the active profile context changes after tailoring succeeds but before its connection refresh returns, discard the old result, clear profile-scoped review state, and adopt the current resume list without mapping or filling from the old context.
- Meaningful regression evidence: both a different-profile switch and a same-profile reload with a reused resume ID failed before the guard; all **50 sidepanel tests** passed after the fix, including same-context tailoring and changed-page behavior.
- Full extension suite: **415 tests passed across 14 files**. Extension lint, production build, strict Store validator, and ZIP integrity passed.
- ZIP: [`extension/artifacts/on-paper-companion-0.1.2.zip`](../extension/artifacts/on-paper-companion-0.1.2.zip), **673,259 bytes**, **12 files**.
- SHA-256: `986da1028dff5348057155b66e6de1cc5d6e3573bc766960adf999d681def502`.
- The package contains a runtime change; the earlier Chrome live checks below remain evidence for 0.1.1 and its predecessors, not a repeated live check of 0.1.2. Production installer, cold-launch/browser-restart, and Store-install gates remain open.

## September 24 candidate — 0.1.1 (superseded)

The previous macOS-first package is identified below. The separate hashes preserve which builds received the main functional checks and subsequent review/reconnect checks.

- Source state at verification: `feat/companion-extension`, based on `4840a475` plus the completed implementation later authorized for commit. The rebased history contains `next` commit `a955735f2c838ffe562a396947f5453c9c3f3bb0`.
- Version: **0.1.1**.
- ZIP: [`extension/artifacts/on-paper-companion-0.1.1.zip`](../extension/artifacts/on-paper-companion-0.1.1.zip), **672,930 bytes**, 12 files.
- SHA-256: `2c483546a2c390516d23006fa9f0bfedc47d0e5c219d0b92a31630218b77167e`.
- Main functional live QA used SHA-256 `193656b0308c1b1fc0303c18ec11d3fd98834197f72ca79b6ddb3a190a5c18d3`.
- The status-copy build, SHA-256 `241be32a10c185d72dd45c03fd32a6fb2c0fe84b4f0625ce80f999e2204a1bd4`, changed “Connection restored — review refreshed.” to “Review refreshed.” Its panel completed a new real-AI review and app quit/relaunch/reconnect checks.
- The publisher/support policy build, SHA-256 `10e2264f063a201c7e4952cdf52bec072660f54897abab9cef11e19c60e8ff4c`, retained identical runtime JavaScript and added the offline policy’s owner-provided publisher/support text and mail link, verified live. Packaging validator/test changes are not bundled.
- The final macOS-first package changes only the manifest description from that policy build. Runtime JavaScript and UI are identical; final build, strict validation, and ZIP integrity passed.
- Local app: `/private/tmp/on-paper-demo/On Paper Demo.app`. This is an isolated, ad-hoc-signed **debug demo**, not a production installer. Its debug-only credential feature does not change production Keychain identifiers or behavior.
- Rebuilt native executable SHA-256: `f480deb007abf2df458791e96a6bfd7c9c026aa5a1426f81f26b1c8a030d0355`; installed bundle signature verified. The latest native changes are copy only: shared publisher/support policy text and neutral Library empty-state text.

## Owner choices — updated September 25

- Publisher name: **HyperBuild, Inc**.
- Support/contact email: **support@hyperbuild.com**. Publisher verification is owner-reported complete; mailbox monitoring and domain ownership were not independently checked.
- First-release visibility: **Unlisted**; confirm the saved Distribution setting before submission.
- First-release platform: **macOS 14.4 or later only**. Windows release support is deferred until its testing is complete.
- Publisher registration/payment and verification are complete per the owner’s September 25 report. The owner also reports the Store listing, privacy fields, and screenshots saved. This is owner-reported Dashboard progress, not additional local test evidence or proof of submission/publication.
- The owner committed to providing a dedicated, spending-capped OpenRouter key privately in Dashboard **Password**, with **Username** blank. Actual supply remains unconfirmed. Enter the key in the native welcome wizard if needed or desktop **Settings → AI** afterward, and select tested **Claude Sonnet 4.6**; maintain access through review.
- Any required trader declaration and legal details are handled privately in Google’s Dashboard and were not independently inspected. A signed compatible macOS installer remains unavailable.

## Changes in this polish pass

- Running-app pairing now uses an approval-gated challenge/request/claim flow. This fixes reliance on a missing local URL-handler registration when the app is already running. Cold launching still needs a correctly registered installation.
- Connection operations have bounded waits, cancellation, and protection against late responses restoring a cancelled session. Recovery controls stay visible while connecting.
- Model selection searches by model/provider, displays the real app default, and retains explicit session overrides. Resume and model choices live in their respective Autofill and Tailor workflows.
- Reviews distinguish fields requiring on-page entry from unanswered editable fields. Fill requests retain the exact reviewed tab, URL, page context, and descriptors, including PDF retries.
- Query/fragment URLs work unchanged; navigation blocks a stale fill. Every field is revalidated immediately before writing, including changes caused by a preceding input handler.
- Hidden, disabled, read-only, and inert controls stay untouched. Directly hidden native upload proxies remain supported, while inactive containing steps do not.
- Fill respects disabled options, text-length limits, native input value constraints, and PDF-only attachment compatibility. Unknown factual answers and recognized sensitive/consent questions stay manual; AI narrative drafts require review.
- Updated offline/public policy sources, store copy, permission/data-use explanations, approved-brand listing assets, and durable fictional reviewer materials.

## Verification

| Check | Result |
| --- | --- |
| Extension full suite | **413 passed, 14 files**, on the publisher/support-policy source before the final manifest-description-only change; includes 24 new mail-link/resource/injection packaging cases |
| Extension lint | **Passed** on the publisher/support-policy source; only manifest description changed afterward |
| Desktop full JavaScript/UI suite | **2,051 passed, 129 files**, after the Library fix and before the final copy-only publisher/support and neutral Library text changes |
| Desktop lint | **0 errors, 2 existing warnings** in unrelated chat components |
| Native Rust bridge tests | **8 passed** |
| Native Clippy | **Passed**, `--lib --no-default-features -- -D warnings` |
| Windows GNU cross-target | **Passed**, default production features; compilation only |
| macOS isolated demo build | **Passed**, rebuilt after the Library fix; bundle signature and focused live close checks passed |
| Release workflows | **actionlint passed** |
| Existing branch commit messages | **24 commits passed commitlint** for `next..HEAD` using the actual CI working directory |
| Production extension dependencies | **npm audit: 0 vulnerabilities** |
| Store package | Final build, strict validator, and ZIP integrity **passed**; byte-identical repeated packaging was verified for the preceding main-QA artifact |
| Reviewer materials | Website JSON is byte-identical to the source fixture and passes the app import schema; page/download return HTTP 200 locally. Setup instructions preserve nine scanned fields, two sensitive blanks, the 7/9 preview, and submission cancellation |
| Policy mirrors | Final app/website policy paragraphs and date match exactly |
| Whitespace | **git diff --check passed** |

Meaningful new regressions were observed failing before fixes: in-flight field changes, inactive upload steps, query/fragment URL matching, factual-field drafts, and sensitive pay/work-eligibility labels. These are included in the final passing suite.

## Local live verification

After the user reloaded the extension, the main-QA artifact identified above passed the core checks in Chrome with the isolated macOS demo app and fictional data. The status-copy review/reconnect rows and final policy/native rows identify the subsequent checks. Provider requests used real AI.

| Check | Observed result |
| --- | --- |
| Warm pairing and revocation | Native approval appeared; native rejection, extension cancel/manual recovery, retry and approval, and disconnect/revoke while the app was running passed. |
| Model selection | Searched the 458-model catalog, selected Sonnet 4.5 explicitly, then reset to the Sonnet 4.6 app default. |
| Reviewed fill | Real AI produced a motivation narrative. Review contained nine fields with two manual; Fill populated seven, including the selected resume PDF with its filename visible. Work-authorization and EEO controls stayed blank. |
| Application log | An edited company value was logged and confirmed in the native app’s applied record. |
| Fit and tailoring | Fit analysis returned 84%. Tailoring created exactly one separate resume copy with a `(3)` name suffix, selected it, and prepared a fresh review without autofilling. The suffix is not a count of stored resumes. |
| Reusable answer | Manually entered availability was saved and subsequently reused. |
| URL and stale-review protection | A URL containing query and fragment was accepted. A fragment change blocked stale filling without overwriting a manually entered page value. A fresh review then filled seven fields. |
| Fixture console | No error or warning console entries were observed on the demo page. |
| Final offline privacy | Chrome rendered the bundled data-flow and Limited Use sections, “Published by HyperBuild, Inc”, and the actual `mailto:support@hyperbuild.com` link. |
| Status-copy build review | The panel reopened Connected, loaded the real model and resume, and completed a new real-AI review with nine fields, two manual, a motivation narrative, and reused availability. |
| Status-copy build app reconnect | Quitting the app showed Not connected and Open/Check/Reconnect review controls. After the rebuilt app was launched through desktop automation, Check connection restored Connected without re-pairing and cleared the old review for the fresh app context. This did not test URI cold launch or Chrome restart. |
| Rebuilt native Library | Library showed all four existing variants, including the base and the tailored copy with the `(3)` suffix. Close unmounted it correctly; reopening and pressing Escape also closed it. |
| Final native copy build | After the user approved its ad-hoc Keychain prompt, the final app started; neutral Library text and Close passed, all saved resumes were retained, and Chrome Check connection returned Connected without re-pairing. |

These are local functional checks, not completion of the full README manual checklist, Windows runtime coverage, or production-install verification. The status-copy build passed real-AI review and app reconnect checks. The final package retains identical runtime JavaScript and adds the verified offline publisher/support policy copy plus macOS-only manifest description. The separate native Library close bug was fixed and Close/Escape verified live; the final native copy build also passed its focused checks. The complete main-artifact functional sequence was not repeated on each later copy-only build.

## Open gates — updated September 25

1. **Saved screenshots:** the owner reports screenshots saved in the Dashboard on September 25. Confirm they match the final UI and contain only fictional data. At the September 24 checkpoint, PNG export was blocked by browser URL policy and no screenshot asset had been exported locally; the later owner report does not change that historical result. The required 128px listing icon and 440×280 promo tile are complete in [`extension/store-assets`](../extension/store-assets/README.md).
2. **Compatible public desktop release:** public stable `v2.2.0` lacks the required bridge protocol. Release an exact signed compatible macOS installer for the macOS-only first release. The local demo is not production installer or production Keychain validation. Windows signing/runtime checks are deferred to its future release.
3. **Public website:** live `https://onpaper.pro/privacy.html` returned HTTP 200 on September 24 but had neither the Companion section nor Limited Use text. Deploy the prepared policy and fictional reviewer page/download through the authorized release process, then verify the public URLs.
4. **Owner/store setup and reviewer access:** registration/payment, publisher verification, and saved listing/privacy fields/screenshots are complete per the owner’s September 25 report. Reconcile the saved draft with the final package and confirm macOS-only Unlisted Distribution. The owner committed to supplying a dedicated, spending-capped OpenRouter key privately through Dashboard **Password**, but actual supply remains unconfirmed. Successful use of the owner’s AI access in the local demo does not itself provide reviewer access. Confirm the dedicated key works with **Claude Sonnet 4.6** in native **Settings → AI** and stays usable throughout review. No credentials belong in public assets, instructions text, or the repository.
5. **First-release production/manual checks:** signed macOS app + Store-installed extension, URI cold launch registration, Chrome browser restart, and update/session behavior remain unrun. Complete the applicable macOS manual checklist before publication.
6. **Human trust-boundary review:** review the documented profile-wide pairing credential and same-user local-process trust model before broad launch.

## Future Windows release

The Windows GNU cross-target compilation passed; no Windows runtime or signed-installer proof is implied. Windows installer/signing, pairing, cold launch, fill/PDF, and Store installation/update checks are later-release gates, not blockers for the first macOS-only Unlisted release.

## Submission materials

- [Owner setup checklist](chrome-web-store-owner-checklist.md)
- [Listing and privacy-practices worksheet](chrome-web-store-listing.md)
- [Release operations and gates](chrome-web-store-release.md)
- [Reviewer instructions](chrome-web-store-reviewer-instructions.md)
- [Fictional page and resume setup](companion-reviewer-fixture.md)
- [Prepared listing artwork](../extension/store-assets/README.md)

Keep submission automation disabled until these gates close. Upload, review submission, and publication require a separate explicit authorization; a prepared ZIP is not a Store approval receipt.
