# The iOS Xcode project is committed source

`resume-designer/src-tauri/gen/apple` used to be disposable generated output.
It is now **tracked source**, because the SwiftUI shell
([`src-tauri/ios/`](../../resume-designer/src-tauri/ios/)) has to be compiled
into the app and an untracked project loses that reference on every
regeneration.

The rest of `src-tauri/gen/` is still ignored. `resume-designer/.gitignore`:

```gitignore
src-tauri/gen/*
!src-tauri/gen/apple
```

Build output inside the Apple project is excluded by the project's own
`src-tauri/gen/apple/.gitignore`, which Tauri generates and we keep:
`build/`, `Externals/`, `xcuserdata/`. Committed source includes the
xcodeproj, `project.yml`, the app icons, the Info plist, the entitlements, the
launch storyboard, `main.mm` and its bindings header. The Cloud hooks in
`ci_scripts/` are also maintained source; build/tool downloads stay ignored.

## What is hand-maintained

**Edit `project.yml` and the maintained generator hook, not the pbxproj.**
`resume-designer.xcodeproj` is derived by `xcodegen generate`, including its
`postGenCommand` in `scripts/ios-project-name.mjs`. Manual pbxproj edits are
discarded by the next regeneration.

These parts of `project.yml` are maintained here:

| Block | Why it exists |
|---|---|
| `info.properties: UIApplicationSceneManifest` (+ `CFBundleDisplayName`, `ITSAppUsesNonExemptEncryption`) | **The app is invisible without the scene manifest.** tao never assigns its `UIWindow` a `windowScene` on its own; a static scene manifest is what makes iOS hand one over, which `src-tauri/src/ios_view.rs` then attaches. Without it the webview stays 0×0 and the app launches black. |
| `sources: - path: ../../ios` | Compiles the SwiftUI shell from its tracked home, so there is exactly one copy of it. Without this the shell is not in the app and `AnyClass::get(c"OPShell")` returns `None` at runtime. |
| `Externals: excludes: ["**/*.a"]` | `Externals` is empty when `tauri ios init` first runs and holds the 365 MB `libapp.a` afterwards. Without the exclude, a later `xcodegen generate` copies that static library into the app bundle's Resources. It is *linked* via the `libapp.a` dependency; it must never be a resource. |
| `DEVELOPMENT_TEAM: "847VH25R7U"` | Tauri writes this straight into the pbxproj and never records it in `project.yml`, so `xcodegen generate` drops it and device builds stop signing. Simulator builds don't care; device builds do. |
| the `Shell` group name | Cosmetic — keeps the shell separate from generated `Sources` in Xcode's navigator. |
| `OP_RUST_LIB_ROOT` and library search/output paths | CI links its own static library from isolated output; it must not overwrite a developer's existing `Externals/libapp.a`. The default remains the local Tauri path. |
| conditional `Build Rust Code` phase | Xcode Cloud invokes Xcode without a parent Tauri CLI options server. `OP_IOS_CI=1` or Cloud selects the locked Cargo helper; the regular local Tauri command is preserved. See [TestFlight automation](testflight-automation.md). |
| `options.postGenCommand` | Sets the visible Xcode target name to **On Paper**, which Xcode Cloud uses during product discovery. Preserves the legacy target IDs, scheme name and configuration-list comments required by the local Tauri CLI. |

## Xcode and Xcode Cloud naming

The generated target's `name` and shared scheme's `BlueprintName` are **On
Paper**. The generator key and shared scheme filename remain
`resume-designer_iOS`. This is deliberate: Tauri CLI 2.11.2 selects that
scheme and finds the target's signing/build configurations using `_iOS` in
the `XCConfigurationList` comments. The post-generation hook changes only
the display name and scheme references; it preserves those comments and IDs.
It fails before writing if the generator no longer produces that contract.

Keep the hook when regenerating with either `xcodegen generate` or
`tauri ios init`. Validate Tauri compatibility when upgrading either tool.
Apple documents product discovery with
`xcodebuild -project resume-designer.xcodeproj -describeAllArchivableProducts -json`;
the result must have `displayName: On Paper`, `bundleIdentifier: com.onpaper.app`
and `containingSchemes: [resume-designer_iOS]`.

