import { describe, it, expect } from 'vitest';
import { buildTheme } from '../src/typst/theme.js';
import { getSelectedFontFamilies } from '../src/fontService.js';

describe('buildTheme font overrides', () => {
  it('uses explicit fontDisplay/fontBody over the pairing', () => {
    const t = buildTheme({ pairingId: 'classic-elegant', fontDisplay: 'Montserrat', fontBody: 'Bitter' });
    expect(t.fontDisplay).toBe('Montserrat');
    expect(t.fontBody).toBe('Bitter');
  });
  it('falls back to the pairing when no overrides', () => {
    const t = buildTheme({ pairingId: 'classic-elegant' });
    expect(t.fontDisplay).toBe('Cormorant Garamond');
    expect(t.fontBody).toBe('DM Sans');
  });
});

describe('buildTheme', () => {
  it('resolves the default pairing + palette', () => {
    const t = buildTheme({});
    expect(t.fontDisplay).toBe('Cormorant Garamond');
    expect(t.fontBody).toBe('DM Sans');
    expect(t.accent).toBe('#c45c3e');
    expect(t.textColor).toBe('#2d2a26');
    expect(t.baseSizePt).toBe(9);
    expect(t.nameSizePt).toBeCloseTo(27, 5); // 2.25rem * 12
    expect(t.bulletChar).toBe('•');
    expect(t.marginTopIn).toBe(0.5);
  });
  it('applies fontScale to sizes', () => {
    const t = buildTheme({ spacing: { fontScale: 2 } });
    expect(t.baseSizePt).toBe(18);
    expect(t.nameSizePt).toBeCloseTo(54, 5);
  });
  it('selects a named palette and an alternate pairing', () => {
    const t = buildTheme({ colorPalette: 'ocean', pairingId: 'modern-clean' });
    expect(t.accent).toBe('#2563eb');
    expect(t.fontDisplay).toBe('Inter');
  });
  it('uses customColor as accent when colorPalette is custom', () => {
    const t = buildTheme({ colorPalette: 'custom', customColor: '#123456' });
    expect(t.accent).toBe('#123456');
  });
  it('exposes fontScale for layout size scaling', () => {
    expect(buildTheme({}).fontScale).toBe(1);
    expect(buildTheme({ spacing: { fontScale: 1.5 } }).fontScale).toBe(1.5);
  });
});

import { generatePaletteFromColor } from '../src/typst/palettes.js';

describe('buildTheme custom palette', () => {
  it('derives the full palette from the custom color (not terracotta defaults)', () => {
    const t = buildTheme({ colorPalette: 'custom', customColor: '#3366cc' });
    const p = generatePaletteFromColor('#3366cc');
    expect(t.accent).toBe('#3366cc');
    expect(t.headerBg).toBe(p.headerBg);
    expect(t.sidebarBg).toBe(p.sidebarBg);
    expect(t.headerBgEnd).toBe(p.headerBgEnd);
    // must NOT be terracotta's bundled background
    expect(t.sidebarBg).not.toBe('#f4e8e4');
  });
});

describe('getSelectedFontFamilies', () => {
  it('returns {} for preset mode (buildTheme resolves the pairing)', () => {
    expect(getSelectedFontFamilies({ mode: 'preset', pairingId: 'classic-elegant' })).toEqual({});
  });
  it('returns google-mode family names from the font objects', () => {
    const r = getSelectedFontFamilies({
      mode: 'google', displayFont: { family: 'Montserrat' }, bodyFont: { family: 'Bitter' },
    });
    expect(r).toEqual({ fontDisplay: 'Montserrat', fontBody: 'Bitter' });
  });
  it('resolves system-mode keys to BARE family names, not CSS stacks', () => {
    const r = getSelectedFontFamilies({ mode: 'system', displayFont: 'times', bodyFont: 'georgia' });
    expect(r).toEqual({ fontDisplay: 'Times New Roman', fontBody: 'Georgia' });
    // a quoted multi-font CSS stack here would break the Typst `font: "..."` literal
    expect(r.fontDisplay).not.toContain(',');
    expect(r.fontDisplay).not.toContain('"');
  });
  it('leaves system-ui to the pairing default (undefined)', () => {
    const r = getSelectedFontFamilies({ mode: 'system', displayFont: 'system-ui', bodyFont: 'georgia' });
    expect(r.fontDisplay).toBeUndefined();
    expect(r.fontBody).toBe('Georgia');
  });
});
