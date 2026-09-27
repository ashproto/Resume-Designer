# Companion live verification — September 27, 2026

The current candidate is **0.1.6**. The final guard package and automated checks passed, followed by a narrow browser check after owner reload. The earlier 0.1.6 baseline passed the local-fixture live retest. The historical **0.1.5** smoke below found a React-controlled checkbox/radio failure; the **0.1.6** retest closed that observed failure. Remaining manual and Store checks are still open. This is a partial manual verification record, not completion of the [extension manual checklist](../extension/README.md).

## Build and deployment evidence

- Desktop: installed, signed stable **On Paper 2.3.0**, from [release run 36266008253](https://github.com/ashproto/Resume-Designer/actions/runs/36266008253), source `de52d78cf4da2d6e5d80276de42e94e2e62532f3`. Both macOS architectures passed artifact/digest, strict signature, Gatekeeper, and app-staple verification. Native runtime checks used Apple Silicon; Windows runtime is outside this first macOS-only release.
- Browser: user-loaded unpacked **Companion 0.1.5**, whose 12 distribution files matched the verified ZIP: **680,614 bytes**, SHA-256 `d343207c0e36c190c1e2420ab63b046d5660f710146a2d690d7b8b5edb88bfdf`. These are historical package results, not the 0.1.6 digest.
- Live-tested **0.1.6 baseline**: source `321134e5c4f7bc699bcb50595e01ae0939d5f8e1`, before the final guard follow-up. **467 tests/15 files**, including **40 focused fill cases**, passed. Its 12-file ZIP was **681,084 bytes**, SHA-256 `8f0c7529136ff0f71b16540e1556d539c8be1f80ba80a20e0e7ed93dd56cf0e8`. The 0.1.6 live table below refers to this owner-reloaded build.
- Current **0.1.6 final guard package**: **487 extension tests/15 files**, including **60 focused fill cases**, passed. All **20 new mutation-matrix regressions** failed before the guard fix and passed afterward. ESLint, production build, strict Store packaging, and ZIP integrity passed. ZIP: **681,295 bytes**, **12 files**, SHA-256 `711a23befc1b76c7a2b2ba78fad91971a508cb9979d72e91f143de8fcf215de9`. No new dependency or native-app change is required. The narrow final-package check below passed after owner reload; the broader baseline live table remains evidence for its earlier bytes.
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

## Historical failure and baseline 0.1.6 retest

**Historical 0.1.5 failure: React-controlled native checkbox and radio.** The reviewed Hybrid radio choice and false checkbox value did not reach React state: the page retained an empty schedule and a true checkbox. Companion incorrectly reported Filled 10 fields, and a forced rerender retained the prior state. The **0.1.6** source fix passed automated regression, package checks, and the live retest below.

After [Codex review in PR #144](https://github.com/ashproto/Resume-Designer/pull/144#discussion_r4116563685), the final guard revalidates a clicked control’s exact type, availability, and sensitivity, then rechecks every checkbox-choice member after peer handlers. Automated checks and the narrow self-disabling-checkbox browser check of the rebuilt package passed. The results below remain evidence for baseline source `321134e5`, before this follow-up.

All ATS checks below used local sanitized fixtures, not live Greenhouse, Lever, or Ashby employer sites. The browser was manually paired to the correct fictional profile and model in installed signed On Paper 2.3.0.

| Baseline 0.1.6 check | Observed result and limit |
| --- | --- |
| React checkbox/radio and edited values | Reviewed Hybrid/false changed React state from an empty schedule/true checkbox to Hybrid/false. Edited text, native select, and textarea values persisted. A forced rerender preserved the filled values. A second fill produced no additional checkbox/radio events and no double toggle. Submission counters remained zero; the password stayed empty and the custom control stayed manual. |
| React PDF | Attachment was 43,192 bytes, application/pdf, with a valid %PDF- header. |
| Saved-answer reuse | The previously saved fictional answer Paper Plane Workshop was reused in a later review. |
| Fragment and path changes | A fragment-only URL change replaced the old Fill action with Refresh review; input/change counters stayed 19/19 with no writes. A later full-path navigation also blocked the old fill and required Refresh review without form writes. These checks do not cover every tab, origin, or form-mutation case. |
| Greenhouse fixture | Six descriptors retained their order, with two manual fields and one needing an answer. Reviewed Remote reached the native select; name, email, select, and hidden resume input filled (four fields). PDF was 43,192 bytes, application/pdf, with %PDF- header. Custom Country and work authorization stayed untouched; submit count stayed zero. |
| Lever fixture | Six descriptors filled, including native Design value design, Remote radio, JavaScript false as a no-op, and Accessibility true. Input/change counters were 5/5. PDF was 43,192 bytes, application/pdf, with %PDF- header; submit count stayed zero. |
| Ashby fixture | Four descriptors included two manual controls. Supported name and resume filled (two fields); PDF was 43,192 bytes with %PDF- header. Location combobox and button-backed Travel stayed untouched and manual, without an editable answer or Save answer control. Submit count stayed zero. |
| Manual description fallback | On the Ashby fixture, a manually supplied job description and the selected tailored fictional resume with Claude Sonnet 4.6 produced fit strengths, gaps, recommendations, and an observed score of 88%. The score is not a fixed expected result. |
| App exit and disconnected revoke | Quitting On Paper removed Connected status. Disconnect with the app closed explicitly reported that the browser was disconnected but other sessions could not be revoked. Reopening signed 2.3.0 and manually pairing restored Connected. |
| Chrome restart and final revoke | After quitting/relaunching Chrome, user tabs returned and Companion showed Not connected even though On Paper was running. Manual pairing restored Connected. Disconnect with the app running then confirmed app-access revocation and browser-session clearing. This demonstrates cleared authenticated session behavior, not a forensic disk inspection; production Store-ID automatic pairing remains untested. |

## Final guard package: narrow live check

The owner reloaded the final **0.1.6** package, SHA-256 `711a23befc1b76c7a2b2ba78fad91971a508cb9979d72e91f143de8fcf215de9`, and manually paired the correct fictional profile. A local native-checkbox fixture armed a click handler to disable that same checkbox. The review contained three fields: full name, portfolio true, and resume PDF.

Fill activated the checkbox exactly once, leaving it checked and disabled. Companion showed **Could not fill** with “This field changed since the review was prepared; prepare a new review”. The summary reported **Filled 2 fields**, correctly counting only the name and attached PDF (43,192 bytes, valid %PDF- header). Submit and direct-submit counters stayed zero. This verifies the final artifact’s self-disabling-target guard; the other mutation cases are covered by automated tests, not this one live check. The broader ATS/React/restart observations above remain explicitly tied to baseline source `321134e5`.

## Remaining verification

- [x] Record the exact 0.1.6 package, digest, and automated results above.
- [x] Reload baseline 0.1.6 and verify local controlled radio/checkbox state, events, rerender persistence, repeated fill, and no submission.
- [x] Reload the final guard package (`711a23be…`) and verify the self-disabling checkbox is reported unfilled, the summary excludes it, the name/PDF succeed, and no submission occurs.
- [x] Verify local Greenhouse/Lever/Ashby fixtures, manual controls, saved-answer reuse, fragment/path invalidation, description fallback, Chrome restart/manual pairing, and the stated disconnect cases.
- [ ] Complete remaining manual fault cases: rejected file assignment, uncertain application-write retry, missing/uninstalled native app or unavailable URI handler, and job changes during in-flight tailoring. The 487-test automated suite is separate evidence; successful ordinary logging/filling does not establish these manual failure paths.
- [ ] Complete the remaining applicable tab/origin/form-change and revoked/changed-session cases in the README matrix. Wrong-service/old-protocol coverage above used a disconnected setup; the restart check establishes UI/session behavior only.
- [ ] Verify fresh production Store-ID automatic approval/rejection with the actual Store-installed identity. The unpacked identity used here cannot establish that result.
- [ ] After Store approval, verify installation/update and re-pairing from the actual Store URL. Store submission, approval, publication, and installed-update results are not established by this record.

See [release operations](chrome-web-store-release.md) for preserved historical automated counts and package evidence, and the [owner checklist](chrome-web-store-owner-checklist.md) for Dashboard, reviewer-access, and submission gates.
