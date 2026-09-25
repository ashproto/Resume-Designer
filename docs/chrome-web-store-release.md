# Chrome Web Store release operations

This document is the operational source of truth for shipping the On Paper Companion extension. The workflow is designed so Store credentials
never reach pull-request code and an extension that requires a new bridge
capability is submitted only after the corresponding production desktop
release workflow succeeds.

## Current submission gates

The owner reports **0.1.3 uploaded**, the exact Additional instructions pasted, and the dedicated reviewer key supplied privately. Security candidate **0.1.4** changes patched build/test dependency inputs; application UI source is unchanged. Its fresh tests, lint, frontend build, and strict Store packaging passed. Both full dependency audits and the committed version gate pass. Dependabot PR #131 and the remaining dependency fixes in PR #138 are merged into `next`. PR #137 received the Codex thumbs-up and merged into `next` at `504c3ae986aa3dab254db9a76d8324c651bb7dca`. The owner authorized the remaining release work, with dependency/security cleanup required **before opening the `next` → `main` promotion PR**. The earlier candidate passed local Chrome functional QA with the isolated macOS demo and real AI after the user reloaded the extension. The subsequent status-copy extension build passed a fresh AI review and app quit/relaunch/reconnect; its runtime JavaScript was unchanged in the 0.1.1 publisher/support-policy package. The 0.1.3 security and profile-context fixes have automated regression coverage; its live Chrome flow has not been repeated. The rebuilt native Library passed Close/Escape checks, and final native copy changes passed focused live verification. See [`chrome-web-store-readiness-2026-09-24.md`](chrome-web-store-readiness-2026-09-24.md) for exact artifact provenance and observed checks. This is not production-platform validation, Store approval, or publication.

