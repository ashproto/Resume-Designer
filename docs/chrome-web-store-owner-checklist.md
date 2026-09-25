# On Paper Companion: first unlisted release

Prepared September 24, 2026; owner-status update September 25. This execution checklist distinguishes owner-reported Dashboard progress from independently verified checks. It does not establish review submission, deployment, or publication.

## Already prepared

- Extension 0.1.1 ZIP, validated packaging, listing icon, and small promotional tile.
- Listing description, permission explanations, privacy-practices worksheet, and reviewer test flow.
- Publisher choice: **HyperBuild, Inc**. Contact: **support@hyperbuild.com**. First visibility: **Unlisted**, with **macOS-only** support (macOS 14.4 or later). Windows will be added after testing.
- Functional macOS demo checks and automated checks recorded in [the readiness report](chrome-web-store-readiness-2026-09-24.md).

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

The public stable desktop app predates this Companion bridge. The isolated demo bundle is not a distributable release.

- [x] Owner explicitly authorized staging and committing the finished Companion work, pushing `feat/companion-extension`, and opening a draft PR to `next` on September 24, 2026. Merge and publication remain separate decisions.
- [ ] The assistant can create that PR, handle failures, and prepare the release notes once authorized.
- [ ] Review and authorize merging to `next`; test the signed beta artifacts produced by the existing desktop release workflow. Authorization to create a PR does not authorize merging it.
- [ ] Confirm launch, Keychain access, PDF generation, cold app launch from Companion, Chrome restart/re-pairing, and the core review/fill/tailor flow in a production-style installation. The owner selected a macOS-only first listing. Keep Windows support out of this initial listing; add it only after separate Windows validation.
- [ ] Review and authorize the promotion PR from `next` to `main`. This can release the desktop app and deploy website changes, so it is a separate release decision.
- [ ] The assistant verifies the resulting installer version, download URLs, signing/notarization evidence, and deployed policy/demo/JSON URLs, then inserts the exact versioned links into reviewer instructions.

Do not direct reviewers to an incompatible generic latest-release link. Do not distribute `/private/tmp/on-paper-demo/On Paper Demo.app`. Windows runtime/publisher-signing work is deferred beyond this macOS-only release. A cross-target compile is not a Windows runtime check. Do not regenerate the existing updater signing keys. Do not dispatch the desktop release from the feature branch: its current workflow treats every branch except `next` as the stable channel.

## 3. You: provide bounded AI reviewer access

No On Paper login account is needed. The owner committed to providing a dedicated, spending-capped OpenRouter key privately through the Dashboard **Password** field. Actual supply is not yet confirmed. This arrangement does not require the reviewer to fund a personal OpenRouter account.

Recommended setup:

- [ ] In [OpenRouter Keys](https://openrouter.ai/settings/keys), create a separate ordinary inference key named **On Paper CWS review** yourself.
- [ ] Use a small fixed lifetime credit cap, for example **$5 with no reset**. This is a suggested ceiling, not a purchase authorization or guarantee of sufficient review coverage. Confirm that the account already has sufficient credit; any credit purchase is your decision.
- [ ] If the dashboard offers expiry, allow enough time for review and possible resubmission (for example 60 days). Otherwise revoke the key manually afterward.
- [ ] Enter the dedicated key directly in the Chrome Dashboard’s private **Password** field and leave **Username** blank. Do not put it in the instructions text, this repository, the ZIP, a public listing, a screenshot, or this chat. Do not share your normal key, login, or a management key.
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

- [x] Store item created and package uploaded, per the owner’s report. Confirm the uploaded package is the final **on-paper-companion-0.1.1.zip**; upload only this extension ZIP when replacing the package.
- [x] **Store listing** saved per the owner’s September 25 report. Reconcile it with [the listing source](chrome-web-store-listing.md) and the final package before submission.
- [x] **Privacy practices** saved per the owner’s September 25 report. Reconcile the saved categories, permission justifications, and Limited Use certifications with the final disclosures before submission.
- [ ] Paste the finalized **Test instructions** with the exact compatible installer, public fictional fixtures, and tested model; enter the dedicated reviewer key separately in **Password**, leaving **Username** blank.
- [ ] In **Distribution**, choose **Unlisted** and the intended regions. Unlisted means anyone who has the Store URL can install it; it is not access-controlled private testing.
- [ ] Save and review the complete draft for missing fields and warnings. The assistant can help fill ordinary non-sensitive fields where browser access permits; browser control currently refused access to the developer console.

## 6. You: authorize submission and release

- [ ] Approve the completed package/listing and submit it for review. If desired, use deferred publication so approval does not immediately publish it.
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
