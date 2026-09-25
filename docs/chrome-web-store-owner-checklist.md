# On Paper Companion: first unlisted release

Prepared September 24, 2026. This is an execution checklist; it does not claim anything has been uploaded, deployed, or published.

## Already prepared

- Extension 0.1.1 ZIP, validated packaging, listing icon, and small promotional tile.
- Listing description, permission explanations, privacy-practices worksheet, and reviewer test flow.
- Publisher choice: **HyperBuild, Inc**. Contact: **support@hyperbuild.com**. First visibility: **Unlisted**, with **macOS-only** support (macOS 14.4 or later). Windows will be added after testing.
- Functional macOS demo checks and automated checks recorded in [the readiness report](chrome-web-store-readiness-2026-09-24.md).

The first submission can be manual. Google Cloud, service accounts, and GitHub-to-Store automation are optional later work. Leave `CWS_AUTO_PUBLISH` disabled.

## 1. You: finish the publisher account

Open [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) with the Google account that should own or administer HyperBuild's publisher.

- [x] Developer registration and the one-time registration payment are complete, per the owner's September 24 report. The Dashboard is now requesting the Trader / Non-Trader declaration.
- [ ] Enable Google Account **2-Step Verification** if it is not already enabled.
- [ ] Set the publisher name to **HyperBuild, Inc**.
- [ ] Set the contact email to **support@hyperbuild.com** and complete Google's verification email. Confirm this mailbox is monitored.
- [ ] Complete the applicable **Trader / Non-Trader** declaration (currently in progress). You decide the correct classification and supply any required legal name, address, phone, identity documents, or Payments-profile details directly to Google. Trader contact information can be public.
- [ ] Finish any remaining account verification and reach the publisher dashboard. Do not paste passwords, one-time codes, identity documents, or payment details into the chat.

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

No On Paper login account is needed. No reviewer AI access is currently available. Google needs a workable way to exercise the real AI features; do not assume the reviewer has a funded OpenRouter account.

Recommended setup:

- [ ] In [OpenRouter Keys](https://openrouter.ai/settings/keys), create a separate ordinary inference key named **On Paper CWS review** yourself.
- [ ] Use a small fixed lifetime credit cap, for example **$5 with no reset**. This is a suggested ceiling, not a purchase authorization or guarantee of sufficient review coverage. Confirm that the account already has sufficient credit; any credit purchase is your decision.
- [ ] If the dashboard offers expiry, allow enough time for review and possible resubmission (for example 60 days). Otherwise revoke the key manually afterward.
- [ ] Enter the key directly in the Chrome Dashboard's reviewer-only **Test instructions** field alongside the prepared instructions. Do not put it in this repository, the ZIP, a public listing, a screenshot, or this chat. Do not share your normal key, login, or a management key.
- [ ] Identify the tested model and direct the reviewer to enter the key in **On Paper desktop Settings → AI**, never in the extension.
- [ ] Keep the capped access available while review is pending, monitor usage, and revoke it when no longer needed. Later updates may need fresh review access.

The Test instructions tab itself is optional, but leaving AI features inaccessible risks an incomplete review. Free models are not a reliable substitute until the exact flows are tested against one.

## 4. You: capture one real product screenshot

- [ ] Open the fictional reviewer application with the Companion panel visible and a completed review. Show the AI narrative, selected resume/model, and manual sensitive fields using fictional data only.
- [ ] Capture a real screenshot with macOS's screenshot controls. Exclude keys, pairing tokens, account details, developer tools, and debugging banners.
- [ ] Produce at least one **1280 × 800** PNG/JPEG (640 × 400 is also accepted). Use square corners and actual readable UI. The 440 × 280 promotional tile is already prepared and does not replace the screenshot.

Automated screenshot export was blocked by the browser's URL policy in this session. Capture/save this asset manually; it is still outstanding.

## 5. Together: assemble the draft Store item

Once the production URLs and reviewer access are ready:

- [ ] Choose **New item** and upload **on-paper-companion-0.1.1.zip**. If a local handoff folder contains other files, upload only this extension ZIP here.
- [ ] Complete **Store listing** using [the listing source](chrome-web-store-listing.md): name, description, English, the appropriate Productivity category, homepage/support/policy URLs, icon, small promotional tile, and the real screenshot.
- [ ] Complete **Privacy practices** using the prepared single purpose, permission justifications, and data inventory. Answer remote code **No**. Check the actual current category labels against the inventory; confirm the truthful Limited Use certifications yourself.
- [ ] Paste the finalized **Test instructions** with exact installers, public fictional fixtures, tested model, and your dedicated reviewer key in the private field only.
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
