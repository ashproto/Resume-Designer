/**
 * Typst Theme Bridge
 * Maps global design service choices (font pairing, color palette, spacing, accent)
 * into absolute Typst tokens (pt / in / hex). Service-reading wiring lands in PR 3.4.
 */

import { COLOR_PALETTES } from './palettes.js';
import { FONT_PAIRINGS } from '../fontService.js';

// 1rem = 16px at browser default; 16px × 0.75 = 12pt at 96dpi.
// Confirmed: no :root or html font-size override in styles/ — browser default (16px) applies.
const REM_PT = 12;

const DEFAULT_PAIRING = 'classic-elegant';

function resolvePalette(colorPalette = 'terracotta', customColor = '#c45c3e') {
  if (colorPalette === 'custom') {
    return { ...COLOR_PALETTES.terracotta, accent: customColor, accentLight: customColor };
  }
  return COLOR_PALETTES[colorPalette] ?? COLOR_PALETTES.terracotta;
}

// Bullet chars sourced directly from accentService.js BULLET_STYLES[key].char
const BULLET_CHARS = {
  disc:    '•',
  square:  '▪',
  dash:    '–',
  arrow:   '→',
  check:   '✓',
  star:    '★',
  diamond: '◆',
  none:    '',
};

/**
 * Build a flat token object consumed by the Typst template generator.
 *
 * @param {object} choices - Design service selections:
 *   pairingId      {string}  - Key into FONT_PAIRINGS (default: 'classic-elegant')
 *   colorPalette   {string}  - Key into COLOR_PALETTES, or 'custom' (default: 'terracotta')
 *   customColor    {string}  - Hex string used when colorPalette === 'custom'
 *   spacing        {object}  - { fontScale, pageMargins, sectionSpacing, sidebarWidth, lineHeight }
 *   accent         {object}  - { bulletStyle }
 * @returns {object} Flat token map with pt / in / hex values
 */
export function buildTheme({
  pairingId,
  fontDisplay,
  fontBody,
  colorPalette,
  customColor,
  spacing = {},
  accent = {},
} = {}) {
  const pairing = FONT_PAIRINGS[pairingId] ?? FONT_PAIRINGS[DEFAULT_PAIRING];
  const palette = resolvePalette(colorPalette, customColor);
  const fontScale = spacing.fontScale ?? 1;
  const m = spacing.pageMargins ?? {};

  const pt    = (cssPt) => cssPt * fontScale;
  const remPt = (rem)   => rem * REM_PT * fontScale;

  return {
    // Scale factor (exposed for layout size scaling)
    fontScale,

    // Typography
    fontDisplay:    fontDisplay ?? pairing.display.family,
    fontBody:       fontBody    ?? pairing.body.family,
    baseSizePt:     pt(9),
    nameSizePt:     remPt(2.25),
    taglineSizePt:  remPt(0.95),
    lineHeight:     spacing.lineHeight ?? 1.45,

    // Colors
    textColor:    '#2d2a26',
    mutedColor:   '#6b6560',
    borderColor:  '#e8e4df',
    accent:       palette.accent,
    accentLight:  palette.accentLight,
    headerBg:     palette.headerBg,
    headerBgEnd:  palette.headerBgEnd,
    sidebarBg:    palette.sidebarBg,

    // Page margins (inches)
    marginTopIn:    m.top    ?? 0.5,
    marginBottomIn: m.bottom ?? 0.5,
    marginLeftIn:   m.left   ?? 0.5,
    marginRightIn:  m.right  ?? 0.5,

    // Layout
    sectionGapPt:   remPt(spacing.sectionSpacing ?? 0.8),
    sidebarWidthIn: spacing.sidebarWidth ?? 2.4,

    // Decoration
    bulletChar: BULLET_CHARS[accent.bulletStyle] ?? '•',
  };
}
