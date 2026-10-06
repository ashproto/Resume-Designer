# Companion launch — October 5, 2026

## Current status

The owner confirms that Companion 0.1.6 is **Public and Published** in the
Chrome Web Store dashboard and reports that their installation works well enough
for the initial release. On October 5, the unauthenticated Store listing was
independently verified reachable with version 0.1.6 and an Add to Chrome action.
The visibility setting is owner-confirmed; install-link availability is
independently verified.

The current `main` (`2059a3bf`) and `next` (`1c0ba3cb`) contain the same extension
tree and version 0.1.6. The Store version gate reports `release_required=false`
for that comparison. The unrelated changes on `next` need no new extension ZIP.

## Website prepared

`website/index.html` presents the desktop download before the optional Companion
section. A matching diagram shows resume → answer review → application. The
header/footer use the approved outlined On Paper logo, with light/dark assets.
The profile diagram measures the actual role cards to keep all three branches
connected as the page resizes, including the stacked mobile layout.

Browser checks at 320, 390, 540, 800, 880, 1000, and 1280px showed zero horizontal
overflow and zero branch endpoint offset. The previous SVG missed the outer
role centers by 70px at 1280px and 219px at 800px. Desktop/phone screenshots,
light/dark logo loading, section order, and internal links were checked.
The owner approved merging this website update into `next` through PR #150,
using `skip-build` to avoid an unchanged desktop/iOS build. The initial direct
`main` attempt passed Codex review but inherited existing dependency-audit and
Rust compatibility failures; those fixes are already present on `next`.
Normal CI and Codex review must pass against the updated base before a
history-preserving merge commit. GitHub Pages will deploy the website when
`next` is subsequently promoted to `main`; that app release remains separate.

Companion requires On Paper for macOS, macOS 14.4+, Chrome 116+, and an OpenRouter
key for its AI workflows. Desktop Windows availability does not establish
Companion Windows support.

## GitHub configuration saved and verified

- Environment: `chrome-web-store`.
- Deployment branch: `main` only; tags are not allowed.
- Initial release approval: repository owner `ashproto`; administrator bypass
  disabled. Self-approval is allowed for this single-owner setup.
- Environment variable `CWS_EXTENSION_ID`:
  `keggfbelidgpjiapcbgkjidenhdjmega`.
- Repository variable `CWS_AUTO_PUBLISH=false`; automatic uploading is deferred by the owner.
- No Google service-account key or other environment secret was added.

The existing Chrome release workflow detects package changes after a successful
production desktop release, validates the package, and can submit for staged or
automatic publication. Version increases remain explicit in extension changes.
Google review still precedes distribution to Chrome users.

## Deferred connection setup

The owner explicitly deferred automatic Chrome extension uploading on October 5.
No Google Cloud project or publishing identity will be created for now. The
existing GitHub configuration stays inactive. Continue uploading ZIPs manually
in the Chrome Web Store dashboard.

When the owner chooses to resume automation:

1. Create/select the publishing project and enable the Chrome Web Store API.
2. Create the dedicated service account and GitHub Workload Identity Federation
   provider, restricted to this repository, `main`, the release workflow, and
   the `chrome-web-store` environment. Follow
   [the release setup](chrome-web-store-release.md#google-cloud-and-keyless-authentication).
3. Link the service account in the Chrome Web Store publisher settings.
4. Set `GCP_WORKLOAD_IDENTITY_PROVIDER`, `CWS_SERVICE_ACCOUNT`, and
   `CWS_PUBLISHER_ID` on the GitHub environment. These identifiers are not API keys.
5. Run the workflow from `main` in `status-only` mode to verify access without
   uploading or publishing. An active Public-visibility review must be preserved.
6. For the first changed extension version, use staged submission and verify
   Store review/update behavior. Enable automatic publishing only after this
   connection and release path have been verified.

No workflow was dispatched and no Store submission or publication was performed
as part of this setup. Automated publishing remains disabled.
