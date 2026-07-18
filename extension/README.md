# Resume Designer Companion extension

The Companion extension scans a job-application form, asks the running Resume Designer app to propose values, lets you review every field, and fills only after you click **Fill reviewed fields**. It never sends the application. You always review the page and use the site's own final application button yourself.

## Requirements

- Google Chrome 116 or later.
- The Resume Designer desktop app installed. The extension can open it when an
  app-backed action needs it; the app must then remain running and unlocked
  while that action completes.
- A resume variant in Resume Designer.
- Node.js `^20.19.0`, `^22.13.0`, or `>=24` to build from source.
- Python 3 (optional; only needed to serve the local test fixtures).
- For AI mapping, an OpenRouter key and model configured in Resume Designer. The key stays in the app; it is never copied into the extension.

If you are also running Resume Designer from source, install the Rust toolchain
and your platform build tools (Xcode Command Line Tools on macOS; Visual Studio
C++ Build Tools and the Windows SDK on Windows). Start the native app from the
repository's `resume-designer/` directory:

First export a full backup from your installed app: development and production
builds use the same `com.resumedesigner.app` data directory. Then quit every
installed or development Resume Designer instance. Only one process can bind
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
5. Keep the extension available in the toolbar. After rebuilding, use **Reload** on its `chrome://extensions` card.

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

## Connect to Resume Designer

1. Open an HTTPS job-application page and click the Companion extension's
   toolbar button. This opens the side panel and grants access to that page.
   Plain HTTP is accepted only for a loopback (`localhost`, `127.0.0.1`, or
   IPv6 `::1`) test fixture.
2. Choose **Open and connect**. If the app is already running,
   this brings it forward; otherwise the operating system launches it.
3. Approve the connection prompt in Resume Designer. The extension exchanges a
   short-lived verifier automatically and verifies the resulting connection.
   The pairing token is never placed in the launch link and normally never
   needs to be copied.
4. Wait for the green **Connected** indicator. It appears only after the public
   health response identifies a compatible Resume Designer protocol and an
   authenticated résumé-list request succeeds.

If Resume Designer is not installed, use **Download Resume Designer** in the
panel, install the app, then retry. **Advanced: pair manually** accepts the
masked token shown under **Settings → Data → Companion extension** only as a
recovery/troubleshooting path. Treat that token like a password.

The token is stored only in memory-backed `chrome.storage.session`, is hidden
from content scripts, and is cleared when Chrome restarts or the extension is
reloaded, updated, or disabled. The next app-backed action then opens the app
and repeats the approval flow without manual token copying. After a profile
switch or other profile-context reload, the extension can refresh the résumé
list and clear the
old workflow automatically only if the stored pairing token is unchanged. The
token is shared across Resume Designer profiles, so an ordinary profile switch
does not require re-pairing. If a restored backup supplies a different token,
the extension clears the old workflow, returns to pairing, and requires the
token from the restored install. Ordinarily the approval flow replaces it
without manual copying.

## Review and fill an application

1. Choose the resume variant to use.
2. Click **Prepare autofill review**. The extension first scans the application for compact field descriptors and page context without sending raw HTML or the raw DOM. Resume Designer then uses the selected résumé, active profile data, and that profile's learned answers to prepare suggestions for supported fields. The button reports **Scanning application form…** and **Preparing field suggestions…**, then announces when the review is ready, including how many fields require manual entry.
3. Review every item in descriptor order:
   - Edit text values inline.
   - Choose native values for select and radio fields.
   - Review checkboxes as explicit `true` or `false` choices.
   - Treat **Low confidence** values as needing extra attention.
   - Complete unsupported or manual file fields on the page yourself.
4. For a typed unanswered question, optionally click its own **Save answer** control. Editing, leaving a field, or filling never saves an answer implicitly. A saved answer becomes available to later mappings in the active profile.
5. Click **Fill reviewed fields**. Empty unanswered fields and manual file fields remain local warnings instead of writing blank values. A recognized resume/CV upload receives the selected variant's generated PDF. The completion summary names the attached PDF and reports the number of fields the page confirmed as filled; no attachment is claimed when the file field reports failure.
6. Inspect the application page and address every **Complete manually** or **Could not fill** warning. Custom comboboxes and button-backed Yes/No controls intentionally remain manual in v1.
7. Click the job site's own **Submit** (or equivalent final application action) yourself. The extension has no automatic application-sending capability or setting.
8. After filling, edit the scraped company and role if needed, then click **Log application** once. A successful create records the selected variant in Resume Designer's application tracker with `applied` status. Logging is separate from filling and does not send the application to the employer.

