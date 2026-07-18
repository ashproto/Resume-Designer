# Chrome Web Store release operations

This document is the operational source of truth for shipping the Resume
Designer Companion extension. The workflow is designed so Store credentials
never reach pull-request code and an extension that requires a new bridge
capability is submitted only after the corresponding production desktop
release workflow succeeds.

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
submitted.

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

Chrome requires human-owned publisher and listing setup before the API can
publish an item. Complete these once in the Chrome Web Store Developer
Dashboard:

1. Register the publisher and enable two-step verification.
2. Pay the one-time developer registration fee, verify the publisher contact
   email, and complete the applicable trader or non-trader declaration. A
   trader must also complete Google's public identity/contact verification.
3. Create the Store item and upload the first validated ZIP to establish its
   extension ID.
4. Complete Store Listing, Privacy practices, Test instructions, and
   Distribution using `docs/chrome-web-store-listing.md`.
5. Add the public privacy-policy, support, and homepage URLs.
6. Upload screenshots and promotional artwork.
7. Select initial visibility. Use **Unlisted** for the prelaunch beta unless a
   public listing is intentionally ready.
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
- [Chrome Web Store 2026 disclosure-policy update](https://developer.chrome.com/blog/cws-policy-updates-2026?hl=en)

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
   unzip -t artifacts/resume-designer-companion-*.zip
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

- [ ] Publish a stable privacy policy and support page.
- [ ] Add a prominent first-use disclosure and affirmative consent before page
      or résumé data is processed. For the Chrome policy effective August 1,
      2026, enumerate page origin/path and form descriptors; résumé, profile,
      and learned answers; generated PDFs; the session pairing credential;
      OpenRouter/downstream-provider transfers; and application-site
      fill/upload behavior.
- [ ] Make the privacy policy reachable from the side panel.
- [ ] Reconcile the final behavior with
      `docs/chrome-web-store-listing.md`, including AI-provider transfers and
      application-site autosave/upload behavior.
- [ ] Decide whether EEO, disability, veteran, demographic, compensation, and
      similar sensitive questions are excluded or always manual by default.
- [x] Keep the extension's pairing token only in memory-backed
      `chrome.storage.session`, unavailable to content scripts, and purge the
      legacy disk-persisted value.
- [ ] Document and approve the pairing-token threat model; add a clear
      disconnect/revoke path before broad launch.
- [ ] Capture Store screenshots and create required promotional artwork from
      the final UI.
- [ ] Provide stable reviewer instructions, test fixture, desktop download, and
      a test configuration that exercises the core path.
- [ ] Copy and confirm the documented desktop floors in the live Dashboard
      listing: macOS 14.4 or later and Windows 10 version 1809 or later.
- [ ] Perform the manual Chrome QA checklist in `extension/README.md` against
      the exact release ZIP.
