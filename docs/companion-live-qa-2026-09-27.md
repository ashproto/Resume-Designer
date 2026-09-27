# Companion live verification — September 27, 2026

The current candidate is **0.1.6**. Its package and automated checks passed; Chrome reload and the live retest are pending. The historical **0.1.5** smoke below passed core flows but found a React-controlled checkbox/radio failure that blocks release readiness. This is a partial manual verification record, not completion of the [extension manual checklist](../extension/README.md).

## Build and deployment evidence

- Desktop: installed, signed stable **On Paper 2.3.0**, from [release run 36266008253](https://github.com/ashproto/Resume-Designer/actions/runs/36266008253), source `de52d78cf4da2d6e5d80276de42e94e2e62532f3`. Both macOS architectures passed artifact/digest, strict signature, Gatekeeper, and app-staple verification. Native runtime checks used Apple Silicon; Windows runtime is outside this first macOS-only release.
- Browser: user-loaded unpacked **Companion 0.1.5**, whose 12 distribution files matched the verified ZIP: **680,614 bytes**, SHA-256 `d343207c0e36c190c1e2420ab63b046d5660f710146a2d690d7b8b5edb88bfdf`. These are historical package results, not the 0.1.6 digest.
- Current **0.1.6**: **467 extension tests/15 files**, including **40 focused fill cases**, passed; the real-React regressions failed before the fix and passed afterward. ESLint, production build, strict Store packaging, ZIP integrity, and all 12 ZIP/dist byte comparisons passed. ZIP: **681,084 bytes**, SHA-256 `8f0c7529136ff0f71b16540e1556d539c8be1f80ba80a20e0e7ed93dd56cf0e8`. No new dependency or native-app change is required. These checks do not establish the pending live result.
- Data: separate fictional reviewer profiles and resume, the public fictional application, and local form fixtures. No real application was submitted.
- Deployment: [reviewer guide](https://onpaper.pro/companion-review.html), [demo](https://onpaper.pro/companion-demo.html), [resume JSON](https://onpaper.pro/assets/companion-reviewer-resume.json), and [privacy policy](https://onpaper.pro/privacy.html) returned HTTP 200 and matched `main` commit `54fb8bcfa7bcb85819a131ff3418f2c7bb2fd062` from [Pages run 36281866480](https://github.com/ashproto/Resume-Designer/actions/runs/36281866480). The guide and demo include the verified versioned stable 2.3.0 installers. Keep these URLs available through review.

## Passed on unpacked 0.1.5

| Check | Observed result and limit |
| --- | --- |
| Consent and manual pairing | First-use disclosure and bundled privacy notice opened. Manual pairing connected to installed stable 2.3.0 and exposed the fictional resume and configured model. The native AI-sharing disclosure was acknowledged for the fictional flow. |
| Review and supported fill | Review contained nine fields, including two manual sensitive questions. Edited motivation text and native select value reached the public demo. The PDF filename and local preview confirmed attachment; seven of nine fields were completed, sensitive fields stayed blank, and no application was submitted. |
| Application logging | One explicit Log application action produced one Applied record on the selected fictional resume. This does not exercise an uncertain-write retry. |
| Fit and tailoring | Fit returned a 78% score and explanations; the score is an observation, not an expected constant. One tailoring action created and selected one new copy and refreshed the review. A deliberately edited page value stayed unchanged, demonstrating no implicit fill. |
| Profile isolation | Switching to an empty fictional profile cleared the old review and offered Add a resume. Returning to the original profile required a new review. |
| App exit and cold launch | Quitting On Paper removed Connected status. Open On Paper cold-launched the installed signed 2.3.0 through its registered URI handler and reconnected with the existing session. This is valid-token cold launch, not fresh Store-ID approval. After restart the panel required a fresh review; the prior review had already been cleared by the profile switch, so this did not test reuse of a stale review. |
| Controlled text/select/PDF | Local React-controlled text, textarea and select values updated React state. The attached PDF had MIME type application/pdf and a valid %PDF- header. Submit counters stayed zero. Password and custom combobox controls were excluded from autofill. Checkbox/radio results failed separately below. |
| PDF busy and retry | An open native PDF preview caused Fill to report another export in progress, with no page mutations. After closing the preview, Retry fill used the originally captured reviewed value rather than a later edit. |
| Disconnect | Disconnect while the app was running confirmed app-access revocation and cleared the browser connection. |
| Wrong service and old protocol | With On Paper quit and pairing revoked, a temporary wrong-service health response showed the companion-port conflict message; protocol 1 showed Update On Paper. Each fixture received exactly one GET /health, without Authorization and without follow-up requests. No stored credential existed: this is not an authenticated-session leakage test. The fixture server was stopped afterward. |

## Failed and incomplete

**Release blocker: React-controlled native checkbox and radio.** The reviewed Hybrid radio choice and false checkbox value did not reach React state: the page retained an empty schedule and a true checkbox. Companion incorrectly reported Filled 10 fields, and a forced rerender retained the prior state. The **0.1.6** source fix passed automated regression and package checks. Its live retest must still close this failure before submission.

**Save answer:** an explicit save was invoked for a fictional, non-sensitive answer. Reuse in a later review was not verified in this run. Earlier local saved-answer tests remain historical evidence only.

## Remaining verification

- [x] Record the exact 0.1.6 package, digest, and automated results above.
- [ ] Reload 0.1.6 in Chrome and verify controlled radio/checkbox state, event delivery, persistence after rerender, and no submission.
- [ ] Complete Greenhouse/Lever fixture checks and applicable custom-control checks; verify saved-answer reuse and page/tab/URL/form invalidation behavior.
- [ ] Complete the remaining applicable manual matrix, including description fallback, file-error handling, Chrome restart/re-pairing, unavailable/uninstalled app or URI handler, and revoked/changed-session cases. The wrong-service and old-protocol checks above cover only the stated disconnected setup.
- [ ] Exercise uncertain application-write retry and other remaining failure paths against the final build; ordinary successful logging does not prove those manual cases.
- [ ] Verify fresh production Store-ID automatic approval/rejection with the actual Store-installed identity. The unpacked identity used here cannot establish that result.
- [ ] After Store approval, verify installation/update and re-pairing from the actual Store URL. Store submission, approval, publication, and installed-update results are not established by this record.

See [release operations](chrome-web-store-release.md) for preserved historical automated counts and package evidence, and the [owner checklist](chrome-web-store-owner-checklist.md) for Dashboard, reviewer-access, and submission gates.