## Analyze fit and create a tailored résumé

The scan also extracts conservative job context: structured `JobPosting`
metadata or a known job-description container, never arbitrary page-body text.
When a description cannot be found, paste it into the panel's job-description
field.

- **Analyze fit** sends the selected résumé and job context to Resume Designer,
  which uses the app's configured analysis model and key. The panel shows the
  bounded match score, strengths, gaps, missing keywords, and recommendations.
- **Create tailored résumé** uses the app's configured tailoring model to save
  and select a new variant. Each click has a UUID idempotency key, so a retry
  cannot create duplicates. If the application page still has the origin/path
  and fingerprint that were scanned, the extension may prepare a fresh review
  for the new variant. Query parameters and fragments are deliberately ignored.
  It never fills that review automatically and never submits the application.

## Retry and connection behavior

- **PDF export already busy:** no page fields are changed. Choose **Retry fill** to resend the exact reviewed payload captured by the failed fill attempt.
- **Review preparation failed after scanning:** choose **Retry preparing review** to reuse the captured application fields without rescanning. Choose **Start over** instead when the page changed or you want a fresh scan. A completed review also requires **Start over** before its edited values are discarded.
- **Page access was lost:** after switching tabs or navigating across origins, click the extension toolbar button again on that page. The extension does not compensate with broad host permissions.
- **Timeout, network, or unavailable app window:** the green status disappears immediately. Use **Open Resume Designer**; app-backed actions also offer to launch/reconnect. A review may stay visible for reference, but it cannot be filled after an app restart. Prepare a fresh review once the new profile context is known.
- **Disconnected startup:** the panel does not launch anything by itself. It shows an explicit open/connect action plus a download path for users who have not installed the app.
- **Wrong process on the fixed port:** a health response with the wrong identity is shown as a port conflict and no bearer token is sent.
- **Incompatible app:** an old protocol or missing required capability is shown as **Update Resume Designer** rather than as connected.
- **Ambiguous write failure:** answer saving and application logging are not blindly replayed. Check the app before trying the write again.
- **Restricted browser page:** move to an HTTPS application page; Chrome does
  not allow injection into pages such as `chrome://extensions`, and the
  extension refuses non-loopback plain HTTP pages.
- **Resume Designer reloaded, changed profiles, or is completing a destructive restore:** mapping, filling, answer saving, and application logging verify the boot-scoped profile context before proceeding. A profile switch, backup restore, or other app reload changes that context even when the same profile remains active. The pending action is blocked and the old scan/review/fill state is cleared. During the restore window, the panel shows **Reconnecting after Resume Designer reloads…** and polls until the reload completes. If the pairing token is unchanged, the résumé picker then refreshes automatically; confirm the new selection, then prepare a new autofill review. If the restored backup rotated the token, the panel returns to pairing instead. Do not retry from the old review.

## Privacy and trust boundary

- The bridge binds only to `127.0.0.1:17872`; it is not reachable from another machine.
- Every bridge endpoint except `/health` and the one-time `/pairing/claim`
  exchange requires the pairing token.
- V1 trusts the same-user local processes and host. Loopback binding plus the bearer token does not defend against a malicious local process impersonating Resume Designer on the fixed port, or against a compromised host.
- The extension contains no OpenRouter key and makes no direct model request. AI calls go through the running app and its configured provider account.
- Compact field labels, types, native options, and required flags reach the user's configured model together with the selected résumé, active profile data, and that profile's learned answers. Labels and résumé content are treated as untrusted data and cannot override the mapping instructions.
- Raw application HTML and DOM nodes do not leave the page. The generated resume PDF returns through the authenticated loopback bridge only when a reviewed resume-file marker requires it.
- Password inputs are never scanned, marked, proposed, saved, or filled, even if a stale field marker remains on a page.
- The extension adds no account, cloud sync, telemetry, background job service, or remote companion backend.

## Supported controls and v1 limits

Supported native controls include text inputs, textareas, selects, native radio groups, independently described checkboxes, and standard resume/CV file inputs. Native browser-realm setters and `input`/`change` events are used so React and other controlled forms can observe edits.

V1 deliberately does not include:

