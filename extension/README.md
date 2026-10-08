# On Paper Companion extension

The Companion extension scans a job-application form, asks the running On Paper app to propose values, lets you review every field, and fills only after you click **Fill reviewed fields**. It never activates the site’s final Submit control. You always review the page and use the site's own final application button yourself.

## Requirements

The first Unlisted Store release supports **macOS 14.4 or later only**. Windows code remains in the project; Windows release support is deferred until installation, signing, and runtime testing are complete.

- Google Chrome 116 or later.
- A compatible signed On Paper for macOS release installed for the first Store release. The extension can open it when an
  app-backed action needs it; the app must then remain running and unlocked
  while that action completes.
- A resume variant in On Paper for autofill; fit analysis and tailoring can start from your full profile.
- Node.js `^20.19.0`, `^22.13.0`, or `>=24` to build from source.
- Python 3 (optional; only needed to serve the local test fixtures).
- For AI mapping, your own OpenRouter account/key and an available model configured in On Paper. Provider charges may apply; AI credits are not included. The key stays in the app and is never copied into the extension.

If you are also running On Paper from source, install the Rust toolchain
and your platform build tools (Xcode Command Line Tools on macOS; Visual Studio
C++ Build Tools and the Windows SDK on Windows). Start the native app from the
repository's `resume-designer/` directory:

First export a full backup from your installed app: development and production
builds use the same `com.resumedesigner.app` data directory. Then quit every
installed or development On Paper instance. Only one process can bind
the fixed bridge port; otherwise the new bridge logs the port-bind failure and
does not start, and Chrome may connect to the wrong app instance.

```bash
npm ci
npm run tauri:dev
```

The browser-only `npm run dev` command does not start the loopback bridge and
cannot be used to pair the extension.

## Install from source

From this `extension/` directory:

```bash
npm ci
npm test
npm run lint
npm run build
```

Then load the generated extension:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the generated `extension/dist` directory, not the source `extension` directory.
5. Confirm the ID shown on the extension card is `keggfbelidgpjiapcbgkjidenhdjmega`.
6. Keep the extension available in the toolbar. After rebuilding, use **Reload** on its `chrome://extensions` card.

Version 0.1.9 and later include the published extension's **public** identity key,
so an unpacked build keeps the same ID regardless of its folder. If you loaded
an earlier ZIP and its card shows a different ID, remove that old unpacked copy
and load the newly extracted folder. Removing the extension does not remove
resumes or profile data from On Paper. Approve the normal connection prompt in
the desktop app after loading the new build.

The manifest intentionally requests only `sidePanel`, `storage`, `activeTab`, and `scripting`, plus access to the loopback bridge at `http://127.0.0.1:17872/*`. It does not request `<all_urls>`.

For safe fill testing, serve the sanitized fixtures from another terminal:

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory test/fixtures
```

Then open `http://127.0.0.1:8765/greenhouse-form.html` (or the Lever/Ashby
fixture) in Chrome. Prefer these fixtures or a disposable application. Filling
fires native `input`/`change` events and may attach a file, so a real ATS can
autosave or upload data even though the extension never activates its final
Submit control.

## Connect to On Paper

1. Open an HTTPS job-application page and click the Companion extension's
   toolbar button. This opens the side panel and grants access to that page.
   Plain HTTP is accepted only for a loopback (`localhost`, `127.0.0.1`, or
   IPv6 `::1`) test fixture.
2. Read the first-use disclosure and choose **Agree and continue**, then choose **Open and connect**. A running app receives the approval request directly. If the app is closed, the extension asks the operating system to launch it; this requires a properly registered On Paper installation. You can cancel while connecting, or open the app yourself and choose **Check connection again**.
3. Approve the connection prompt in On Paper. The extension exchanges a
   short-lived verifier automatically and verifies the resulting connection.
   The pairing token is never placed in the launch link and normally never
   needs to be copied.
4. Wait for the green **Connected** indicator. It appears only after the public
   health response identifies a compatible On Paper protocol and an
   authenticated resume-list request succeeds.

If On Paper is not installed, use **Download On Paper** in the
panel, install the app, then retry. **Advanced: pair manually** accepts the
masked token shown under **Settings → Data → Companion extension** only as a
recovery/troubleshooting path. Treat that token like a password.

