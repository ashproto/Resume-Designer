# Chrome Web Store listing source

Status: **submission copy prepared; owner fields and release evidence below must be completed before upload**.

Official requirements checked September 24, 2026. No Store upload, submission, publication, or website deployment is implied by this document.

This file keeps listing copy, permission explanations, reviewer notes, and data
disclosures aligned with the extension. It is not a published privacy policy.

## Listing copy

### Name

On Paper Companion

### Short description

Review and fill job applications with On Paper. Requires On Paper for macOS and your own OpenRouter key for AI.

### Single purpose

Help a user review and fill the job-application page they explicitly opened by
using resumes, profile data, saved answers, PDF generation, and AI settings from
their locally running On Paper desktop app.

### Detailed description

On Paper Companion helps you prepare and review a job application beside the page in Chrome. This first release requires the On Paper desktop app for macOS. AI suggestions, fit analysis, and tailoring require your own OpenRouter account, API key, and access to a model; provider charges may apply. The extension does not include AI credits.

Choose a resume from your On Paper workspace, scan the application you opened, and review suggested answers before filling. Edit or leave out values, attach the selected resume PDF, save a reusable answer, and record the application in On Paper. You can also analyze the role and create a tailored resume copy.

You remain in control. The extension fills only after you choose **Fill reviewed fields** and never activates a website’s final Submit button. Sensitive questions are kept manual on the application page. Some websites use custom controls that require manual entry; this extension does not promise support for every application form. A website may save edits or upload an attached PDF before you submit.

Before connecting, you see a disclosure explaining the data flow. Selected resume/profile content, saved answers, supported field descriptors, and job context can pass through On Paper to OpenRouter and the selected or fallback model provider. Your OpenRouter key stays in the desktop app. The extension has no advertising, developer telemetry, or hosted companion backend. Saved workspace records may sync through your own iCloud account on supported Apple devices.

Requires Chrome 116 or later and a compatible On Paper desktop release on macOS 14.4 or later. This release supports macOS only; Windows is not supported in this release. Keep the desktop app running while using the extension. ChromeOS and Linux are not supported. No On Paper account is required. Desktop download: onpaper.pro. Support: support@hyperbuild.com.

### Listing fields to enter

| Dashboard field | Value or required action |
| --- | --- |
| Name | On Paper Companion |
| Publisher name | HyperBuild, Inc — owner-selected; registration/payment completed per the owner’s report; Dashboard identity verification remains unconfirmed |
| Language | English |
| Category | Productivity (confirm the current dashboard category label) |
| Homepage | https://onpaper.pro |
| Privacy-policy URL | https://onpaper.pro/privacy.html — deploy the Companion and Limited Use disclosures before submitting |
| Support URL | https://github.com/ashproto/Resume-Designer/issues — public support; do not post private data |
| Support/contact email | support@hyperbuild.com — owner-provided; mailbox/domain and Dashboard verification remain unverified |
| Initial visibility | Unlisted — owner-selected for the first release; not yet applied in the Dashboard |
| First-release platform | macOS 14.4 or later only; Windows is deferred until testing is complete |
| Trader declaration/details | Declaration in progress; complete the legally applicable declaration and required identity/contact verification. Completion and legal details are not yet confirmed |
| Desktop download | Supply an exact signed production macOS release that implements the required companion bridge; do not send reviewers to the older generic latest release |

## Permission justifications

| Permission | Dashboard justification |
| --- | --- |
| `sidePanel` | Displays the field-review, autofill, connection, resume, fit-analysis, and application-log interface beside the current job application. |
| `activeTab` | Grants temporary access only to the HTTPS application page where the user invokes the extension, instead of persistent access to every visited site. HTTP is accepted only for loopback development fixtures. |
| `scripting` | Injects packaged scanning and filling code into that explicitly selected page after a user action. It is not used for remote code or persistent monitoring. |
| `storage` | Stores the first-use disclosure choice locally and the On Paper loopback pairing credential in memory-backed session storage, restricted to trusted extension contexts. The credential is cleared on extension reload, update, disable, or browser restart and is never persisted to Chrome’s local or sync storage. |
| `http://127.0.0.1:17872/*` | Communicates only with the On Paper desktop app's loopback bridge on the user's own computer. It provides no general website access. |

