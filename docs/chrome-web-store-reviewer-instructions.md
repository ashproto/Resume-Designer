# On Paper Companion — reviewer instructions

Prepared for the Chrome Web Store Dashboard **Test instructions** field. This document contains no credentials. Complete the owner inputs before copying the instructions into the dashboard.

## Owner choices and remaining submission inputs

- The first Unlisted release supports **macOS 14.4 or later only**. A compatible signed Companion-enabled macOS installer is not yet available. Public stable v2.2.0 is incompatible. Before submission, replace the public setup guide’s installer-unavailable notice with the exact signed version and a persistent versioned macOS installer URL. Never substitute a generic latest-release link. The local **On Paper Demo.app** and debug-only credential feature are not production distribution.
- A public setup guide is prepared at [website/companion-review.html](../website/companion-review.html), planned for https://onpaper.pro/companion-review.html. It states the unavailable installer prerequisite and links to the fictional page/download, setup, pairing, AI-key requirements, and test flows. The fixture sources are documented in [companion-reviewer-fixture.md](companion-reviewer-fixture.md). Planned test URLs are https://onpaper.pro/companion-demo.html and https://onpaper.pro/assets/companion-reviewer-resume.json. This change does not establish deployed status: verify the guide, page, and download together after the authorized website deployment, and keep them accessible through review.
- For Chrome Web Store review, the review-only OpenRouter key is supplied privately through the Dashboard **Password** field. Reviewers enter it in the desktop app’s **Settings → AI**, or the native welcome wizard on first launch, and select **Claude Sonnet 4.6**, the tested model. Confirm that this review-only key/model remains usable throughout review. Never copy the key into the public guide, ZIP, screenshots, listing description, or repository.
- Publisher: **HyperBuild, Inc**. First-release visibility: **Unlisted**. Setup support: **support@hyperbuild.com**. Publisher registration and payment are completed per the owner’s report. The owner reports publisher registration and verification completed, and the Store draft, privacy fields, and screenshots saved. Dedicated reviewer AI access remains owner-managed.

## Dashboard fields

Leave **Username** blank. The owner enters the dedicated, spending-capped review-only OpenRouter key directly in **Password**; never copy it into these files.

Use the following **Additional instructions** (463 characters, within the 500-character limit). Save it as a draft until the guide is live and its compatible versioned installer is available.

```text
macOS 14.4+; Chrome 116+. No On Paper login. Follow https://onpaper.pro/companion-review.html for the compatible installer, fictional resume and test application. The Password field contains a review-only OpenRouter key; enter it in On Paper Settings > AI and select Claude Sonnet 4.6. Keep the app open and connect Companion. Test autofill review/fill, fit analysis and resume tailoring. Sensitive questions stay manual; the extension never submits applications.
```

## Full reviewer flow after those inputs are complete

This first Unlisted release requires Chrome 116 or later on macOS 14.4 or later, a compatible On Paper for macOS installation, and OpenRouter access for AI assistance. Use the review-only key supplied privately in the Dashboard **Password** field in the desktop app’s **Settings → AI**; select the tested **Claude Sonnet 4.6** model. It uses real AI; provider output and timing vary. It never activates a website’s final Submit control. Setup support is available at the owner-provided address support@hyperbuild.com.

1. On macOS 14.4 or later, install the exact signed On Paper for macOS release supplied with this submission. Keep one On Paper instance running. Follow the deployed **Companion reviewer setup** guide and the demo page’s **Set up the fictional reviewer resume** section to download the JSON, create the separate **Companion Review (Fictional)** profile, and import it through **Resume actions → Import…** (or **Menu → Import** in a narrow window); do not use personal career data. Enter the private Dashboard **Password** field’s review-only OpenRouter key directly in **Settings → AI**, select **Claude Sonnet 4.6**, then approve the native AI-sharing disclosure when prompted. No API key is entered into the extension.
2. Install this Store revision in Chrome and open the verified deployed page at the supplied URL (planned: `https://onpaper.pro/companion-demo.html`; do not use this planned address as a live reviewer URL until deployment is checked). Invoke the extension through Chrome’s toolbar on that page so active-tab access is granted.
3. Read **Before you connect**, open the privacy notice if desired, then choose **Agree and continue**. Pair with the running app. If automatic launch/pairing is unavailable, copy the local token from **Settings → Data → Companion extension** into **Pair manually** in the extension. Confirm **Connected**. Do not record or share the token.
4. Select the fictional resume and click **Prepare autofill review**. Wait for scanning and model preparation. The review should contain editable supported values, a resume-file choice, and manual-only unsupported/sensitive fields. Review or change a value before filling.
5. Choose **Fill reviewed fields**. Confirm supported values and the resume PDF appear in the page; recognized sensitive fields remain blank for manual entry. Confirm the site’s final Submit control is never activated. The supplied fixture must show a local completion preview and must not submit to an employer.
6. Run **Analyze fit** with the fixture’s job context. Confirm an explanation is shown; an exact score is not promised. Run **Create tailored resume**, then confirm the native app contains a new resume copy, the extension selects it, and the review is refreshed. Provider operations can take approximately a minute.
7. If the review contains an unanswered editable, non-sensitive field, enter a fictional answer and choose **Save answer**; confirm the extension shows **Answer saved**. This control is available only for eligible unanswered fields, so skip this check when the model supplies every supported answer. Saved answers are context for later reviews; there is no native saved-answer viewer. Separately choose **Log application** and confirm the fictional application record appears in the active On Paper profile. These actions are separate from activating an employer’s Submit control.
8. Choose **Disconnect** while the app is reachable. Confirm the extension clears its session and the app revokes prior companion access. Reconnect manually to continue. Quit the app and confirm connection status stops showing Connected and app-backed actions report that the app is unavailable.

## Expected boundaries

No `<all_urls>`, persistent content script, background job application service, extension telemetry, or remote executable code is used. The extension acts on the page selected by the user. Same-computer loopback communication is authenticated. External AI requests are made by the desktop app with the configured provider account; supported Apple workspace data may sync through the user’s iCloud account.

The user remains responsible for reviewing values and deciding whether to submit on a real application website. Some custom controls and recognized sensitive questions remain manual. Site autosave/file upload can occur when reviewed values are filled, even without pressing Submit.

## Evidence is separate from submission readiness

The current extension candidate is **0.1.3** and must replace the uploaded 0.1.1 draft. The profile-context, pairing identity, and disconnect persistence fixes pass the complete 424-test extension and 2,065-test desktop suites, 11 Rust bridge tests, lint, and strict packaging. Desktop lint retains two existing unrelated warnings. The live checks below describe earlier builds; they have not been repeated on 0.1.3.

The local macOS checks passed warm automatic native consent, rejection, extension cancel/manual recovery, retry/approval, and disconnect/revoke. Real provider mapping filled seven fields including a PDF, left two sensitive fields blank, and produced a 7/9 local preview; fit analysis, application logging, saved-answer reuse, and a tailored resume copy also passed. Later real-AI review and app reconnect checks passed. See the [readiness record](chrome-web-store-readiness-2026-09-24.md) for exact build provenance and remaining gates. For the first macOS release, URI cold launch, Chrome restart, the production signed macOS installer, and an actual Store-installed extension still require their own checks. Windows runtime/signing and release validation are deferred to a future Windows release and do not block this macOS-only submission.