- Automatic application sending or interaction with the site's final application action.
- Broad `<all_urls>` access or persistent access to every visited site.
- Site-specific shadow-DOM adapters, arbitrary custom typeahead automation, or forced interaction with Ashby-style button-backed checkbox controls.
- Automatic cover-letter or supporting-document attachment.
- A separate extension AI key, cloud account, hosted backend, or background desktop daemon.
- Cached résumé/profile data or an on-demand local helper that operates while
  the Resume Designer app is closed.

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
`../docs/chrome-web-store-listing.md`.

Scanner fixtures under `test/fixtures/` are sanitized snapshots derived from public Greenhouse, Lever, and Ashby application pages. Keep new fixtures free of applicant data and raw third-party secrets.

## Human verification checklist

The items below are intentionally manual release checks. Their presence is not a claim that they were performed during automated implementation.

- [ ] Load `extension/dist` in Chrome and confirm the extension card has no manifest warnings.
- [ ] With Resume Designer closed, choose **Open and connect**; confirm the installed app launches, the approval prompt contains the actual access scope, no token appears in the URL, and the side panel turns green only after approval and authenticated verification.
- [ ] Reject a pairing request and confirm the panel reports the rejection without storing a token; retry and approve it successfully.
- [ ] Test with Resume Designer uninstalled (or the URL handler unavailable); confirm launch polling ends with useful retry/download guidance instead of a stale green status.
- [ ] Put a non-Resume-Designer HTTP service on port 17872 and confirm the panel reports a port conflict without sending a stored token. Test an older protocol fixture and confirm it asks for an app update.
- [ ] Quit Resume Designer while the panel is open and confirm the heartbeat removes **Connected**. Reopen it from the panel and confirm automatic reconnect when the stored token is still valid.
- [ ] Restart Chrome, then start an app-backed action. Confirm the token was not
      retained on disk, Resume Designer opens, and approval-based pairing
      completes again without copying a token.
- [ ] With a review open, switch Resume Designer profiles and wait for its reload; attempt to fill and confirm the action is blocked, the new profile's résumé list replaces the old one, and the old review disappears without requiring re-pairing.
- [ ] On the served Greenhouse fixture, run **Prepare autofill review**; confirm both progress stages, ordered descriptors, mapping, native option values, and the ready/manual field counts.
- [ ] On the served Lever fixture, run **Prepare autofill review**; confirm both progress stages, ordered descriptors, mapping, native option values, and the ready/manual field counts.
- [ ] Edit proposed text, select/radio, and checkbox values inline; fill a local fixture and inspect its resulting input values to confirm the edits were used.
- [ ] On a separate disposable local React-controlled form (not one of the static fixtures), fill a controlled input and confirm the visible page state registers the native `input` and `change` events.
- [ ] Fill a recognized resume upload; confirm the completion summary names the attached file, the filename matches the selected variant, and the file opens as a valid PDF. Force a file-field failure and confirm no attachment success is claimed.
- [ ] Include a custom combobox or button-backed Yes/No control; confirm it has no editor or answer-saving control, remains unfilled with a readable manual warning, and supported fields still fill.
- [ ] Confirm no page is sent automatically and the extension never activates the site's final application action.
- [ ] Type a needs-human answer, click its explicit **Save answer** control, remap a later application, and confirm the learned answer is available.
- [ ] After filling, click **Log application** once and confirm the correct variant, edited company/title, and `applied` record appear in Resume Designer's tracker without duplicates.
- [ ] While the app's PDF preview/export path is busy, attempt a resume-file fill; confirm no page mutation occurs, **Retry fill** appears, and retry uses the captured values.
- [ ] Analyze fit with extracted job text and with the manual-description fallback; confirm results use the selected résumé and the app's configured model/key.
- [ ] Create a tailored résumé; confirm exactly one new variant is saved and selected, the panel never auto-fills, and retrying the same request id does not duplicate it.
- [ ] Change the application origin/path or job fingerprint while tailoring runs; confirm the old page context is not reused. With an unchanged origin/path and fingerprint, confirm any refreshed suggestions still require a new explicit Fill click.
- [ ] Stop Resume Designer and confirm disconnected/open/download guidance appears without exposing the token or silently running offline AI.
- [ ] Include a labelled password input beside a supported field; confirm the password receives no field marker, never appears in review, and cannot be filled by a stale marker.
