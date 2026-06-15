import { describe, it, expect } from 'vitest';
import { COLOR_PALETTES } from '../src/typst/palettes.js';

describe('COLOR_PALETTES', () => {
  it('exports all 12 named palettes', () => {
    expect(Object.keys(COLOR_PALETTES)).toHaveLength(12);
    expect(Object.keys(COLOR_PALETTES)).toContain('terracotta');
    expect(Object.keys(COLOR_PALETTES)).toContain('zinc');
  });
  it('each palette has the full 5-key shape', () => {
    expect(COLOR_PALETTES.terracotta).toEqual({
      accent: '#c45c3e', accentLight: '#d97a5d',
      headerBg: '#2d2a26', headerBgEnd: '#3d3832', sidebarBg: '#f4e8e4',
    });
    expect(COLOR_PALETTES.ocean.accent).toBe('#2563eb');
  });
});
