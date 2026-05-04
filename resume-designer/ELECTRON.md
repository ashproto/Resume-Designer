# Electron Desktop App Guide

This document covers building, distributing, and updating the Resume Designer desktop app.

## Quick Start

```bash
# Development (web)
npm run dev

# Development (Electron with built files)
npm run electron:dev

# Development (Electron with hot reload)
npm run dev           # Terminal 1
npm run electron:start  # Terminal 2
```

## Building for Distribution

### Prerequisites

1. **App Icons** (optional but recommended)
   - Place `icon.icns` in `build/` for macOS
   - Place `icon.ico` in `build/` for Windows
   - See `build/ICONS.md` for creation instructions

2. **Code Signing** (recommended for distribution)
   - macOS: Requires Apple Developer account ($99/year)
   - Windows: Requires code signing certificate

### Build Commands

```bash
# Build for current platform
npm run electron:build

# Build for specific platforms
npm run electron:build:mac    # macOS only
npm run electron:build:win    # Windows only
npm run electron:build:all    # Both platforms

# Build and publish to GitHub Releases
npm run electron:publish
```

### Build Output

After building, find your installers in the `release/` folder:

| Platform | Files |
|----------|-------|
| macOS | `Resume-Designer-1.0.0-arm64.dmg`, `Resume-Designer-1.0.0-arm64.zip`, `latest-mac.yml` |
| Windows | `Resume-Designer-Setup-1.0.0.exe`, `latest.yml` |

## Distribution Options

### Option 1: GitHub Releases (Recommended)

Best for open source or small distribution:

1. **Set up GitHub repository**
   ```bash
   git init
   git remote add origin https://github.com/YOUR_USERNAME/resume-designer.git
   ```

2. **Update package.json**:
   ```json
   "publish": {
     "provider": "github",
     "owner": "SiriusA7",
     "repo": "Resume-Designer"
   }
   ```

3. **Enable CI release workflow**:
   - Workflow file: `.github/workflows/release.yml`
   - Trigger: every push to `master` or `main` (including merged PRs)
   - Output: new GitHub Release with macOS + Windows artifacts

4. **Configure repository secrets/variables**:
   - Required:
     - `GITHUB_TOKEN` (provided automatically by GitHub Actions)
   - Required workflow permission:
     - `models: read` (already declared in `.github/workflows/release.yml`)
   - Optional:
     - customize changelog categories in `.github/release.yml`

5. Users download from your GitHub Releases page

### Option 2: Direct Download (Your Website)

Host the installers on your own server:

1. Build the app: `npm run electron:build:all`
2. Upload files from `release/` to your server
3. Provide download links on your website

### Option 3: App Stores

**Mac App Store:**
- Requires Apple Developer account ($99/year)
- More complex signing and notarization process
- See: https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide

**Microsoft Store:**
- Requires Microsoft Partner account
- Convert to MSIX format
- See: https://www.electronjs.org/docs/latest/tutorial/windows-store-guide

## Auto-Updates

Auto-updates are configured to work with GitHub Releases.

### How It Works

1. App checks for updates on startup (production only)
2. If update available, user is prompted to download
3. After download, user can restart to apply update
4. Updates are signed and verified automatically

### Setting Up Auto-Updates

1. **GitHub Releases** (already configured):
   - CI creates a release on every `master` or `main` push
   - CI computes the next semantic version from commit messages:
     - `major` when commits contain `BREAKING CHANGE` or `!`
     - `minor` when commits include `feat:`
     - otherwise `patch`
   - CI builds installers and uploads updater metadata (`latest*.yml`)
   - CI first generates baseline notes using GitHub release notes + `.github/release.yml`
   - CI then attempts a GitHub Models rewrite for more user-facing notes
   - If AI rewrite fails, CI automatically falls back to baseline notes

2. **No manual version bump needed** for CI releases:
   - Workflow applies the computed version during build
   - Source files are not modified by the workflow commit-wise

### Testing Updates

To test the update flow locally:

1. Install an older release build from GitHub Releases
2. Merge a PR into `main` (or push directly to `main`)
3. Wait for `.github/workflows/release.yml` to publish the new release
4. Open the installed older app - it should detect and prompt for the update

## Code Signing

### macOS Code Signing & Notarization

Required for distributing outside the Mac App Store. Auto-update on macOS will fail unless both the installed app and update artifacts are properly signed.

If the OS rejects a downloaded update at install time, the app surfaces a clear error in the updater UI within ~10 seconds rather than appearing to hang. Signature-validation failures get a more specific message pointing the user toward installing a properly signed/notarized build.