The token is stored only in memory-backed `chrome.storage.session`, is hidden
from content scripts, and is cleared when Chrome restarts or the extension is
reloaded, updated, or disabled. The next app-backed action then opens the app
and repeats the approval flow without manual token copying. After a profile
switch or other profile-context reload, the extension can refresh the resume
list and clear the
old workflow automatically only if the stored pairing token is unchanged. The
token is shared across On Paper profiles, so an ordinary profile switch
does not require re-pairing. If a restored backup supplies a different token,
the extension clears the old workflow, returns to pairing, and requires the
token from the restored install. Ordinarily the approval flow replaces it
without manual copying.

Production automatic pairing accepts only the Chrome Web Store extension ID
`keggfbelidgpjiapcbgkjidenhdjmega`. The app binds the request and claim to that
browser origin. Source and packaged builds retain that ID through the public
`key` in `manifest.json`; packaging rejects a missing, malformed, or mismatched
key. This follows [Chrome's consistent-ID guidance](https://developer.chrome.com/docs/extensions/reference/manifest/key).
Native approval and verifier proof remain required. Legacy frontend/native
development builds additionally allow this workspace’s historical unpacked ID,
`jejabnlfgdapamjoechlgmgpmldekffo`; other unpacked IDs require explicit manual
pairing. A native debug build with a production-built frontend does not enable
the frontend development allowlist.

Disconnect aborts active extension mutation requests and prevents queued writes
from starting after revocation. A save already flushing may still complete in
On Paper; a tailoring result still waiting on AI cannot create a resume after
revocation. The browser retains only an opaque, profile-bound application
request identity for each Chrome window through disconnect and re-pairing, so
retrying the same log in that window uses its original ID. Closing and reopening
the panel in the same window preserves the identity; another window’s Start
over or completed log cannot clear it. Logging waits for Chrome to identify
the panel’s containing window and stays unavailable if that lookup fails. No job details or resume content are stored with it.
Restore the same resume and application details to retry; if the details cannot
be matched, check On Paper and choose **Start over** before logging a new action.
Confirmed saves, **Start over**, a verified switch to a different profile, or
Chrome clearing its session storage remove the pending identity.

## Review and fill an application

1. Choose **Autofill**. The collapsed **Resume and model** section shows the current selections; expand it to change **Resume to fill from** or **AI model**. Each tab remembers its own expanded state. The integrated model picker initially shows the app default. Provider rows expand and collapse, with only one open at a time while browsing. The selected model’s provider (or the app default provider) opens initially. Type a model name or provider to reveal matching groups automatically; clearing search restores the browsing group. Use Up/Down to navigate, Right/Left to expand or collapse a provider, and Enter to choose a model; choose **Use app default** to return to your settings in On Paper. Choosing a different model applies to this companion session without changing app defaults. The API key stays in On Paper. If automatic fallback is enabled there, it still applies. A failed model-list request shows its cause and a retry action, with a notice in the collapsed summary.
2. In **Autofill**, click **Prepare autofill review**. The extension first scans the application for compact field descriptors and page context without sending raw HTML or the raw DOM. On Paper then uses the selected resume, active profile data, learned answers, and extracted job context to prepare suggestions. It drafts open-ended motivation and experience answers from those facts; unknown factual answers and sensitive questions remain manual. The button reports **Scanning application form…** and **Preparing field suggestions…**, then announces when the review is ready, including separate counts for on-page manual fields and unanswered editable fields.
3. Review every item in descriptor order:
   - Edit text values inline; narrative answers have multiline editors.
   - Review **AI draft** answers for accuracy and whether they express what you want to say.
   - Choose native values for select and radio fields.
   - Review checkboxes as explicit `true` or `false` choices.
   - Treat **Low confidence** values as needing extra attention.
   - Complete unsupported or manual file fields on the page yourself.
4. For a typed unanswered question, optionally click its own **Save answer** control. Editing, leaving a field, or filling never saves an answer implicitly. A saved answer becomes available to later mappings in the active profile.
5. Click **Fill reviewed fields**. Empty unanswered fields and manual file fields remain local warnings instead of writing blank values. A recognized resume/CV upload receives the selected variant's generated PDF. The completion summary names the attached PDF and reports the number of fields the page confirmed as filled; no attachment is claimed when the file field reports failure.
6. Inspect the application page and address every **Complete manually** or **Could not fill** warning. Custom comboboxes and button-backed Yes/No controls intentionally remain manual in v1.
7. Click the job site's own **Submit** (or equivalent final application action) yourself. The extension has no automatic application-sending capability or setting.
8. After filling, edit the scraped company and role if needed, then click **Log application** once. A successful create records the selected variant in On Paper's application tracker with `applied` status. Logging is separate from filling and does not send the application to the employer.

## Analyze fit and create a tailored resume

Switch to **Tailor resume**. Expand **Resume and model** to change **Source** or **AI model**. **My full profile** is the default: you can analyze fit and create a new resume before saving any other resume. Choose an existing resume as the source when you want to tailor that version. The fresh tab shows **Analyze fit** and **Create tailored resume**; choosing either reads the current job page before running AI.

The scan also extracts conservative job context: structured `JobPosting`
metadata or a known job-description container, never arbitrary page-body text.
Only when capture fails or finds no description does the panel reveal **Check web page again** and **Manually enter job description**. Checking again captures the current page without running AI. A successful capture hides those recovery choices and shows the selected job details. Further Analyze/Create actions use that selected description; **Change job description** reveals source choices when you want another role. Manual entry works even when Chrome cannot read the page, starts without inferred company or role metadata, and offers **Cancel manual entry** to restore the previous source. Autofill scans do not overwrite the tailoring source. Changing the source clears old fit results and the previous saved-resume card; saved files remain in On Paper. Reconnecting to a different profile stops the pending action and asks for a fresh choice.

- **Analyze fit** sends the selected source and job context to On Paper,
  which uses the selected model (or the app's analysis default) and its saved key. The panel shows the
  bounded match score, strengths, gaps, missing keywords, and recommendations.
- **Create tailored resume** uses the selected model (or the app's tailoring default) to save
  and select a new variant. A retry of the same generation intent reuses its UUID
  idempotency key. The saved-success card shows the actual first-page PDF thumbnail
  and page count. **View in On Paper** opens that exact saved resume in the app.
  These two actions need the updated desktop bridge; an older app shows update
  guidance while the resume remains saved.
- To use the new resume for an application, navigate to the application page,
  choose **Prepare application autofill**, then **Prepare autofill review**.
  Generation itself never scans or maps the page's fields. Preview or list-refresh
  failures preserve the acknowledged saved result; **Try preview again** only
  retries the preview. Filling requires a separate **Fill reviewed fields** action
  and never activates the site's final application control.

The captured-role card shows the title, company, and locations, with the
description available in an expandable view. Fit results highlight the strongest
matches, important gaps, and next steps. While scanning, analyzing, drafting, or
filling, the panel shows a dedicated progress view with discovered field names
and live AI notes when the selected provider supplies them.

After filling, the extension checks for fields revealed by earlier answers and
offers **Review newly revealed fields**. For example, Intuit's Avature form shows
University/School and Major after Degree is chosen. Major can be reviewed and
filled normally; the remote university autocomplete is identified for manual
selection. Hidden fields and autocomplete search helpers are never filled.

## Retry and connection behavior

- **PDF export already busy:** no page fields are changed. Choose **Retry fill** to resend the exact reviewed payload captured by the failed fill attempt.
- **Review preparation failed after scanning:** choose **Retry preparing review** to reuse the captured application fields without rescanning. Choose **Start over** instead when the page changed or you want a fresh scan. A completed review also requires **Start over** before its edited values are discarded.
- **The reviewed page changed:** return to the original application tab or choose **Refresh review**. The extension checks the tab, URL, page context, and each field again before filling.
- **Page access was lost:** after switching tabs or navigating across origins, click the extension toolbar button again on that page. The extension does not compensate with broad host permissions.
- **Timeout, network, or unavailable app window during AI work:** the extension automatically wakes the already-paired app once, checks the same profile context, and rejoins the original operation. Progress and saved-resume identities are preserved. It does not silently re-pair or continue across a profile reload. If recovery fails, the panel offers the existing open/reconnect actions. After an app restart, prepare a fresh review once the new profile context is known.
- **Disconnected startup:** the panel does not launch anything by itself. It shows an explicit open/connect action plus a download path for users who have not installed the app.
- **Wrong process on the fixed port:** a health response with the wrong identity is shown as a port conflict and no bearer token is sent.
- **Incompatible app:** an old protocol or missing required capability is shown as **Update On Paper** rather than as connected.
- **Unrecognized extension ID:** install the official Companion or load a current build that retains its published ID. Reopening the desktop app cannot correct an old unpacked ID; explicit manual pairing remains available for development.
- **Ambiguous write failure:** retries of the same application log reuse its request identity so a late save cannot create a duplicate. Pending identity survives panel reopening within the browser session. If reopened details differ from an uncertain earlier log, check On Paper and restore those details to retry, or choose **Start over** to begin another application. Answer saving remains an explicit action.
- **Restricted browser page:** move to an HTTPS application page; Chrome does
  not allow injection into pages such as `chrome://extensions`, and the
  extension refuses non-loopback plain HTTP pages.
- **On Paper reloaded, changed profiles, or is completing a destructive restore:** mapping, filling, answer saving, and application logging verify the boot-scoped profile context before proceeding. A profile switch, backup restore, or other app reload changes that context even when the same profile remains active. The pending action is blocked and the old scan/review/fill state is cleared. During the restore window, the panel shows **Reconnecting after On Paper reloads…** and polls until the reload completes. If the pairing token is unchanged, the resume picker then refreshes automatically; confirm the new selection, then prepare a new autofill review. If the restored backup rotated the token, the panel returns to pairing instead. Do not retry from the old review.

## Privacy and trust boundary

- The bridge binds only to `127.0.0.1:17872`; it is not reachable from another machine.
- Every bridge endpoint except `/health`, the approval-only `/pairing/request`, and the one-time `/pairing/claim` exchange requires the pairing token. A warm pairing request requires a Chrome extension origin and JSON request; it grants no access until approval in On Paper and proof of the verifier.
- V1 trusts the same-user local processes and host. Loopback binding plus the bearer token does not defend against a malicious local process impersonating On Paper on the fixed port, or against a compromised host.
- The extension contains no OpenRouter key and makes no direct model request. AI calls go through the running app and its configured provider account.
- Compact field labels, types, native options, and required flags reach the user's configured model together with the selected resume, active profile data, and that profile's learned answers. Labels and resume content are treated as untrusted data and cannot override the mapping instructions.
- Raw application HTML and DOM nodes do not leave the page. The generated resume PDF returns through the authenticated loopback bridge when a reviewed resume-file marker requires it; saved-success previews return only a small PNG of the first page.
- Password inputs are never scanned, marked, proposed, saved, or filled, even if a stale field marker remains on a page.
- The extension adds no account, telemetry, background job service, or remote companion backend. On supported Apple devices, saved resumes, profiles, answers, and application records can sync through the desktop app’s Apple CloudKit integration in your own iCloud account.
- **Settings → Disconnect** contains the connection action; **Privacy** is in the panel footer.
- Before connecting or processing page data, the extension requires the first-use disclosure to be accepted. **Privacy** opens a bundled offline notice; the public policy source is `website/privacy.html` (publishing is separate).
- Sensitive questions (demographics, disability, veteran status, work authorization, and compensation) stay manual on the application page and are excluded from AI mapping and answer saving.
- **Disconnect** clears this browser’s session credential, disclosure choice, and review, and asks the running app to revoke existing companion connections. If the app is unreachable, the panel explicitly reports that other sessions were not revoked. Reconnect and disconnect while the app is running.
- The local pairing token grants access to the app’s companion endpoints across profiles. Approval and revocation are explicit; the memory-only credential reduces persistence but does not protect against a compromised same-user process or host.

## Supported controls and v1 limits

Supported native controls include text inputs, textareas, selects, native radio groups, independently described checkboxes, and standard resume/CV file inputs. Native browser-realm setters and `input`/`change` events are used so React and other controlled forms can observe edits.

V1 deliberately does not include:

- Automatic application sending or interaction with the site's final application action.
- Broad `<all_urls>` access or persistent access to every visited site.
- Site-specific shadow-DOM adapters, arbitrary custom typeahead automation, or forced interaction with Ashby-style button-backed checkbox controls.
- Automatic cover-letter or supporting-document attachment.
- A separate extension AI key, cloud account, hosted backend, or background desktop daemon.
- Cached resume/profile data or an on-demand local helper that operates while
  the On Paper app is closed.

Unsupported controls remain visible as non-editable manual items with no answer-saving control. The extension favors partial, reviewable success over guessing at a custom widget.

## Development commands

```bash
# Focused or full test suite
npm test

# ESLint
npm run lint

# Rebuild extension/dist
npm run build

# Build and validate the deterministic Chrome Web Store ZIP
npm run package:store
```

Chrome Web Store listing and release operations are documented in
`../docs/chrome-web-store-release.md` and
`../docs/chrome-web-store-listing.md`; the concrete reviewer setup is
`../docs/chrome-web-store-reviewer-instructions.md`. A signed compatible desktop release, deployed policy, final artwork, and safe reviewer AI access remain submission gates; the local debug demo is not a production installer.

Scanner fixtures under `test/fixtures/` are sanitized snapshots derived from public Greenhouse, Lever, and Ashby application pages. Keep new fixtures free of applicant data and raw third-party secrets.

## Human verification checklist

The items below are intentionally manual release checks. Their presence is not a claim that they were performed during automated implementation.

- [ ] Load `extension/dist` in Chrome and confirm the extension card shows **On Paper Companion** with no manifest warnings.
- [ ] Confirm first-use disclosure blocks scanning and pairing until **Agree and continue**; open the bundled privacy notice offline.
- [ ] Confirm sensitive fields remain manual and absent from AI suggestions and answer saving.
- [ ] Disconnect while the app is running and verify previous sessions lose access; repeat with the app closed and verify the partial-revocation message.
- [ ] With On Paper closed, choose **Open and connect**; confirm the installed app launches, the approval prompt contains the actual access scope, no token appears in the URL, and the side panel turns green only after approval and authenticated verification.
- [ ] Reject a pairing request and confirm the panel reports the rejection without storing a token; retry and approve it successfully.
- [ ] Test with On Paper uninstalled (or the URL handler unavailable); confirm launch polling ends with useful retry/download guidance instead of a stale green status.
- [ ] Put a non-On-Paper HTTP service on port 17872 and confirm the panel reports a port conflict without sending a stored token. Test an older protocol fixture and confirm it asks for an app update.
- [ ] Quit On Paper while the panel is open and confirm the heartbeat removes **Connected**. Reopen it from the panel and confirm automatic reconnect when the stored token is still valid.
- [ ] Restart Chrome, then start an app-backed action. Confirm the token was not
      retained on disk, On Paper opens, and approval-based pairing
      completes again without copying a token.
- [ ] With a review open, switch On Paper profiles and wait for its reload; attempt to fill and confirm the action is blocked, the new profile's resume list replaces the old one, and the old review disappears without requiring re-pairing.
- [ ] On the served Greenhouse fixture, run **Prepare autofill review**; confirm both progress stages, ordered descriptors, mapping, native option values, and the ready/manual field counts.
- [ ] On the served Lever fixture, run **Prepare autofill review**; confirm both progress stages, ordered descriptors, mapping, native option values, and the ready/manual field counts.
- [ ] Edit proposed text, select/radio, and checkbox values inline; fill a local fixture and inspect its resulting input values to confirm the edits were used.
- [ ] On a separate disposable local React-controlled form (not one of the static fixtures), fill a controlled input and confirm the visible page state registers the native `input` and `change` events.
- [ ] Fill a recognized resume upload; confirm the completion summary names the attached file, the filename matches the selected variant, and the file opens as a valid PDF. Force a file-field failure and confirm no attachment success is claimed.
- [ ] Include a custom combobox or button-backed Yes/No control; confirm it has no editor or answer-saving control, remains unfilled with a readable manual warning, and supported fields still fill.
- [ ] Confirm no page is sent automatically and the extension never activates the site's final application action.
- [ ] Type a needs-human answer, click its explicit **Save answer** control, remap a later application, and confirm the learned answer is available.
- [ ] After filling, click **Log application** once and confirm the correct variant, edited company/title, and `applied` record appear in On Paper's tracker without duplicates.
- [ ] While the app's PDF preview/export path is busy, attempt a resume-file fill; confirm no page mutation occurs, **Retry fill** appears, and retry uses the captured values.
- [ ] Analyze fit with extracted job text and with the manual-description fallback; confirm results use the selected resume and the app's configured model/key.
- [ ] Create a tailored resume; confirm exactly one new variant is saved and selected, the panel never auto-fills, and retrying the same request id does not duplicate it.
- [ ] Change the application origin/path or job fingerprint while tailoring runs; confirm the old page context is not reused. Confirm generation never starts an application scan or mapping, even if the posting contains search inputs. Explicitly navigate to the application page and prepare its review.
- [ ] Stop On Paper and confirm disconnected/open/download guidance appears without exposing the token or silently running offline AI.
- [ ] Include a labelled password input beside a supported field; confirm the password receives no field marker, never appears in review, and cannot be filled by a stale marker.
