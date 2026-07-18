# Chrome Web Store listing source

Status: **draft — reconcile against the final product before submission**.

This file keeps listing copy, permission explanations, reviewer notes, and data
disclosures aligned with the extension. It is not a published privacy policy.

## Listing copy

### Name

Resume Designer Companion

### Short description

Review and fill job applications with the local Resume Designer app.

### Single purpose

Help a user review and fill the job-application page they explicitly opened by
using résumés, profile data, saved answers, PDF generation, and AI settings from
their locally running Resume Designer desktop app.

### Detailed description

Resume Designer Companion brings your local Resume Designer workspace beside a
job application in Chrome.

On a page you explicitly choose, the extension can identify supported form
fields and job details, ask the running desktop app to prepare suggestions, and
show supported proposed values for review. Unsupported controls are listed as
manual-only and never expose a misleading editor. Nothing is filled until you
choose **Fill reviewed fields**, and the extension never activates the job
site's final Submit button.

The extension can also attach the selected résumé PDF, save an answer to the
active local profile when you explicitly request it, log an application in
Resume Designer, analyze fit, and create a tailored résumé through the desktop
app. AI requests use the OpenRouter API key and model configured in Resume
Designer; OpenRouter may route a request to the selected or fallback downstream
model provider. The extension does not contain or receive the API key.

Resume Designer for macOS 14.4 or later or Windows 10 version 1809 or later
must be installed and running for app-backed operations. ChromeOS and Linux are
not supported in this first release. There is no Resume Designer cloud account,
extension telemetry, or background job application service.

## Permission justifications

| Permission | Dashboard justification |
| --- | --- |
| `sidePanel` | Displays the field-review, autofill, connection, résumé, fit-analysis, and application-log interface beside the current job application. |
| `activeTab` | Grants temporary access only to the HTTPS application page where the user invokes the extension, instead of persistent access to every visited site. HTTP is accepted only for loopback development fixtures. |
| `scripting` | Injects packaged scanning and filling code into that explicitly selected page after a user action. It is not used for remote code or persistent monitoring. |
| `storage` | Holds the Resume Designer loopback pairing credential in memory-backed session storage, restricted to trusted extension contexts. It is cleared on extension reload, update, disable, or browser restart and is never persisted to Chrome's local or sync storage. |
| `http://127.0.0.1:17872/*` | Communicates only with the Resume Designer desktop app's loopback bridge on the user's own computer. It provides no general website access. |

The extension does not request `<all_urls>`, does not install a persistent
content script, and does not execute remotely hosted code. Dashboard answer for
remote code: **No, I am not using remote code.**

## Data flow and recipients

Disclose the behavior conservatively. The extension may handle:

- personally identifiable and profile information from a résumé, including
  name, email, phone number, employment, education, skills, and location;
- authentication information in the form of the memory-only local bridge
  pairing token;
- website content from the selected application page, including field labels,
  input types, native choices, job title, company, description, and current
  origin/path. URL credentials, query parameters, and fragments are discarded;
- form and user-provided content, including reviewed answers, a manually pasted
  job description, answers explicitly saved to a local profile, and application
  log details;
- the selected generated résumé PDF; and
- depending on the application and final product policy, sensitive voluntary
  questions concerning demographics, disability, veteran status, work
  authorization, location, or compensation.

Recipients and purposes:

| Recipient | Data and purpose |
| --- | --- |
| Resume Designer desktop app on `127.0.0.1` | Receives compact supported application descriptors and job context without the application URL, returns reviewed mappings/PDFs, and stores explicitly requested profile answers or application logs. |
| OpenRouter and the selected or fallback downstream model provider, through Resume Designer | May receive supported field labels/options, job title/company/description, selected résumé/profile content, and learned answers to map fields, analyze fit, or tailor a résumé. It does not receive the application URL. The OpenRouter API key and model are selected in the desktop app. |
| Current HTTPS job-application website | Receives only values the user tells the extension to fill and any reviewed résumé PDF attachment. The site may autosave form edits or upload a selected file immediately. HTTP is allowed only for a loopback development fixture. |
| Resume Designer developer | Receives no extension telemetry or application data. There is no developer-operated companion backend or cloud sync in v1. |

Raw page HTML, live DOM nodes, full URLs, query strings, and fragments are not
sent to Resume Designer or the AI provider. Password inputs and unsupported
custom controls are excluded from AI mapping; password inputs are also excluded
from scanning, marking, review, saving, and filling. The extension does not
submit an application.

Before completing the Dashboard data-use checkboxes, compare its current
category labels with this inventory and the public privacy policy. At minimum,
review categories corresponding to personally identifiable information,
authentication information, location, website content/current URL or browsing
activity, and user-provided form content. Do not omit a category merely because
processing occurs locally or is sent to a provider chosen by the user.

## Limited-use statements to verify before certifying

- Data is used only to provide or improve the extension's disclosed
  application-review, filling, résumé, analysis, and local logging features.
- Data is not sold.
- Data is not used for personalized advertising or creditworthiness/lending.
- Human access by the developer does not occur because there is no developer
  backend or telemetry path.
- Transfers to the configured AI provider and application website are clearly
  disclosed in-product and in the privacy policy before processing.

These statements must be re-audited against the shipped code and any later
analytics, crash reporting, accounts, sync, or hosted AI service before the
Dashboard certification is submitted.

## Reviewer instructions draft

1. Install the current stable Resume Designer desktop app from the release URL
   supplied in the listing and launch it.
2. Configure the reviewer test profile, résumé, OpenRouter key, and model as described in
   the confidential Test instructions field. Do not put credentials in public
   listing copy or the extension package.
3. Install the Store revision and open the provided HTTPS reviewer fixture or
   test application page.
4. Invoke the extension on that page, choose **Open and connect**, and approve
   the actual access prompt in Resume Designer.
5. Select the test résumé and choose **Prepare autofill review**.
6. Confirm that all supported suggested values remain editable/reviewable and
   unsupported fields are clearly listed as manual-only without an editor.
7. Choose **Fill reviewed fields**. Confirm supported values and the résumé PDF
   are applied, but the final application action is never activated.
8. Exercise **Analyze fit**, **Create tailored résumé**, explicit answer saving,
   and application logging if these are included in the submitted build.
9. Quit Resume Designer and confirm the side panel drops its connected state
   and offers to reopen the app.

The final reviewer package must provide a stable desktop installer, stable test
page, and any necessary test-only provider configuration for the full review
period.

## Listing assets

- [x] 128×128 package icon: `extension/icons/128.png`.
- [ ] At least one 1280×800 screenshot (up to five), including connection,
      review, fill-result, and fit-analysis states where useful.
- [ ] Required 440×280 small promotional tile using final branding.
- [ ] Optional 1400×560 marquee promotional tile, if desired.
- Public privacy-policy URL.
- Public support URL.
- Homepage URL.
- Support contact email.