#### A) Create the Developer ID certificate in Apple Developer

1. Open Apple Developer Certificates:
   - https://developer.apple.com/account/resources/certificates/list
2. In Keychain Access on your Mac:
   - `Keychain Access` -> `Certificate Assistant` -> `Request a Certificate From a Certificate Authority...`
   - Enter your email, save to disk as a `.certSigningRequest` file.
3. Back in Apple Developer:
   - Click `+` to add certificate.
   - Choose `Developer ID Application`.
   - Upload the CSR from step 2.
   - Download the generated certificate (`.cer`).
4. Install the downloaded certificate:
   - Double-click the `.cer` file to add it to Keychain.
5. Export certificate + private key as `.p12`:
   - In Keychain Access, find the `Developer ID Application` identity.
   - Expand it and ensure the private key is present under the certificate.
   - Right-click certificate -> `Export`.
   - Export as `.p12` and set a password. Save this password.

#### B) Generate Apple notarization credentials

1. Create an app-specific password for your Apple ID:
   - https://appleid.apple.com/account/manage
   - Sign in -> `App-Specific Passwords` -> create new password.
2. Get your Apple Team ID:
   - Apple Developer account -> Membership page.
   - Team ID is a 10-character value (for example `AB12C34DEF`).

#### C) Convert `.p12` to base64 for GitHub secret

Run this on your Mac:

```bash
base64 -i /absolute/path/to/DeveloperIDApplication.p12 | tr -d '\n' > /tmp/csc_link_base64.txt
```

Copy the full contents of `/tmp/csc_link_base64.txt`.

#### D) Add required GitHub Actions secrets

GitHub repo -> `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`.

Create all of the following:

- `CSC_LINK`: base64 output from step C
- `CSC_KEY_PASSWORD`: password you set when exporting the `.p12`
- `APPLE_ID`: your Apple ID email
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password from step B
- `APPLE_TEAM_ID`: your 10-character Team ID

#### E) What this repo already enforces now

The release pipeline now:

1. Requires all five secrets above before mac build starts.
2. Builds mac app with:
   - Hardened runtime
   - Entitlements (`build/entitlements.mac.plist`)
   - Inherited entitlements (`build/entitlements.mac.inherit.plist`)
   - Notarization enabled
3. Fails fast if secrets are missing, instead of publishing unsigned artifacts.

#### F) Verify signed/notarized outputs after release

After a new release is published, download the `.dmg` and verify on a Mac:

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/Resume Designer.app"
spctl -a -t exec -vv "/Applications/Resume Designer.app"
```

Expected result:
- `codesign` verification passes
- `spctl` reports `accepted`

If verification fails, check the macOS build job logs in GitHub Actions for certificate import/sign/notarization errors.

### Windows Code Signing

1. **Purchase a code signing certificate** from:
   - DigiCert
   - Sectigo
   - GlobalSign

2. **Set environment variables**:
   ```bash
   export CSC_LINK=path/to/your/certificate.pfx
   export CSC_KEY_PASSWORD=your_certificate_password
   ```

## Troubleshooting

### Common Issues

**"App is damaged" on macOS**
- App is not code signed or notarized
- Users can right-click > Open to bypass (not recommended for distribution)

**Windows SmartScreen warning**
- App is not code signed
- After enough installs, reputation builds and warnings decrease

**Auto-update not working**
- Check that `publish` config in package.json is correct
- Verify release assets include `latest.yml` / `latest-mac.yml`
- Ensure release artifacts include platform installers and `.blockmap` files
- If AI notes fail, workflow falls back to baseline GitHub notes

**Build fails on Windows**
- Install Visual Studio Build Tools
- Run as Administrator if permission errors

**Build fails on macOS**
- Install Xcode Command Line Tools: `xcode-select --install`

## File Structure

```
resume-designer/
├── electron/
│   ├── main.cjs          # Main process (window, IPC, updates)
│   └── preload.cjs       # Secure bridge to renderer
├── build/
│   ├── icon.icns         # macOS icon
│   ├── icon.ico          # Windows icon
│   ├── entitlements.mac.plist
│   ├── entitlements.mac.inherit.plist
│   └── ICONS.md          # Icon creation guide
├── release/              # Built installers (git-ignored)
├── src/
│   └── native.js         # Platform abstraction layer
└── package.json          # Build configuration
```

## Useful Links

- [Electron Builder Docs](https://www.electron.build/)
- [Auto-Update Docs](https://www.electron.build/auto-update)
- [Code Signing Guide](https://www.electron.build/code-signing)
- [GitHub Releases Publishing](https://www.electron.build/configuration/publish#githuboptions)
