# Bundled Font Notices

Most fonts are vendored latin-subset TTFs from google-webfonts-helper
(https://gwfh.mranftl.com) for in-app Typst PDF compilation; two families
required special handling for license/naming reasons, noted per-family below.
All fonts are redistributable under their respective open-source licenses.

## SIL Open Font License 1.1 (OFL-1.1)

Full license text: `OFL.txt` in this directory.

- Cormorant Garamond — Christian Thalmann
- DM Sans — Colophon Foundry. No Reserved Font Name; its name table was normalized
  to "DM Sans" (the gwfh subset ships it as "DM Sans 9pt", an optical-size suffix
  Typst does not strip), a modification the OFL permits for fonts without a reserved
  name — so `font: "DM Sans"` resolves instead of silently falling back.
- Inter — Rasmus Andersson
- Playfair Display — Claus Eggers Sørensen
- Source Sans 3 — Adobe Systems (formerly "Source Sans Pro"; renamed in v3)
- IBM Plex Serif — IBM Corp.
- IBM Plex Sans — IBM Corp.
- Libre Baskerville — Impallari Type
- Karla — Jonathan Pinhorn
- Oswald — Vernon Adams (no italic variant available; regular + 700 only)
- Merriweather — Sorkin Type. Has a Reserved Font Name ("Merriweather"), so it is
  bundled UNMODIFIED as its full upstream variable font (`merriweather.ttf`) from
  github.com/google/fonts — it cannot be subsetted or name-edited without violating
  the OFL reserved-name clause. (Display-only font; the italic file is omitted as
  the generator never renders the display face italic.)
- Raleway — Matt McInerney, Pablo Impallari, Rodrigo Fuenzalida
- Lato — Łukasz Dziedzic
- Lora — Cyreal
- Nunito Sans — Vernon Adams, Cyreal, Jacques Le Bailly. No Reserved Font Name; its
  name table was normalized to "Nunito Sans" (upstream ships it as "Nunito Sans 12pt"),
  a modification the OFL expressly permits for fonts without a reserved name.
- Poppins — Indian Type Foundry, Jonny Pinhorn
- Work Sans — Wei Huang
- Crimson Text — Sebastian Kosch (latin subset via gwfh)
- Source Serif 4 — Adobe Systems (formerly "Source Serif Pro"; renamed in v4; latin subset
  via gwfh; no Reserved Font Name)
- Bitter — Solmatas (latin subset via gwfh). The OFL-1.1 reserves the name "Bitter Pro",
  NOT "Bitter", so a subset embedding "Bitter" as the family name is fully compliant.
  regular + italic + 700; gwfh files embed nameID1 as "Bitter Thin" (variable-font
  artifact) but Typst resolves the "Bitter" family correctly via its weight-suffix
  stripping.)
- Montserrat — Julieta Ulanovsky (latin subset via gwfh; no Reserved Font Name). Same
  variable-font nameID1 artifact as Bitter ("Montserrat Thin"); Typst resolves "Montserrat"
  correctly. regular + italic + 700.
- Rubik — Hubert and Fischer, Meir Sadan (latin subset via gwfh; no Reserved Font Name).
  Same nameID1 artifact ("Rubik Light"); Typst resolves "Rubik" correctly.
  regular + italic + 700.
- Bebas Neue — Ryoichi Tsunekawa / Dharma Type (latin subset via gwfh; no Reserved Font
  Name; regular-only — no italic or bold variant exists for this display font).
- PT Serif — ParaType Ltd. Has Reserved Font Names "PT Sans", "PT Serif", and "ParaType",
  so it is bundled UNMODIFIED as the upstream static TTFs (PT_Serif-Web-Regular.ttf,
  PT_Serif-Web-Bold.ttf, PT_Serif-Web-Italic.ttf) from github.com/google/fonts — they
  cannot be subsetted or name-edited without violating the OFL reserved-name clause.
- Abril Fatface — TypeTogether. Has Reserved Font Names "Abril" and "Abril Fatface", so
  it is bundled UNMODIFIED as the upstream static TTF (AbrilFatface-Regular.ttf) from
  github.com/google/fonts. Regular-only display font.
- Righteous — Brian J. Bonislawsky / Astigmatic. Has Reserved Font Name "Righteous", so
  it is bundled UNMODIFIED as the upstream static TTF (Righteous-Regular.ttf) from
  github.com/google/fonts. Regular-only display font.

## Apache License 2.0

- Roboto — Christian Robertson / Google LLC
  https://www.apache.org/licenses/LICENSE-2.0
- Open Sans — Steve Matteson / Google LLC
  https://www.apache.org/licenses/LICENSE-2.0
