#!/usr/bin/env bash
# Build a SIGNED macOS app against the DEVELOPMENT CloudKit environment — the
# one the iPhone's data is in — for local end-to-end sync testing.
#
# Why a script: CloudKit needs three things a plain `npm run tauri:build` does
# not do — an embedded provisioning profile, entitlements that name the
# Development environment, and a signature from a certificate that profile is
# bound to. A build missing any one of them either fails to sign or connects to
# an empty container and never sees the phone; both look like sync bugs.
#
#   scripts/build-mac-dev.sh              build
#   OP_INSTALL=1 scripts/build-mac-dev.sh build, then copy to /Applications
#
# The verified-the-wrong-binary rule: /Applications/On Paper.app and this build
# share ONE data directory. After installing, `pgrep -fl resume-designer` must
# show exactly one binary before any conclusion is drawn from the UI.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${OP_DEV_PROFILE:-$HOME/Library/MobileDevice/Provisioning Profiles/On_Paper_Desktop__Development.provisionprofile}"
IDENTITY="${APPLE_SIGNING_IDENTITY:-Apple Development: Aakash Shah (AQ4C57H999)}"

[ -f "$PROFILE" ] || { echo "no Development profile at: $PROFILE" >&2; echo "set OP_DEV_PROFILE, or download it from the Developer portal" >&2; exit 1; }
security find-identity -v -p codesigning | grep -qF "$IDENTITY" || { echo "signing identity not in the keychain: $IDENTITY" >&2; exit 1; }

# The profile must bake in Development, or this build would sign and then
# connect to Production. Decoded and checked rather than assumed.
if ! security cms -D -i "$PROFILE" 2>/dev/null | grep -q "<string>Development</string>"; then
  echo "that profile does not permit the Development environment: $PROFILE" >&2; exit 1
fi
if ! security cms -D -i "$PROFILE" 2>/dev/null | grep -q "com.apple.developer.aps-environment"; then
  echo "that profile does not carry the push entitlement (com.apple.developer.aps-environment): $PROFILE" >&2
  echo "enable Push Notifications on the App ID in the Developer portal, regenerate the profile, download it again" >&2; exit 1
fi

cd "$ROOT"
# codesign hands the entitlements to AMFI, which parses them as strict XML and
# fails the whole build at the very END on e.g. a `--` inside a comment, which
# XML forbids. `plutil -lint` does NOT catch that — it passed the exact file
# AMFI rejected — so the gate is `xmllint`, a strict parser that does, plus
# plutil for plist-level structure. Both, before a five-minute build.
for f in src-tauri/Entitlements.plist src-tauri/Entitlements.development.plist; do
  xmllint --noout "$f" || { echo "$f is not well-formed XML (AMFI will reject it)" >&2; exit 1; }
  plutil -lint "$f" >/dev/null || { echo "$f is not a valid plist" >&2; exit 1; }
done
cp "$PROFILE" src-tauri/embedded.provisionprofile
echo "==> signing as: $IDENTITY"
echo "==> entitlements: Entitlements.development.plist (CloudKit env Development)"
# No updater artifacts for a dev build: that step needs the minisign private
# key (TAURI_SIGNING_PRIVATE_KEY), which only CI holds, and without it
# `tauri build` exits non-zero AFTER the app is signed — so the checks below
# never ran on the first attempt. The app is the deliverable here; the
# .app.tar.gz + .sig pair is a release concern.
# Symbols stay in a dev binary (the release profile strips them), so a crash
# report from this build names its frames. The 2026-09-20 CloudKit trap could
# not be read: every resume-designer frame was an unnamed offset.
CARGO_PROFILE_RELEASE_STRIP=false APPLE_SIGNING_IDENTITY="$IDENTITY" npx tauri build \
  --config '{"bundle":{"createUpdaterArtifacts":false,"macOS":{"entitlements":"Entitlements.development.plist"}}}'

APP="$(ls -d src-tauri/target/release/bundle/macos/*.app | head -1)"
echo "==> built: $APP"
echo "==> entitlements actually signed in:"
codesign -d --entitlements - --xml "$APP" 2>/dev/null | plutil -convert xml1 -o - - 2>/dev/null \
  | grep -A1 -E "icloud-container-identifiers|icloud-container-environment" | grep -E "string" | sed 's/^/    /'
[ -f "$APP/Contents/embedded.provisionprofile" ] && echo "==> embedded.provisionprofile: present" || { echo "==> embedded.provisionprofile: MISSING" >&2; exit 1; }
codesign --verify --deep --strict "$APP" && echo "==> signature verifies"

if [ "${OP_INSTALL:-}" = "1" ]; then
  rm -rf "/Applications/On Paper.app"; cp -R "$APP" /Applications/
  echo "==> installed to /Applications. Before believing anything: pgrep -fl resume-designer"
fi
