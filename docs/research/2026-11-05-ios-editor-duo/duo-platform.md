# iPhone Duo platform findings for On Paper

Research date: 2026-11-05. Read-only platform research; no project edits, Git mutations, simulator boot, installation, or physical-device testing.

## Verified platform guidance

[Apple’s Duo HIG](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo) describes the side status/navigation/toolbar rail as normal system behavior on the outer display and opened landscape. It is asymmetrical and remains aligned with the hardware, including in RTL. Do not recreate or hide this rail. Prefer system bars, independent safe-area insets, and compact/regular layouts. The inner display can show an additional level of the existing hierarchy; the outer display collapses it. Keep the same capabilities and interaction state across poses. Use native toolbar groups, title-plus-symbol labels, priorities, and the system overflow menu. Avoid custom layouts for every pose and fixed display dimensions. Reserved regions represent camera occlusions and the folding division; native sheets and split views adapt automatically.

[Apple’s preparation guide](https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo) recommends scene/container bounds rather than screen dimensions, device idiom, or orientation. Put SwiftUI toolbar content on NavigationStack or NavigationSplitView; manually embedded bars do not receive the same adaptation. Text-only or custom-view toolbar items remain horizontal by default; custom views can opt into appropriate axis behavior with the newer APIs. Inspectors keep horizontal bars; sheet behavior varies with display/placement. ArrangementView is for a primary/secondary content relationship; standard containers are the safer first choice for this editor.

[Apple’s DTS group-lab summary](https://developer.apple.com/forums/thread/847644) confirms that folds and inner/outer transitions are resize/trait changes rather than process/scene teardown. Preserve draft text, selected section, scroll position, zoom, and pending review state. Size classes alone do not report the exact fold frame. Outer-display rotations may retain the same classes; toolbarVerticalEdge is the precise signal for vertical bars. Safe areas can differ on every side. Custom bars may require both reserved-region queries and vertical-bar state; safeAreaInsets alone is not an exact hinge/camera detector. Ordinary adaptive UI should use standard containers before specialized APIs.

[Apple’s October 5 developer notice](https://developer.apple.com/news/?id=kkphp5qo) says Xcode 27.1 adds Duo development support and recommends Device Hub for all poses/orientations. The installed Xcode is newer than that requirement.

## Direct implementation implications (inferences for this app)

- The status rail visible in the screenshots is expected. The defect to investigate is how On Paper’s custom shell, canvas, and controls consume or ignore the remaining safe area.
- Use native list/detail navigation for Edit Resume, with compact section rows and a focused detail editor. Let the expanded layout expose the existing hierarchy rather than scaling the entire compact UI.
- Prefer semantic native toolbar items for Undo, Redo, Chat, Edit, Format, and Share. Keep section-specific actions beside the selected section; reserve zoom text/custom controls for content-local UI that explicitly consumes safe area.
- Avoid device-name checks, fixed rail widths, symmetrical inset assumptions, and mirrored physical-edge assumptions in RTL.
- Start with the standard native container/toolbar APIs supported by the existing Xcode 26.6 CI. Adopt new region APIs only if custom edge UI actually needs them and SDK compatibility is handled deliberately.

## Installed SDK evidence

Installed tools: Xcode 27.2 (27B52), Apple Swift 6.4.2. SDK evidence below is from the installed iPhoneOS SDK, not an invented future API.

Base path: `/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk/System/Library/Frameworks/`.

| API | Local declaration evidence | Availability |
|---|---|---|
| `GeometryProxy.safeAreaInsets` | `SwiftUICore.framework/Modules/SwiftUICore.swiftmodule/arm64e-apple-ios.swiftinterface:10328` | Existing baseline API |
| `GeometryProxy.reservedRegions(kind:options:layoutDirectionBehavior:)` | Same interface `:10337-10338` | iOS 27.1+ |
| `ReservedRegion` (`frame`, `margins`, `isActive`; `.occlusion`/`.division`) | Same interface `:4854-4891` | iOS 27.1+ |
| `EnvironmentValues.toolbarVerticalEdge` | Same interface `:2549-2553` | iOS 27.1+ |
| `ArrangementView` | Same interface `:16710-16727` | iOS 27.1+ |
| `toolbarVerticalBehavior(_:)` | `SwiftUI.framework/Modules/SwiftUI.swiftmodule/arm64e-apple-ios.swiftinterface:32232-32240` | iOS 27.1+ |
| `ToolbarContent.axisBehavior(_:)` | Same interface `:17557-17559` | iOS 27.1+ |
| `ToolbarOverflowMenu` | Same interface `:31200-31206` | iOS 27.0+ |
| `ToolbarItemPlacement.topBarPinnedTrailing` | Same interface `:7813-7818` | iOS 27.0+ |
| `UIView.safeAreaInsets` / `safeAreaInsetsDidChange()` | `UIKit.framework/Headers/UIView.h:297-298` | iOS 11+ |
| `UIViewController.additionalSafeAreaInsets` / `viewSafeAreaInsetsDidChange()` | `UIKit.framework/Headers/UIViewController.h:570,585` | iOS 11+ |
| `UIView` reserved-region queries | `UIKit.framework/Headers/UIView.h:762-768`; model header `UIViewReservedRegion.h:18-75` | iOS 27.1+ |

Exact SwiftUI query in this SDK: `proxy.reservedRegions(kind: .occlusion)` or `.division`; optional arguments are `options: []` and `layoutDirectionBehavior: .mirrors`. Returned `frame` includes margins. Check `isActive` when manually handling a region. The physical toolbar edge is hardware-relative; do not infer it by reversing leading/trailing for RTL.

Runtime `#available(iOS 27.1, *)` does not make unknown SDK declarations compile under Xcode 26.6. A newer SDK adoption or a deliberate compile-time abstraction is required for those symbols. Do not pick a compiler-version threshold without verifying the CI compiler/SDK pairing.

Direct API sources: [ReservedRegion](https://developer.apple.com/documentation/swiftui/reservedregion), [GeometryProxy query](https://developer.apple.com/documentation/swiftui/geometryproxy/reservedregions(kind:options:layoutdirectionbehavior:)), [vertical toolbar edge](https://developer.apple.com/documentation/swiftui/environmentvalues/toolbarverticaledge), [ArrangementView](https://developer.apple.com/documentation/swiftui/arrangementview).

## Available Duo runtime and validation plan

XcodeBuildMCP `list_sims` verified an available **iPhone Duo**, state **Shutdown** at the research checkpoint, runtime **iOS 27.2.iPhone19.4**. Traditional iPhone 18 Pro and iPad simulators are also installed. No simulator was booted or altered by this research.

Use Device Hub to inspect closed portrait/landscape, fully open portrait/landscape, partial book/laptop poses, and inner-display Split View. For each, test sheets/popovers, keyboard editing, toolbar overflow, camera/hinge avoidance, and state retention while resizing. Add Dynamic Type, VoiceOver, RTL, Reduce Motion/Transparency, and dark/light appearance checks. Record actual safeAreaInsets in each hosting container before changing UIKit/WebKit inset behavior.

Limits: the supplied images establish the visible collision/clutter, but do not provide actual point sizes, view frames, or safe-area values. No hard-coded rail/hinge measurements can be justified from them. Physical-device runtime behavior remains unverified here.
