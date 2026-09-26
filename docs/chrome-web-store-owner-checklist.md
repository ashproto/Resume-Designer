# On Paper Companion: first unlisted release

Prepared September 24, 2026; owner-status update September 25. This execution checklist distinguishes owner-reported Dashboard progress from independently verified checks. It does not establish review submission, deployment, or publication.

## Already prepared

- Extension **0.1.3** uploaded per the owner. The final candidate is **0.1.5**, with patched dependencies and safe application retries after timeouts. Screenshots, Additional instructions, and a capped reviewer key are owner-reported saved. Listing icon and promotional tile are prepared.
- Listing description, permission explanations, privacy-practices worksheet, and reviewer test flow.
- Publisher choice: **HyperBuild, Inc**. Contact: **support@hyperbuild.com**. First visibility: **Unlisted**, with **macOS-only** support (macOS 14.4 or later). Windows will be added after testing.
- Dependency fixes in PRs #131 and #138 are merged into `next`; both full audits are clear. See [release operations](chrome-web-store-release.md) for current candidate tests, artifact digest, and open gates. Historical demo checks remain in [the readiness report](chrome-web-store-readiness-2026-09-24.md).

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

Public stable **v2.2.0** predates this Companion bridge. The intermediate **2.3.0-next.153** beta is signed and notarized, but the security follow-up and final production verification remain pending. The isolated demo bundle is not a distributable release.

- [x] The owner authorized merging PR #137 and completing the remaining release work, with dependency/security cleanup required **before opening the `next` → `main` promotion PR**.
- [x] PR #137 received the Codex thumbs-up and merged into `next` at `504c3ae986aa3dab254db9a76d8324c651bb7dca`.
- [x] [Beta release run 36189775315](https://github.com/ashproto/Resume-Designer/actions/runs/36189775315) succeeded. The Apple Silicon and Intel **2.3.0-next.153** artifact hashes, strict signatures, Gatekeeper acceptance, and app notarization staples were verified; the Apple Silicon app also passed startup, fictional resume import/PDF export, restart/persistence, and bridge-health checks. This intermediate beta does not include the pending dependency follow-up.
- [ ] Confirm launch, Keychain access, PDF generation, cold app launch from Companion, Chrome restart/re-pairing, and the core review/fill/tailor flow in a production-style installation. The owner selected a macOS-only first listing. Keep Windows support out of this initial listing; add it only after separate Windows validation.
- [x] Dependency fixes in PRs #131 and #138 are merged into `next`; promotion PR #139 is open.
- [ ] Finish PR #140, obtain fresh promotion CI/CodeQL and Codex approval, then complete the authorized main promotion and verify the resulting desktop release and website deployment.
- [ ] The assistant verifies the resulting installer version, download URLs, signing/notarization evidence, and deployed policy/demo/JSON URLs, then inserts the exact versioned links into reviewer instructions.

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

Once the production URLs and reviewer access are ready:

- [x] Store item created and **0.1.3** uploaded, per the owner’s report.
- [ ] Replace the draft package with the verified **on-paper-companion-0.1.5.zip** after its final checks pass. Use its matching desktop build; earlier desktop releases lack the safe-retry capability.
- [x] **Store listing** saved per the owner’s September 25 report. Reconcile it with [the listing source](chrome-web-store-listing.md) and the final package before submission.
- [x] **Privacy practices** saved per the owner’s September 25 report. Reconcile the saved categories, permission justifications, and Limited Use certifications with the final disclosures before submission.
- [x] Exact **463-character Additional instructions** pasted and dedicated key entered separately in private **Password**, per the owner’s report. Keep **Username** blank.
- [ ] Complete the linked public guide with the final verified, versioned compatible macOS installer and confirm the fictional fixture/download are deployed before submission.
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
