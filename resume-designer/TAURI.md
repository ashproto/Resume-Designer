# Tauri Desktop App Guide

This document covers building, distributing, and updating the Resume Designer desktop app, which is built with [Tauri 2](https://v2.tauri.app/).

## Quick Start

```bash
# Browser-only development (no Tauri shell)
npm run dev

# Tauri development — opens the desktop window with hot reload
npm run tauri:dev

# Production build (current platform, current arch)
npm run tauri:build

# Production build for a specific target
npm run tauri:build:mac:arm64
npm run tauri:build:mac:x64
npm run tauri:build:win
```

First Tauri build takes 3-5 minutes (Rust compilation). Subsequent builds are cached and quick.

## Prerequisites

1. **Rust toolchain** — install via [rustup](https://rustup.rs/).
2. **Node.js 20+**.
3. **macOS dev**: Xcode Command Line Tools (`xcode-select --install`).
4. **Windows dev**: Visual Studio C++ Build Tools and the Windows SDK.

> **Lockfile note:** regenerate `resume-designer/package-lock.json` with **npm 10** (the npm that ships with Node 20), **not npm 11**. npm 11 records esbuild's optional platform packages without the `optional` flag, which makes CI's `npm ci` fail with `EBADPLATFORM`. If your local Node is newer, run `npx npm@10 install` from `resume-designer/`. CI pins Node 20 / npm 10.

## App Icons

The repo currently ships without custom icons (default Tauri placeholders are used). To add custom icons:

1. Create a 1024×1024 PNG named `icon.png`.
2. Run `npx tauri icon path/to/icon.png` from `resume-designer/` — generates all required sizes into `src-tauri/icons/`.

## File Structure

```
resume-designer/
├── src-tauri/
│   ├── Cargo.toml             # Rust dependencies
│   ├── tauri.conf.json        # Window, security/CSP, bundle, updater
│   ├── Entitlements.plist     # macOS entitlements
│   ├── build.rs               # tauri-build runner
│   ├── capabilities/
│   │   └── default.json       # Renderer permissions for Tauri plugins
│   ├── icons/                 # App icons (generate via `tauri icon`)
│   └── src/
│       ├── main.rs
│       ├── lib.rs             # Builder, plugins, RunEvent::Reopen
│       └── commands/
│           ├── mod.rs         # PdfResult / print_to_pdf dispatcher
│           ├── pdf_macos.rs   # WKWebView createPDF
│           └── pdf_windows.rs # WebView2 PrintToPdfAsync
├── src/                       # Renderer (vanilla JS + Vite)
├── index.html
├── package.json
└── vite.config.js
```

## Building for Distribution

CI is the recommended path for release builds — see "Release workflow" below. For local releases:

```bash
# Build mac for current architecture (signed if env vars are set, else unsigned)
npm run tauri:build

# Cross-build mac arm64 from Intel mac, or vice versa
rustup target add aarch64-apple-darwin
npm run tauri:build:mac:arm64
```

Outputs live under `src-tauri/target/<arch>/release/bundle/`:

- **macOS**: `bundle/dmg/Resume Designer_<version>_<arch>.dmg`, `bundle/macos/Resume Designer.app`, plus an `.app.tar.gz` + `.app.tar.gz.sig` pair (the updater bundle and its minisign signature).
- **Windows**: `bundle/nsis/Resume Designer_<version>_x64-setup.exe`, plus `.nsis.zip` + `.nsis.zip.sig` for the updater.

## Code Signing & Notarization (macOS)

Required for distributing outside the Mac App Store. Without proper notarization, the auto-updater will reject downloaded updates.

### One-time setup

1. **Get a Developer ID Application certificate** from your Apple Developer account (https://developer.apple.com/account/resources/certificates/list).
2. **Export it as `.p12`** from Keychain Access (right-click → Export).
3. **Convert `.p12` to base64** for GitHub secret:
   ```bash
   base64 -i /absolute/path/to/DeveloperIDApplication.p12 | tr -d '\n' > /tmp/csc_link_base64.txt
   ```
4. **Generate an app-specific password** at https://appleid.apple.com/account/manage (Sign-in and Security → App-Specific Passwords).
5. **Look up your Team ID** on the Apple Developer Membership page (10-character code, e.g. `AB12C34DEF`).
6. **Find your signing identity string**:
   ```bash
   security find-identity -v -p codesigning
   # Look for: "Developer ID Application: Your Name (TEAMID12)"
   ```

### GitHub repo secrets (required for CI)

Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64-encoded `.p12` contents |
| `CSC_KEY_PASSWORD` | Password set when exporting the `.p12` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from above |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `APPLE_SIGNING_IDENTITY` | Full identity string (e.g. `Developer ID Application: Your Name (AB12C34DEF)`) |

The CI workflow validates that all of these are present before starting the macOS build and fails fast if any are missing.

## Auto-Update Setup

### Generate the minisign keypair (one-time)

Tauri's updater signs every release artifact with a minisign key and verifies the signature against the public key baked into the app.

```bash
cd resume-designer
npx tauri signer generate -w ~/.tauri/resume-designer.key
# Set and remember a password when prompted.
```

Two files are produced:

- `~/.tauri/resume-designer.key` — **private** key (never commit; never share).
- `~/.tauri/resume-designer.key.pub` — public key.

### Wire the keys

1. **Paste the public key contents** into [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) under `plugins.updater.pubkey`, replacing `REPLACE_ME_AFTER_RUNNING_TAURI_SIGNER_GENERATE`.
2. **Add two GitHub secrets** (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY`: the **contents** (not the path) of `~/.tauri/resume-designer.key`.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password you set above.

The Tauri CLI reads these env vars during `tauri build` to produce signed updater bundles.

### How auto-update works

- App startup runs `startupUpdateCheck()` (see [src/native.js](src/native.js)).
- The updater fetches `https://github.com/SiriusA7/Resume-Designer/releases/latest/download/latest.json`.
- If `version` exceeds the installed version, the user is prompted to download.
- After the download (with minisign verification), the user is prompted to restart.
- A 10-second watchdog timer surfaces a clear error if the restart-into-installer step fails (e.g. malformed signature).

The `latest.json` manifest is assembled by CI from the per-platform `.sig` files and uploaded to the release.

## Release Workflow

[.github/workflows/release.yml](../.github/workflows/release.yml) runs on every push to `main` (and `workflow_dispatch`), but **releases are gated by [release-please](https://github.com/googleapis/release-please)** — a merge to `main` does not publish a release on its own.

1. **`release-please`** — on each push to `main`, maintains a **Release PR** that accumulates the version bump and `CHANGELOG.md` from Conventional Commit messages since the last release. Merging a feature PR just updates this Release PR; it does **not** cut a release.
2. **Cut a release** by merging the Release PR. release-please then publishes a `vX.Y.Z` GitHub Release (changelog as the body), and the build jobs run (gated on release-please's `release_created` output):
   - **`build-macos`** — matrix-builds `aarch64`/`x86_64`, signs + notarizes via `tauri-apps/tauri-action`.
   - **`build-windows`** — unsigned NSIS installer + updater bundle.
   - **`release`** — assembles `latest.json`, AI-polishes the changelog into user-facing notes (GitHub Models GPT-5-mini, best-effort), and attaches the installers + `latest.json` to the release.

Version bump (release-please, from Conventional Commits):

- `major` for a `!` marker or `BREAKING CHANGE`.
- `minor` for a `feat:` commit.
- `patch` for `fix:` / `deps:` (and other releasable types).

To force a specific version, edit `.release-please-manifest.json` (the `Release-As:` commit footer does **not** work with plain merge commits, which this repo uses).

> A freshly published release is briefly asset-less — the signed installers and `latest.json` attach ~10-15 minutes later once the build jobs finish — so an in-app update check during that window degrades gracefully.

### Windows code signing

Currently **not** signed. Users will see a Microsoft Defender SmartScreen warning the first time they run the installer. To add Authenticode signing later, set the `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD` GitHub secrets — `tauri-action` will pick them up automatically.

### Testing updates end-to-end

1. Install a signed Tauri build from a previous GitHub Release (or trigger one via `workflow_dispatch`).
2. Push a commit that bumps the computed version (any commit increments at least patch).
3. After the workflow finishes, reopen the older app. On startup it should:
   - Toast "Version X.Y.Z is available".
   - Prompt "Download?" → after click, show download progress in the toast.
   - Prompt "Restart Now?" → after click, relaunch into the new version.
   - Confirm via DevTools: `(await import('./native.js')).getAppInfo()`.

## System requirements

- **macOS 12.3 (Monterey) or later.** `bundle.macOS.minimumSystemVersion` is set to `12.3` in `tauri.conf.json`, so older versions cannot install the app. (PDF export uses `WKWebView.createPDF(configuration:completionHandler:)`, which Apple shipped in macOS 11; the bundle floor is set higher.)
- **Windows 10 1809 or later** (WebView2 runtime required; Windows 11 ships it preinstalled).

## Content Security Policy

The desktop CSP lives in [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) under
`app.security.csp`. `script-src` is locked to `'self'` plus the **SHA-256 hash** of the single
inline `<script>` in `index.html` (the liquid-glass bootstrap) — it deliberately does **not** use
`'unsafe-inline'`, so an injected inline `<script>` or event-handler attribute cannot execute.

⚠️ If you edit that inline bootstrap script in `index.html`, recompute its hash and replace the
`'sha256-…'` token in `script-src`, otherwise the desktop build will refuse to run the script (the
window loses its translucent background). Regenerate the hash with:

```bash
node -e "const fs=require('fs'),c=require('crypto');const s=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];console.log('sha256-'+c.createHash('sha256').update(s).digest('base64'))"
```

`style-src` intentionally keeps `'unsafe-inline'` (dynamic theming + Google Fonts); inline styles
are far lower risk than inline scripts. Note this CSP applies only to the **desktop** webview —
Tauri injects it; the plain browser build (`npm run dev` / `npm run build`) is not covered.

## Troubleshooting

**"App is damaged" on macOS** — the app wasn't signed/notarized. Check that all six macOS secrets are set in the GitHub repo, and inspect the `build-macos` job logs for `codesign`/`notarytool` errors.

**Updater says "signature verification failed"** — usually means the `pubkey` in `tauri.conf.json` doesn't match the private key that signed the `.sig` files in the release. Regenerate the keypair or correct the secret.

**`tauri dev` opens a window but the frontend never appears** — check that Vite is running on port 3000 (the configured `devUrl`). The Vite config uses `strictPort: true`, so a port conflict will fail loudly.

**CSP violation when calling OpenRouter** — the CSP `connect-src` in `tauri.conf.json` must include `https://openrouter.ai`. Test by running `fetch('https://openrouter.ai/api/v1/key')` in DevTools and watching for `Refused to connect` errors.

**`xcrun: error: invalid active developer path`** — install Xcode Command Line Tools: `xcode-select --install`.

## Useful Links

- [Tauri 2 documentation](https://v2.tauri.app/)
- [Tauri updater plugin](https://v2.tauri.app/plugin/updater/)
- [Tauri dialog plugin](https://v2.tauri.app/plugin/dialog/)
- [Tauri fs plugin](https://v2.tauri.app/plugin/file-system/)
- [tauri-action](https://github.com/tauri-apps/tauri-action)