The extension does not request `<all_urls>`, does not install a persistent
content script, and does not execute remotely hosted code. Dashboard answer for
remote code: **No, I am not using remote code.**

## Data flow and recipients

Disclose the behavior conservatively. The extension may handle:

- personally identifiable and profile information from a resume, including
  name, email, phone number, employment, education, skills, and location;
- authentication information in the form of the memory-only local bridge
  pairing token;
- website content from the selected application page, including field labels,
  input types, native choices, job title, company, description, and current
  origin/path, plus the full tab address temporarily held in extension memory
  only to bind filling to the reviewed tab and address. This full address,
  including query parameters and fragments, is not stored, logged, or sent
  to the desktop app or AI provider;
- form and user-provided content, including reviewed answers, a manually pasted
  job description, answers explicitly saved to a local profile, and application
  log details;
- the selected generated resume PDF; and
- sensitive question labels concerning demographics, disability, veteran status,
  work authorization, or compensation, identified only to keep those controls
  manual on the page; their answers are excluded from mapping, saving, and filling.

Recipients and purposes:

| Recipient | Data and purpose |
| --- | --- |
| On Paper desktop app on `127.0.0.1` | Receives compact supported application descriptors and job context without the application URL, returns reviewed mappings/PDFs, and stores explicitly requested profile answers or application logs. |
| OpenRouter and the selected or fallback downstream model provider, through On Paper | May receive supported field labels/options, job title/company/description, selected resume/profile content, and learned answers to map fields, analyze fit, or tailor a resume. It does not receive the application URL. The OpenRouter API key and model are selected in the desktop app. |
| Current HTTPS job-application website | Receives only values the user tells the extension to fill and any reviewed resume PDF attachment. The site may autosave form edits or upload a selected file immediately. HTTP is allowed only for a loopback development fixture. |
| Apple CloudKit, through On Paper on supported Apple devices | Saved resumes, profiles, reusable answers, and application records may automatically sync to the user’s own iCloud account. |
| On Paper developer | Receives no extension telemetry or application data. There is no developer-operated companion backend. |

Raw page HTML, live DOM nodes, full URLs, query strings, and fragments are not
sent to On Paper or the AI provider. Password inputs and unsupported
custom controls are excluded from AI mapping; password inputs are also excluded
from scanning, marking, review, saving, and filling. The extension never
activates a website’s final Submit control.

Before completing the Dashboard data-use checkboxes, compare its current
category labels with this inventory and the public privacy policy. At minimum,
review categories corresponding to personally identifiable information,
authentication information, location, website content/current URL or browsing
activity, and user-provided form content. Do not omit a category merely because
processing occurs locally or is sent to a provider chosen by the user.

## Limited-use statements to verify before certifying

- Data is used only to provide or improve the extension's disclosed
  application-review, filling, resume, analysis, and local logging features.
- Data is not sold.
- Data is not used for personalized advertising or creditworthiness/lending.
- Human access by the developer does not occur because there is no developer
  backend or telemetry path.
- Transfers to the configured AI provider and application website are clearly
  disclosed in-product and in the privacy policy before processing.

These statements must be re-audited against the shipped code and any later
analytics, crash reporting, accounts, sync, or hosted AI service before the
Dashboard certification is submitted.

## Reviewer instructions

Use [`chrome-web-store-reviewer-instructions.md`](chrome-web-store-reviewer-instructions.md) to complete the Dashboard **Test instructions** field. It contains a deterministic fictional test flow, expected results, manual-pairing recovery, and the owner inputs that must be resolved. Do not paste an unresolved placeholder or a developer API key into the Store.