| Gate | Current disposition |
| --- | --- |
| Publisher/item/contact/trader setup | Owner selected HyperBuild, Inc, support@hyperbuild.com, and Unlisted for the first release. Registration/payment, publisher verification, and saved Store listing/privacy fields are complete per the owner’s September 25 report. Private legal details and mailbox/domain ownership were not independently checked. |
| Production desktop dependency | First release is Unlisted and macOS-only (14.4+). Intermediate **2.3.0-next.155** from [run 36192899418](https://github.com/ashproto/Resume-Designer/actions/runs/36192899418) is verified for both macOS architectures: asset hashes, strict signatures, Gatekeeper, and app staples pass. Earlier **next.153** passed ARM startup, fictional resume import/PDF export, restart/persistence, and bridge-health checks. Neither artifact includes the pending persistence follow-up. Verify its resulting beta and supply the final stable versioned installer; public stable v2.2.0 remains incompatible. |
| Pairing | Warm native consent, rejection, extension cancel/manual recovery, retry/approval, and disconnect/revoke passed locally. Cold launch still requires a correctly registered production installation and its own check. |
| Core companion flow | Local real-AI review/fill with PDF, two sensitive blanks, model search/override/reset, application logging, fit analysis, one tailored variant, saved-answer reuse, and query/fragment stale-review protection passed. This does not complete the full manual checklist. |
| Native Library close | The close fix, desktop suite (2,051/129), lint, signed isolated app rebuild, and live Close/reopen/Escape checks passed. The full suite preceded final copy-only policy/neutral Library changes; the final app started after user-approved Keychain access, retained saved resumes, and passed focused Library Close and Chrome reconnect checks. |
| Public policy/support/homepage | Verify deployed URLs, Companion disclosures, and affirmative Limited Use statement. Local source edits are not deployment. |
| Real reviewer AI access | Owner reports the dedicated key supplied privately in Dashboard **Password**, with a **$5 budget** and **30-day expiry**; keep **Username** blank. Use the native welcome wizard if necessary, or desktop **Settings → AI**, and tested **Claude Sonnet 4.6**. Remaining credit/expiry were not independently inspected; keep access usable through review and renew if required. Never bundle credentials. |
| Reviewer fixture/import | Publish a durable fictional fixture/import through the normal authorized release process. |
| Listing images | The 128×128 listing icon and 440×280 promo tile are complete in `extension/store-assets/`. The owner reports product screenshots saved in the Dashboard on September 25; verify their final UI and absence of private data before submission. The earlier local export block is preserved in the readiness history. |
| Security candidate | **0.1.4**: fresh **424 extension tests/14 files**, **2,115 desktop tests/130 files**, and **90 release-automation tests** passed. Lint: no errors, two prior desktop warnings. Frontend build and strict Store packaging passed. ZIP: **674,051 bytes**, **12 files**, SHA-256 `11567f192f157a17378dc3c89264896f2872612226e68e8f47d945e7517fd7a3`. UI source is unchanged; build/test dependency inputs changed. Both full dependency audits and the committed version gate pass. Dependabot PR #131 and the remaining dependency fixes in PR #138 are merged into `next`. No fresh live Chrome or production-runtime check is implied. |
| Uploaded artifact evidence | Version **0.1.3**: **424 tests/14 files**, lint, production build, strict Store validator, and ZIP integrity passed. Two profile-switch/reload regression cases failed before the fix; all 50 sidepanel cases passed afterward. ZIP: **674,051 bytes**, 12 files, SHA-256 `09b56c74fb08c550208a889ca31d6194853a7f34087557094b14b2328bc1dd7c`. Historical live checks are not a fresh 0.1.3 Chrome check. |
| First-release production/manual checks | Signed macOS installer, Store installation/update, URI cold launch, Chrome browser restart, and the applicable macOS README checklist remain open. |
| Later Windows release | Windows GNU cross-target compilation passed. Windows signing, installation/runtime, and manual feature tests remain deferred; they do not block the macOS-only first release. |
| Store status | Owner reports **0.1.3** and screenshots uploaded, exact Additional instructions pasted, and the dedicated key supplied privately. Replace the package with validated **0.1.4** before submission. No review submission or publication is established. |

## Promotion review follow-up

Promotion PR #139 exposed a durable-save acknowledgement bug and five workflow
cache-poisoning warnings. The candidate now awaits disk persistence for Companion
answer/application saves, serializes each save through its durability check,
rolls back rejected mutations without losing newer native edits, and rechecks
pairing before queued saves start and after their writes complete. The workflow
resolves trusted release provenance before checkout and denies cache access.
Local verification: **2,115 desktop tests/130 files**, **90 release-automation
tests**, lint and production build pass. The Store ZIP remains **0.1.4** with the
same digest above. Fresh CI, CodeQL, bot review and the resulting desktop release
remain gates; earlier beta artifacts do not validate these changes.

## What is automated

Pull-request CI in `.github/workflows/ci.yml` installs dependencies, lints,
tests, builds, validates, and retains the exact Store ZIP. The package builder:

- produces byte-identical ZIP files from identical source;
- keeps `manifest.json` at the archive root;
- requires matching versions in `manifest.json`, `package.json`, and
  `package-lock.json`;
- enforces the approved permissions, loopback host, Manifest V3, minimum
  Chrome version, required files, exact icon sizes, and size budgets;
- rejects source maps, nested archives, credential-like files, symlinks,
  hidden files, and unexpected build artifacts; and
- prints the artifact SHA-256 digest.

`.github/workflows/chrome-extension-release.yml` supports three manual modes
from `main`:

- `status-only`: verify OIDC, service-account access, publisher configuration,
  and the Store item's current state without uploading anything;
- `staged`: upload and submit for review, then hold the approved revision for a
  later explicit publication; and
- `automatic`: upload and submit for review, then publish automatically after
  approval.

Once `CWS_AUTO_PUBLISH` is enabled, a successful **Release Desktop App** run on
`main` triggers the extension workflow. It submits only when packaged extension
inputs changed since the prior stable release, verifies that the desktop
workflow's `release` job actually completed instead of being skipped, and
requires the extension version to have increased. This ordering makes the
compatible desktop app available before a bridge-dependent extension update is
submitted. Before executing repository code, automatic runs resolve the release
through GitHub's API and require the expected desktop workflow, repository,
`main` branch, successful push/manual run, and a commit still reachable from
`main`. Both jobs use that validated immutable commit, including when newer
commits arrive while the desktop release builds. Checkout credentials are not
persisted, and Actions/package-manager caches are disabled for both jobs.

Manual `staged` and `automatic` runs enforce the same app-first rule by finding
a successful desktop release at the exact selected `main` commit and positively
checking its `release` job. `status-only` remains non-mutating and does not need
a desktop release proof.

The API client refuses to proceed when the Store item is warned or taken down,
a different revision is pending or staged, the new version is not greater than
all known Store versions, upload processing fails or times out, or publication
returns warnings. A rerun for the exact already-published, pending, or staged
version is an explicit successful no-op. A mutating success means **submitted
for review**, not immediately available to users. Chrome's review remains
asynchronous.

## What remains manual

Use the [owner setup checklist](chrome-web-store-owner-checklist.md) for the remaining security validation, final versioned installer, public website, reviewer-access continuity, and Unlisted macOS-first submission checks.

Chrome requires human-owned publisher and listing setup before the API can
publish an item. Complete these once in the Chrome Web Store Developer
Dashboard. Registration includes a one-time developer fee; the owner reports both registration and payment completed.

1. Publisher verification for **HyperBuild, Inc** is complete per the owner’s September 25 report. Keep two-step verification enabled and resolve any new Dashboard warnings.
2. Confirm **support@hyperbuild.com** is monitored. Any required trader declaration and legal identity details stay in Google’s Dashboard; they were not independently inspected here.
3. The owner reports **0.1.3 uploaded**. Replace it with **0.1.4** after the security candidate is validated.
4. Store Listing, Privacy practices, exact Additional instructions, and the private reviewer Password are owner-reported saved. Reconcile the saved draft with the final package and `docs/chrome-web-store-listing.md`; complete the linked guide with the final verified versioned installer and deployed fixtures. Confirm the reviewer key’s $5 budget and 30-day expiry still cover the review period.
5. Add the public privacy-policy, support, and homepage URLs.
6. Screenshots are owner-reported saved. Verify the final screenshots and promotional artwork before submission.
7. Confirm **Unlisted** for the first release in Distribution, as chosen by the owner.
8. Manually publish once after establishing or changing visibility. The Web
   Store API preserves existing visibility and cannot activate a newly changed
   visibility until it has been published manually once.

Do not enable automated submission until the product and listing gates near the
end of this document are complete.

## Google Cloud and keyless authentication

Use Workload Identity Federation (WIF), not a downloaded service-account JSON
key.

1. Create or select a dedicated Google Cloud project.
2. Enable the **Chrome Web Store API** and the IAM APIs required for service
   account impersonation.
3. Create a dedicated service account. It does not need broad project roles.
4. In the Chrome Web Store Developer Dashboard, add that service-account email
   under the publisher's Account settings. Chrome currently allows one linked
   service account per publisher, and that identity can manage the publisher's
   items.
5. Create a workload identity pool and GitHub OIDC provider.
6. Map at least these claims:

   ```text
   google.subject=assertion.sub
   attribute.repository_id=assertion.repository_id
   attribute.repository_owner_id=assertion.repository_owner_id
   attribute.ref=assertion.ref
   attribute.environment=assertion.environment
   attribute.workflow_ref=assertion.workflow_ref
   ```

7. Restrict the provider to this repository's immutable numeric repository and
   owner IDs, production branch, and protected environment. Use a condition
   equivalent to:

   ```text
   assertion.repository_id == "REPOSITORY_NUMERIC_ID" &&
   assertion.repository_owner_id == "OWNER_NUMERIC_ID" &&
   assertion.ref == "refs/heads/main" &&
   assertion.environment == "chrome-web-store" &&
   assertion.workflow_ref == "ashproto/Resume-Designer/.github/workflows/chrome-extension-release.yml@refs/heads/main"
   ```

   Obtain the immutable IDs from the GitHub repository API rather than relying
   only on renameable owner/repository strings.

8. Grant only the matching federated principal permission to impersonate the
   service account (`roles/iam.workloadIdentityUser`). Do not grant a whole
   workload pool or every repository owned by the account.

Reference documentation:

- [Chrome Web Store developer registration](https://developer.chrome.com/docs/webstore/register)
- [Chrome Web Store developer account setup](https://developer.chrome.com/docs/webstore/set-up-account/)
- [Chrome Web Store service accounts](https://developer.chrome.com/docs/webstore/service-accounts)
- [GitHub Actions OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect)
- [Google deployment-pipeline WIF guidance](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
- [google-github-actions/auth WIF examples](https://github.com/google-github-actions/auth)
- [Current Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Current user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

## GitHub environment configuration

Create a GitHub Actions environment named exactly `chrome-web-store`.

Protect it with:

- deployment branches restricted to `main`;
- required reviewer approval for the first releases; and
- no environment secrets containing Google JSON credentials.

Set these environment variables:

| Variable | Value |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full provider resource name: `projects/.../locations/global/workloadIdentityPools/.../providers/...` |
| `CWS_SERVICE_ACCOUNT` | Linked service-account email |
| `CWS_PUBLISHER_ID` | Publisher ID from Developer Dashboard → Publisher → Settings |
| `CWS_EXTENSION_ID` | 32-character ID of the production Store item |

Set `CWS_AUTO_PUBLISH` as a **repository-level** Actions variable. Leave it
unset or `false` during setup. The workflow evaluates this variable before the
protected environment is entered, so it must not be environment-scoped.

## First credential and release checks

Run these in order from the Actions tab, always selecting `main`:

1. Run **Chrome extension release** with `status-only`. It must report the
   expected item ID and no warning, takedown, active submission, or unexpected
   revision.
2. Keep required environment approval enabled and run `staged` with a new
   manifest version.
3. Confirm the exact version and SHA-256 in Actions and Developer Dashboard.
4. Complete review. Confirm the approved revision remains staged.
5. Publish the staged revision manually and test installation/update from the
   Store.
6. For the next version, run `automatic`; confirm it becomes available only
   after Store approval.
7. When the process is trusted, set repository variable
   `CWS_AUTO_PUBLISH=true`. Keep the environment branch restriction and WIF
   claim restriction permanently.

## Normal release process

1. Increase the numeric extension version in all three files:
   `extension/manifest.json`, `extension/package.json`, and the root package
   record in `extension/package-lock.json`. Chrome accepts one to four integers,
   each from 0 through 65535; the new version must compare greater than every
   prior submitted or published version.
2. Run from `extension/`:

   ```bash
   npm ci
   npm run lint
   npm test
   npm run package:store
   unzip -t artifacts/on-paper-companion-*.zip
   ```

3. Review the pull-request CI artifact and test it unpacked in Chrome.
   Pull-request CI fails when any packaged extension input changes without a
   corresponding version increase.
4. Merge through `next`, then promote `next` to `main` using the repository's
   normal desktop release process.
5. After the desktop release workflow finishes successfully, the production
   Store workflow rebuilds and verifies the same extension source. With
   `CWS_AUTO_PUBLISH=true`, it uploads and requests automatic publication after
   approval.
6. Treat the Actions result as a submission receipt. Check Developer Dashboard
   for review and rollout status.

For extension-only fixes that do not need a new desktop capability, the same
ordering is harmless but may build an unchanged desktop app. A future workflow
may add a separately reviewed extension-only release path; it must not weaken
the app-first guarantee for bridge changes.

## Failure and emergency behavior

- Set repository variable `CWS_AUTO_PUBLISH=false` to stop automatic Store
  submission without changing code.
- Do not cancel the workflow while upload processing is in progress. The
  concurrency group serializes production submissions and does not cancel an
  existing run.
- Do not manually upload or publish through Developer Dashboard while the
  production workflow is running. Chrome's API has no conditional publish
  primitive that atomically binds a publish request to one upload; the client
  narrows and verifies this window, while operational serialization closes it.
- Resolve warnings, takedowns, rejected revisions, and any *different*
  staged/pending revision in Developer Dashboard before retrying. Rerunning the
  exact version already published, staged, or pending is a safe status no-op.
- Never reuse an extension version, including a rejected version. Increase it
  and submit a new package.
- Do not use the production Store item for `next` builds. If a permanent beta
  channel is needed later, create a second unlisted item with a separate ID,
  GitHub environment, and channel-aware desktop download path.

## Product and listing gates before first submission

- [ ] Deploy and verify a stable privacy policy (including Companion and Limited Use text), homepage link, and support route.
- [x] Add a prominent first-use disclosure and affirmative consent before page
      or resume data is processed. Enumerate page origin/path and form descriptors; resume, profile,
      and learned answers; generated PDFs; the session pairing credential;
      OpenRouter/downstream-provider transfers; and application-site
      fill/upload behavior.
- [x] Make the bundled offline privacy policy reachable from the side panel.
- [x] Reconcile the implemented data flow and CloudKit behavior with
      `docs/chrome-web-store-listing.md`, including AI-provider transfers and
      application-site autosave/upload behavior.
- [x] Keep EEO, disability, veteran, demographic, compensation, work authorization,
      and similar sensitive questions manual on the page and excluded from AI mapping.
- [x] Keep the extension's pairing token only in memory-backed
      `chrome.storage.session`, unavailable to content scripts, and purge the
      legacy disk-persisted value.
- [x] Document the pairing-token trust boundary and add a disconnect/revoke path.
- [ ] Complete human review of the documented trust boundary before broad launch.
- [x] Create the required listing icon and 440×280 promotional tile in `extension/store-assets/`.
- [x] Store screenshots saved per the owner’s September 25 report; confirm they match the final UI before submission.
- [ ] Complete `docs/chrome-web-store-reviewer-instructions.md` with stable reviewer fixture/import, the exact signed compatible macOS installer, and safe real AI access.
- [ ] Copy and confirm the first-release platform in the live Dashboard listing: macOS 14.4 or later only, with Unlisted visibility. Windows support is deferred until its separate release checks pass.
- [ ] Perform the manual Chrome QA checklist in `extension/README.md` against
      the exact release ZIP.

## Freeze and handoff

1. Finish the outstanding product/privacy work and run the README’s applicable manual checks on macOS for this first release. Record failures separately from passes.
2. Build the final ZIP, record its SHA-256, and capture screenshots from that same UI. Confirm no personal data, tokens, API keys, developer overlays, or unshipped promises appear in the images.
3. Validate name/version/description against the listing; select only data categories supported by the final inventory. Check the deployed policy in a fresh browser session.
4. Complete the owner-provided fields and reviewer access. Check the exact installer contains this bridge version; a generic latest-release link can point to an incompatible app.
5. Complete the remaining release steps under the owner’s existing authorization after the gates close. Dependency/security cleanup must finish before opening the `next` → `main` promotion PR. Keep automated publishing disabled until its configuration and product gates are complete. A successful upload or review submission does not mean users can install the extension yet.

Official submission behavior: [publishing documentation](https://developer.chrome.com/docs/webstore/publish) describes the upload, listing/privacy/test fields, and review step; [review process](https://developer.chrome.com/docs/webstore/review-process) explains that review timing varies. No review-time guarantee is made here.
