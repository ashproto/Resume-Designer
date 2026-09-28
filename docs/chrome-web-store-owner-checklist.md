# On Paper Companion: first unlisted release

Prepared September 24, 2026; release-status update September 28. This execution checklist distinguishes owner-reported Dashboard progress from independently verified checks. It does not establish Store review submission or publication.

## Already prepared

- Extension **0.1.3** uploaded per the owner. The current candidate is **0.1.6**, addressing the React-controlled checkbox/radio failure found in live **0.1.5** testing. Its final Companion package, including radio-peer identity checks and descriptor validation after every native activation, passed 570 tests, lint, build, and package checks. Earlier baseline and intermediate guard artifacts passed the live checks recorded below; final-package browser verification passed on September 28; see the [September 28 final-package live evidence](https://github.com/ashproto/Resume-Designer/pull/144#issuecomment-5878777958). Remaining manual and Store checks are open. Screenshots, Additional instructions, and a capped reviewer key are owner-reported saved. Listing icon and promotional tile are prepared.
- Listing description, permission explanations, privacy-practices worksheet, and reviewer test flow.
- Publisher choice: **HyperBuild, Inc**. Contact: **support@hyperbuild.com**. First visibility: **Unlisted**, with **macOS-only** support (macOS 14.4 or later). Windows will be added after testing.
- Dependency fixes and the Companion save/retry follow-up are merged into `main`; both full audits are clear. See [release operations](chrome-web-store-release.md) for historical 0.1.5 tests and artifact digest, and current candidate gates. The [September 27 live QA record](companion-live-qa-2026-09-27.md) records passed flows, the historical controlled-input failure, its 0.1.6 retest, and remaining limits. Historical demo checks remain in [the readiness report](chrome-web-store-readiness-2026-09-24.md).

The first submission can be manual. Google Cloud, service accounts, and GitHub-to-Store automation are optional later work. Leave `CWS_AUTO_PUBLISH` disabled.

## 1. You: finish the publisher account

Open [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) with the Google account that should own or administer HyperBuild's publisher.

- [x] Developer registration and the one-time registration payment are complete, per the owner’s report.
- [ ] Enable Google Account **2-Step Verification** if it is not already enabled.
- [x] Publisher **HyperBuild, Inc** is configured and verified, per the owner’s September 25 report.
- [ ] Confirm **support@hyperbuild.com** is monitored. Publisher verification is owner-reported complete; mailbox monitoring and domain ownership were not independently checked.
- [x] Publisher verification is complete per the owner’s September 25 report. Any required **Trader / Non-Trader** declaration and legal details are handled directly in Google’s Dashboard; this checklist does not reproduce or independently verify private identity details.
- [x] The owner reports reaching the publisher Dashboard and saving the Store draft. Do not paste passwords, one-time codes, identity documents, or payment details into the chat.

An optional verified-website badge is separate from the required email/trader steps. Do not make a badge a prerequisite for the first submission.

## 2. Together: release the compatible desktop app and website

Signed stable **On Paper 2.3.0** from [stable run 36266008253](https://github.com/ashproto/Resume-Designer/actions/runs/36266008253) provides the required desktop capability for Companion **0.1.5** and the **0.1.6** candidate. Use the verified versioned macOS installers: [Apple Silicon](https://github.com/ashproto/Resume-Designer/releases/download/v2.3.0/On-Paper_2.3.0_aarch64.dmg) and [Intel](https://github.com/ashproto/Resume-Designer/releases/download/v2.3.0/On-Paper_2.3.0_x64.dmg). The unpacked 0.1.5 production smoke passed manual pairing and core flows, but exposed the controlled-input blocker. The baseline 0.1.6 local-fixture retest passed; the intermediate guard package also passed its narrow self-disabling-checkbox check, and the final package passed the scoped September 28 checks recorded below. Remaining manual and Store checks stay open; the isolated demo bundle is not a distributable release.

- [x] The owner authorized merging PR #137 and completing the remaining release work, with dependency/security cleanup required **before opening the `next` → `main` promotion PR**.
- [x] PR #137 received the Codex thumbs-up and merged into `next` at `504c3ae986aa3dab254db9a76d8324c651bb7dca`.
- [x] [Beta release run 36189775315](https://github.com/ashproto/Resume-Designer/actions/runs/36189775315) succeeded. The Apple Silicon and Intel **2.3.0-next.153** artifact hashes, strict signatures, Gatekeeper acceptance, and app notarization staples were verified; the Apple Silicon app also passed startup, fictional resume import/PDF export, restart/persistence, and bridge-health checks. This historical beta predates the final dependency and save/retry fixes.
- [x] Installed stable **2.3.0** on Apple Silicon passed startup with saved settings, fictional-resume PDF export, quit/restart persistence, and bridge health; no Keychain prompt appeared.
- [x] Unpacked **0.1.5** passed manual pairing, reviewed text/select/PDF fill, application logging, fit analysis, tailoring, profile clearing, valid-token URI cold launch, and disconnect/revoke against installed stable **2.3.0**. See the [live QA record](companion-live-qa-2026-09-27.md) for the React checkbox/radio failure and limits.
- [x] Baseline unpacked **0.1.6** (source `321134e5`, ZIP `8f0c7529…`) passed the local controlled-input and sanitized ATS fixture retests, saved-answer reuse, fragment/path invalidation, description fallback, Chrome restart/manual pairing, and the stated disconnect checks. See the [live QA record](companion-live-qa-2026-09-27.md) for scope and limits.
- [x] Reload the intermediate **0.1.6** guard package (ZIP `711a23be…`) and verify the self-disabling checkbox is correctly reported unfilled, with only name/PDF counted and no submission. See the [live QA record](companion-live-qa-2026-09-27.md).
- [x] Verify the final **0.1.6** package (`63aeefa6…`) on September 28: React state/rerender/repeat, exclusive-checkbox fallback, changed-question/option guards, valid PDF, no submission, and running-app disconnect/revoke. See the [final live evidence](https://github.com/ashproto/Resume-Designer/pull/144#issuecomment-5878777958).
- [ ] Complete the remaining manual fault cases and fresh production Store-ID automatic approval/rejection; actual Store install/update is post-approval. Keep Windows support out of this macOS-only listing until separately validated.
- [x] Dependency fixes in PRs #131 and #138 and Companion hardening in PR #140 are merged into `main` through promotion PR #139; release notes from PR #141 are included.
- [x] Promotion CI and CodeQL passed, Codex review was clean, and PR #139 merged at `de52d78cf4da2d6e5d80276de42e94e2e62532f3`. Default-branch open Dependabot and CodeQL alerts were both zero on September 26; five workflow warnings were documented and dismissed as false positives.
- [x] Stable 2.3.0 macOS installer versions, downloads, signatures and notarization are verified. Public privacy, reviewer-guide, demo and JSON URLs returned HTTP 200 and matched deployed `main` commit `54fb8bcfa7bcb85819a131ff3418f2c7bb2fd062`, including the stable installer links in the guide and demo ([Pages run 36281866480](https://github.com/ashproto/Resume-Designer/actions/runs/36281866480)).

Do not direct reviewers to an incompatible generic latest-release link. Do not distribute `/private/tmp/on-paper-demo/On Paper Demo.app`. Windows runtime/publisher-signing work is deferred beyond this macOS-only release. A cross-target compile is not a Windows runtime check. Do not regenerate the existing updater signing keys. Do not dispatch the desktop release from the feature branch: its current workflow treats every branch except `next` as the stable channel.

## 3. You: provide bounded AI reviewer access

No On Paper login account is needed. The owner reports supplying a dedicated OpenRouter key privately in Dashboard **Password**, with a **$5 budget** and **30-day expiry**, and pasting the exact Additional instructions. This arrangement does not require the reviewer to fund a personal OpenRouter account. The key’s remaining credit and expiry have not been independently inspected.

Reported setup and remaining checks:

- [x] Dedicated review-only inference key supplied in private **Password**, with a **$5 budget** and **30-day expiry**, per the owner’s report. Keep **Username** blank. Never copy the key into the instructions text, repository, ZIP, public listing, screenshot, or chat.
- [ ] Confirm the remaining credit and expiry cover review and any resubmission; renew reviewer access if needed. Do not assume the $5 budget guarantees enough credit for every review attempt.
- [ ] Direct the reviewer to enter the key in the native welcome wizard if needed on first launch, or **On Paper desktop Settings → AI** afterward, and select the tested **Claude Sonnet 4.6** model. Never enter it in the extension or fixture website.
- [ ] Keep the capped access available while review is pending, monitor usage, and revoke it when no longer needed. Later updates may need fresh review access.

The Test instructions tab itself is optional, but leaving AI features inaccessible risks an incomplete review. Free models are not a reliable substitute until the exact flows are tested against one.

## 4. You: verify the saved product screenshots

- [x] Product screenshots saved in the Dashboard, per the owner’s September 25 report.
- [ ] Confirm saved screenshots show the final UI and fictional data only, excluding keys, pairing tokens, account details, developer tools, and debugging banners.
- [ ] Confirm at least one **1280 × 800** PNG/JPEG (640 × 400 is also accepted), square corners, and readable UI. The 440 × 280 promotional tile does not replace the screenshot.

Automated screenshot export was blocked at the September 24 local checkpoint. The owner subsequently reported screenshots saved in the Dashboard; that report does not add screenshot files to this repository.

## 5. Together: assemble the draft Store item

The production URLs are verified. Complete the candidate and reviewer-access gates before submission:

- [x] Store item created and **0.1.3** uploaded, per the owner’s report.
- [ ] Replace the uploaded **0.1.3** draft with **on-paper-companion-0.1.6.zip** only after its package and remaining checks are verified. Use stable **On Paper 2.3.0**; earlier stable desktop releases lack the safe-retry capability.
- [x] **Store listing** saved per the owner’s September 25 report. Reconcile it with [the listing source](chrome-web-store-listing.md) and the final package before submission.
- [x] **Privacy practices** saved per the owner’s September 25 report. Reconcile the saved categories, permission justifications, and Limited Use certifications with the final disclosures before submission.
- [x] Exact **463-character Additional instructions** pasted and dedicated key entered separately in private **Password**, per the owner’s report. Keep **Username** blank.
- [x] Public guide and demo contain the verified stable **2.3.0** installer links; the deployed pages and fictional fixture/download match the production source. Keep them accessible throughout review.
- [ ] In **Distribution**, choose **Unlisted** and the intended regions. Unlisted means anyone who has the Store URL can install it; it is not access-controlled private testing.
- [ ] Save and review the complete draft for missing fields and warnings. The assistant can help fill ordinary non-sensitive fields where browser access permits; browser control currently refused access to the developer console.

## 6. Complete the authorized submission and release

- [ ] After the security, installer, website, and production/manual gates pass, submit the completed package/listing for review under the owner’s existing authorization. If using deferred publication, approval does not immediately publish it.
- [ ] Respond to reviewer requests; keep installer/fixture URLs and capped AI access working. Review duration is variable. Deferred approved submissions must be published within Google's current allowed window (currently 30 days).
- [ ] After approval, publish the item as **Unlisted** when ready.
- [ ] Install from the actual Store URL and run the final install/update/re-pairing smoke check. Save the Store extension ID and URL in the release record.
- [ ] Only after the first manual release works, decide whether to configure the optional keyless GitHub publishing automation documented in [release operations](chrome-web-store-release.md).

## Official references

- [Registration and fee](https://developer.chrome.com/blog/cws-role-expansion-developer-dashboard)
- [Publisher account setup](https://developer.chrome.com/docs/webstore/set-up-account)
- [2-Step Verification](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)
- [Trader verification](https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq)
- [Listing and images](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Unlisted distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
- [Reviewer test instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)
- [Publishing and deferred publication](https://developer.chrome.com/docs/webstore/publish)
- [OpenRouter key limits](https://openrouter.ai/docs/api_reference/authentication)
