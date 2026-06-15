import { describe, it, expect } from 'vitest';
import { buildTheme } from '../src/typst/theme.js';

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
