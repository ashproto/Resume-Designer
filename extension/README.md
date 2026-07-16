# Resume Designer Companion extension

The Companion extension scans a job-application form, asks the running Resume Designer app to propose values, lets you review every field, and fills only after you click **Fill reviewed fields**. It never sends the application. You always review the page and use the site's own final application button yourself.

## Requirements

- Google Chrome with Manifest V3 side-panel support.
- The Resume Designer desktop app running and unlocked.
- A resume variant in Resume Designer.
- Node.js `^20.19.0`, `^22.13.0`, or `>=24` to build from source.
- For AI mapping, an OpenRouter key and model configured in Resume Designer. The key stays in the app; it is never copied into the extension.

## Install from source

From this `extension/` directory:

```bash
npm ci
npm test
npm run lint
npx vite build
```

Then load the generated extension:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the generated `extension/dist` directory, not the source `extension` directory.
5. Keep the extension available in the toolbar. After rebuilding, use **Reload** on its `chrome://extensions` card.

The manifest intentionally requests only `sidePanel`, `storage`, `activeTab`, and `scripting`, plus access to the loopback bridge at `http://127.0.0.1:17872/*`. It does not request `<all_urls>`.

## Pair with Resume Designer

1. Start and unlock the Resume Designer desktop app.
2. In Resume Designer, open **Settings -> Data -> Companion extension**.
3. Reveal and copy the pairing token. Treat it like a password: it allows local access to your resume data while the app is running.
4. Open an HTTP(S) job-application page and click the Companion extension's toolbar button. This opens the side panel and grants access to that page.
5. Paste the token and choose **Pair extension**.
6. Wait for the green **Connected** indicator. It appears only after both the public health probe and an authenticated resume-list request succeed.

The token is stored in `chrome.storage.local`. If a restored backup changes the app's token, pair again with the token currently shown in Settings.

## Review and fill an application

1. Choose the resume variant to use.
2. Click **Scan page**. The content script extracts compact field descriptors and page context; it does not send raw HTML or the raw DOM.
3. Click **Create review**. Resume Designer fetches the current resume, shared profile, and learned answers, then uses the model configured in the app to propose values.
4. Review every item in descriptor order:
   - Edit text values inline.
   - Choose native values for select and radio fields.
   - Review checkboxes as explicit `true` or `false` choices.
   - Treat **Low confidence** values as needing extra attention.
   - Complete unsupported or manual file fields on the page yourself.
5. For a typed unanswered question, optionally click its own **Save answer** control. Editing, leaving a field, or filling never saves an answer implicitly. A saved answer becomes available to later mappings through the shared profile.
6. Click **Fill reviewed fields**. Empty unanswered fields and manual file fields remain local warnings instead of writing blank values. A recognized resume/CV upload receives the selected variant's generated PDF.
7. Inspect the application page and address every **Complete manually** or **Could not fill** warning. Custom comboboxes and button-backed Yes/No controls intentionally remain manual in v1.
8. Click the job site's own **Submit** (or equivalent final application action) yourself. The extension has no automatic application-sending capability or setting.
9. After filling, edit the scraped company and role if needed, then click **Log application** once. A successful create records the selected variant in Resume Designer's application tracker with `applied` status. Logging is separate from filling and does not send the application to the employer.

## Retry and connection behavior

- **PDF export already busy:** no page fields are changed. Choose **Retry fill** to resend the exact reviewed payload captured by the failed fill attempt.
- **Page access was lost:** after switching tabs or navigating across origins, click the extension toolbar button again on that page. The extension does not compensate with broad host permissions.
- **Timeout, network, or unavailable app window:** the panel asks **Is Resume Designer running?** Confirm that the desktop app is running and unlocked, then repeat the explicit action.
- **Disconnected startup:** the panel shows the plain message `Resume Designer must be running.` Start the app and pair if necessary.
- **Restricted browser page:** move to an ordinary HTTP(S) application page; Chrome does not allow injection into pages such as `chrome://extensions`.

## Privacy and trust boundary

- The bridge binds only to `127.0.0.1:17872`; it is not reachable from another machine.
- Every bridge endpoint except `/health` requires the pairing token.
- V1 trusts the same-user local processes and host. Loopback binding plus the bearer token does not defend against a malicious local process impersonating Resume Designer on the fixed port, or against a compromised host.
- The extension contains no OpenRouter key and makes no direct model request. AI calls go through the running app and its configured provider account.
- Compact field labels, types, native options, and required flags reach the user's configured model together with the selected resume data, shared profile, and learned answers. Labels and resume content are treated as untrusted data and cannot override the mapping instructions.
- Raw application HTML and DOM nodes do not leave the page. The generated resume PDF returns through the authenticated loopback bridge only when a reviewed resume-file marker requires it.
- The extension adds no account, cloud sync, telemetry, background job service, or remote companion backend.

## Supported controls and v1 limits

Supported native controls include text inputs, textareas, selects, native radio groups, independently described checkboxes, and standard resume/CV file inputs. Native browser-realm setters and `input`/`change` events are used so React and other controlled forms can observe edits.

V1 deliberately does not include:

- Automatic application sending or interaction with the site's final application action.
- Broad `<all_urls>` access or persistent access to every visited site.
- Site-specific shadow-DOM adapters, arbitrary custom typeahead automation, or forced interaction with Ashby-style button-backed checkbox controls.
- Automatic cover-letter or supporting-document attachment.
- A separate extension AI key, cloud account, hosted backend, or background desktop daemon.

Unsupported controls remain visible as manual warnings. The extension favors partial, reviewable success over guessing at a custom widget.

## Development commands

```bash
# Focused or full test suite
npm test

# ESLint
npm run lint

# Rebuild extension/dist
npx vite build
```

Scanner fixtures under `test/fixtures/` are sanitized snapshots derived from public Greenhouse, Lever, and Ashby application pages. Keep new fixtures free of applicant data and raw third-party secrets.

## Human verification checklist

The items below are intentionally manual release checks. Their presence is not a claim that they were performed during automated implementation.

- [ ] Load `extension/dist` in Chrome and confirm the extension card has no manifest warnings.
- [ ] Start Resume Designer, pair with the Settings token, and confirm the side panel shows the green **Connected** indicator.
- [ ] On a current Greenhouse application, run **Scan page** and **Create review**; confirm ordered descriptors, mapping, and native option values.
- [ ] On a current Lever application, run **Scan page** and **Create review**; confirm ordered descriptors, mapping, and native option values.
- [ ] Edit proposed text, select/radio, and checkbox values inline; confirm the reviewed payload reflects the edits.
- [ ] Fill a React-controlled input and confirm the visible page state registers the native `input` and `change` events.
- [ ] Fill a recognized resume upload; confirm the attached filename matches the selected variant and the file opens as a valid PDF.
- [ ] Include a custom combobox or button-backed Yes/No control; confirm it remains unfilled with a readable manual warning while supported fields still fill.
- [ ] Confirm no page is sent automatically and the extension never activates the site's final application action.
- [ ] Type a needs-human answer, click its explicit **Save answer** control, remap a later application, and confirm the learned answer is available.
- [ ] After filling, click **Log application** once and confirm the correct variant, edited company/title, and `applied` record appear in Resume Designer's tracker without duplicates.
- [ ] While the app's PDF preview/export path is busy, attempt a resume-file fill; confirm no page mutation occurs, **Retry fill** appears, and retry uses the captured values.
- [ ] Stop Resume Designer and confirm the disconnected/running-app guidance appears without exposing the token.