No reviewer test account is currently available. Full AI review access remains unresolved: this BYOK product requires an OpenRouter account/key and an available model, and a reviewer must not be assumed to have funded access.

The app’s desktop dependency and BYOK requirement are visible in the public listing above. Provide an exact accessible signed macOS production installer and a durable fixture/import location for the full review period. The development-only demo app and `/private/tmp` files are not reviewer distribution artifacts.

## Listing assets

- [x] Final 128×128 listing PNG: `extension/store-assets/listing-icon-128.png`; approved 96×96 mark with 16 px transparent padding. Packaged extension icon remains `extension/icons/128.png`.
- [ ] At least one actual-product screenshot, preferably 1280×800 (640×400 accepted), up to five; square corners and full bleed. Capture review/fill, fit analysis, and pairing/privacy only after final UI validation, with fictional data and no tokens or keys.
- [x] Required 440×280 small promotional tile: `extension/store-assets/promotional-tile-440x280.png`, using final branding and the desktop-app requirement.
- [ ] Optional 1400×560 marquee promotional tile, if desired.
- Public privacy-policy URL: `https://onpaper.pro/privacy.html` (verify the deployed page includes the Companion section before submission).
- Public support URL: `https://github.com/ashproto/Resume-Designer/issues` (public; do not include private documents or credentials).
- Homepage URL: `https://onpaper.pro`.
- Support contact email: `support@hyperbuild.com` (owner-provided; mailbox/domain and Dashboard verification remain unverified).

## Privacy-practices worksheet

The final dashboard categories must match all handling, including local processing. Use this conservative inventory; inspect each current checkbox before certifying.

| Data category | Current behavior to disclose |
| --- | --- |
| Personally identifiable information | Resume/profile contact details, employment, education, and answers used for reviewed applications. |
| Authentication information | Session-only local pairing token. The OpenRouter key remains in the desktop app and authorizes the app’s provider requests. |
| Location | Resume/profile or application location; there is no geolocation permission or location tracking. |
| Web history / browsing activity | Selected page address, including query/fragment, held temporarily in extension memory to bind filling to the reviewed tab and address; origin/path used separately for job comparisons. No history API, continuous browsing collection, URL persistence/logging, or URL sent to the app or AI. |
| Website content | Job description, supported labels/options and other compact form descriptors from the page the user selected. |
| User-provided content | Resume PDF, edited answers, pasted job context, saved answers, and application log details. |
| Other sensitive content | Free-text resumes/answers can contain sensitive information even though recognized sensitive form questions are manual. Do not certify that sensitive information can never occur. |

Verify the public policy contains an affirmative Limited Use statement and accurately describes allowed purpose/recipients, no sale, no personalized advertising, no creditworthiness use, and the lack of developer data access. The extension’s loopback link is a same-computer native connection, not a network backend. Account/provider and application-site practices still need disclosure.

## Official source notes

- [User-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq): local handling is disclosed; same-computer native traffic is exempt from the transport-encryption rule; use the narrowest needed permissions. This does not exempt external AI/site traffic.
- [Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies): provide informed disclosure/consent and a public Limited Use statement; keep metadata and data-use declarations accurate.
- [Privacy dashboard](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy): explain the single purpose and each requested permission, then reconcile data-use declarations with the policy.
- [Manifest V3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements): packaged logic must remain reviewable; remote responses are data, never executable code. Current package uses MV3, a local service worker, explicit active-tab injection, and no remotely hosted code.
- [Image requirements](https://developer.chrome.com/docs/webstore/images): icon, small promo tile, and at least one screenshot are required. A marquee tile and video are optional. Recommended square artwork is 96×96 inside the 128×128 icon with transparent padding.
- [AI guidance](https://developer.chrome.com/docs/extensions/ai): disclose cloud AI sharing and protect API keys. BYOK is a supported pattern, not proof of Store approval.
- [Test instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions): the reviewer-only field supports instructions and restricted-account access. Establish safe reviewer access without embedding or disclosing a developer’s API key in package/listing materials.
