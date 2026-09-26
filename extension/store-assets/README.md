# Chrome Web Store listing assets

Upload the PNG files as separate listing assets. The SVG files are the standalone vector originals; all text is outlined and no external fonts or images are needed.

| File | Size | Notes |
| --- | --- | --- |
| `listing-icon-128.png` | 128 × 128 px | RGBA PNG. Approved coral mark occupies 96 × 96 px, centered with 16 px of transparent padding on every side. Its two internal voids remain transparent. |
| `promotional-tile-440x280.png` | 440 × 280 px | Opaque RGB PNG. Paper background; approved mark and wordmark; short product message and desktop-app requirement. |
| `listing-icon-128.svg` | 128 × 128 viewBox | Editable vector source for the listing icon. |
| `promotional-tile-440x280.svg` | 440 × 280 viewBox | Editable vector source for the small promotional tile. |

The tile says **On Paper Companion**, **Review. Fill. Stay in control.**, and **Requires On Paper desktop app.** It is a promotional composition, not an application screenshot.

## Sources

- Mark geometry: `../../docs/brand/logo/mark-coral.svg`. The original even-odd path is preserved exactly and only scaled/positioned.
- Wordmark: `../../docs/brand/logo/lockup-horizontal.svg`, using its existing Geist Semibold outlines.
- Other copy: macOS Helvetica Neue / Helvetica Neue Medium system-sans outlines generated with CoreText. The SVGs and PNGs do not depend on these fonts being installed.
- Palette: Paper `#F4EFE6`, Ink `#0C0A08`, Coral `#E8503A`, and muted ink `#62594E`, from `../../docs/brand/on-paper-brand-guide.md`.
- PNG renderer: `sharp` (libvips/librsvg), from the available workspace runtime. PNG dimensions, RGB/RGBA modes, and the listing icon’s alpha bounding box were checked after rendering.

This directory is outside the Vite entry points and store-package allowlist. These listing assets are not bundled into the extension ZIP. Packaged extension icons were not changed. Keep the SVG/PNG pairs together if revising the listing; preserve the approved mark geometry and listing-icon padding.
