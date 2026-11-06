# Local implementation validation

Validation date: November 5, 2026 Pacific. All runtime data was synthetic. Final native source SHA-256: `366c123bd610713532eab245e060e1a3a9a0df638065eda46c5c3d919ecabf69`.

The local build package contains the development IPA, ARM64 simulator app, detailed QA report, manifests, signatures and screenshots. These local artifacts are intentionally excluded from this public repository; this document is the public validation summary. The report identifies the build used for each proof; later changes were narrowly scoped presentation, contrast and Arrange-mode fixes, with targeted regression checks.

## Automated and build checks

- Final-source shared suite: **2,437 tests passed across 155 files**. The handoff includes the actual test log.
- Production frontend build passed. Frontend inputs did not change during subsequent native UI fixes.
- ESLint: zero errors, two existing warnings in DeleteVariantThreadsDialog.jsx and useChat.js. Changed JavaScript/tests also passed focused lint.
- Swift parser, production selection/presentation helper harness, Swift decoder contracts and git diff check passed.
- Independent editor, native chrome and integration source reviews passed. Concrete runtime findings below were corrected and retested.
- Actual Xcode 27.2 / iOS SDK 27.2 simulator compilation, development device archive and IPA export passed. Packages are ARM64, minimum iOS 26, with the existing iPhone/iPad identity and signing setup.
- Full read-only code-signature verification passed for the final IPA, archive app and simulator app. ZIP integrity, product-input hashes and artifact checksums passed.
- At the November 5 validation checkpoint, all 343 product/build input hashes matched the source used for that local package. The later TestFlight infrastructure bootstrap changes build inputs and is validated separately. Original maintained Xcode project and Info.plist hashes match their pre-build baseline. No dependency, provisioning, Git or publishing changes were made.

## Runtime coverage

| Area | Actual result |
|---|---|
| Duo outer display | Native vertical toolbar actions visible; usable WebKit bounds exclude the system rail exactly once. |
| Compact iPhone | Outline → focused section navigation; one Done; whole editor dismisses, including from Typography and Header & Contact. Final source was reinstalled and checked. |
| Wide iPad | Outline and editable detail visible together. The page-sized editor measured1210×802pt in a 1210×834pt window, with a 300pt outline. |
| Resize continuity | Selected Summary and real typed text survived landscape → portrait on iPad. |
| Native text input | Real Duo software-keyboard input persisted after editor dismissal/reopening. Real iPhone type_text input was verified in the store/DOM. An earlier AX setValue operation that changed display only is explicitly excluded. |
| Legacy identity | First formatting edit materialized section:@4; a second edit targeted the same new key. Typography remained open, with both styles saved. Same-section content CSS remained unchanged. |
| Arrange | Final source retains selection, allows opening another section, exposes native item handles, and a real Move down action changes item order and outline preview. Finish arranging removes handles and retains normal editable detail. |
| Selected rows | Selected icon, preview, group chevron and Arrange handle use semantic native foreground; actual wide selection was checked for readability. |
| Zoom | Native Fit to width produced a 367.2px page in a 402px viewport with 16px padding. Manual 100% remained unchanged after rotation to a 750×246px viewport. Shared tests additionally cover native usable-width refit and manual zoom preservation. |
| Review/Apply | Actual native Review opened Before/After. Actual Apply all updated the real Summary, pending count 1→0, same variant retained. The guarded fixture used a synthetic native projection and real shared pending session; no provider/key/consent or persisted chat-history change. Normal projection was restored. |
| PDF/share | Real export pipeline produced a current PDF preview; actual native Save opened the system share sheet. Dismissed without choosing a destination or transmitting a file. |

## Measured Duo outer geometry

Direct UIKit/LLDB and WebKit measurements, rather than screenshot estimates. Both runs used a 466×678pt window with an 84pt right safe area and 34pt bottom safe area. The measured canvas implementation was unchanged by later editor-only fixes.

| Measurement | Before | Updated app |
|---|---:|---:|
| WKWebView width | 466pt | 382pt |
| WKWebView height | 678pt | 562pt |
| Origin in window | 0,0 | 0,82pt |
| WKWebView safe insets | top82/right84/bottom34pt | zero |
| Scroll content / adjusted insets | zero | zero |

WebKit also reported zero CSS safe-area insets and 16px scroller padding on every side. Native owns the hardware and bar reservations; web content does not subtract them again.

## Findings corrected during runtime testing

1. Done was missing at split/stack boundaries. Each editor destination now owns its completion controls and closes the originating editor sheet.
2. Legacy ID materialization popped nested Typography. Command identity is now separate from retained presentation identity; synchronous snapshot resolution keeps the source link mounted.
3. The default 580pt form sheet prevented wide columns. Native page sizing now gives the compositional editor enough space.
4. Selected icons/previews blended into the blue highlight. Semantic primary foreground now follows native selection styling.
5. Global native edit mode cleared outline selection and disabled navigation. Native item editing now belongs to the detail stack; the outline stays navigable while its custom section handles are enabled.

## Validation limits

- Actual Duo Open/fold behavior is **unverified**. Attempts produced black inner and outer captures; fresh inventory showed one foreground-active466pt key app window. Cause remains unresolved. Normal wide iPad validation is separate and must not be presented as Duo-fold validation.
- Physical-device runtime, live CloudKit synchronization and live AI-provider behavior were not tested. Development CloudKit/APNs entitlement checks are packaging evidence only.
- Only Xcode 27.2 is installed. Xcode 26.6 compatibility has API/source review support but no local compile result. Older-supported-OS runtime was not exercised.
- Dark appearance, large Dynamic Type, VoiceOver, RTL, Increase Contrast, Reduce Transparency and the full orientation/partial-fold matrix were not exercised. Native semantic styles and gesture alternatives are implemented; this is not a formal accessibility certification.
- Parent-group heading versus child-section isolation, contact-row operations, undo and stale-data guards have shared-test/source coverage; not every operation received a new native gesture smoke test. The runtime CSS isolation proof covers a section heading versus its own content. Native pinch behavior was preserved and reviewed, without a new pinch gesture test.