The Cloud manifest maps **On Paper** and the existing server label
`resume-designer_iOS` to the same product UUID. Xcode adds the legacy mapping
when reopening the project; preserve both until Apple refreshes that label.
The product UUID and workflow UUID remain unchanged. Local discovery does not
prove that Apple has refreshed an existing server-side product label; verify
that separately in Xcode Cloud. No product deletion is part of this rename.

## Re-running `tauri ios init` — measured, not assumed

Run against the committed tree on 2026-08-10. It **does not touch
`project.yml`**, so everything expressed there survives. What it changes:

| File | What it does |
|---|---|
| `resume-designer_iOS/Info.plist` | Rewrites it from `project.yml`. This is why the scene manifest lives in `project.yml` now: when those keys existed only in the plist, this step **deleted them**, which is a black-screen bug wearing a cosmetic diff. |
| `resume-designer.xcodeproj/project.pbxproj` | Re-randomises two `TEMP_<uuid>` `PBXGroup` names for the empty `Externals/arm64` and `Externals/x86_64` groups. Pure churn — discard it. |

So the procedure is short:

```bash
cd resume-designer
git status --short src-tauri/gen/apple     # must be clean first
npx tauri ios init
git diff src-tauri/gen/apple               # read every hunk
```

Expect the two `TEMP_` lines and nothing else. **Anything else in that diff is
the generator taking something back** — check it against the table above before
accepting it. Commit the generator's changes and ours as separate commits so
the next person can tell them apart.

**Tauri upgrades will produce conflicts here.** That is the deal: a generated
project became a maintained one. The conflicts are ours to resolve, and the
table above is the checklist.

## Gotchas that cost time once already

- **`failed to rename app …: Directory not empty (os error 66)`** during Tauri's
  post-build packaging is a stale output directory, not a project-file problem.
  `rm -rf src-tauri/gen/apple/build/arm64-sim` and rebuild.
- **Xcode sometimes emits the app as a small stub plus `On Paper.debug.dylib`.**
  When it does, `nm "On Paper"` looks empty and is misleading — check the dylib.
  Whether you get a stub or one fat binary varies by build; search both.
- **`tauri ios dev` is unusable for simulators** — it misclassifies every one as
  a physical device. Use
  `npx tauri ios build --debug --target aarch64-sim` plus
  `xcrun simctl install booted "…/build/arm64-sim/On Paper.app"`.

## Frozen, and not touched by any of this

Desktop bundle identifier `com.resumedesigner.app`, iOS bundle identifier
`com.onpaper.app`, the Cargo package name `resume-designer`, and every
`resume-designer-*` / `resume-*` storage key remain unchanged. The Xcode
project filename and legacy scheme are preserved for Tauri compatibility;
the visible target and `PRODUCT_NAME` are **On Paper**.

## Reverting pbxproj churn: the test that is NOT sufficient

`xcodegen generate` rewrites `TEMP_<uuid>` group names on every run, so most
`project.pbxproj` diffs are pure churn and get reverted. **That habit dropped
three Swift files out of the committed target** — `OPOnboarding.swift`,
`OPOnboardingSteps.swift` and `OPSync.swift` — because the same builds that
churned the UUIDs had also ADDED those files.

Nothing failed. `npm run ios:sim` regenerates the project before building, so
the committed project being wrong is invisible right up until someone opens it
in Xcode or builds by a path that skips xcodegen.

So "is this diff only `TEMP_` UUID churn?" is necessary but not sufficient.
Before reverting, also check:

```bash
git diff -U0 src-tauri/gen/apple/resume-designer.xcodeproj/project.pbxproj \
  | grep -E "^[+-]" | grep -v "^[+-][+-]" \
  | grep -vE "TEMP_|path = (arm64|x86_64);"
```

If that prints nothing, the diff is churn and may be reverted. If it prints a
`PBXFileReference` or `PBXBuildFile` line, a source file's target membership is
in there — **commit it**. The same applies to `IPHONEOS_DEPLOYMENT_TARGET` and
`PRODUCT_BUNDLE_IDENTIFIER` lines, which are regenerated output but are also
the only committed record of a real config change.
