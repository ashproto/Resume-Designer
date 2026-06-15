import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flatToModel } from '../src/migrateToModel.js';

const model = flatToModel({
  name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
  summary: 'S.', sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust'] }],
  experience: [], education: [], tools: 'Figma', pageSize: 'a4',
});

vi.mock('../src/store.js', () => ({ store: { getModel: () => model } }));
vi.mock('../src/persistence.js', () => ({ getSettings: () => ({ colorPalette: 'ocean', customColor: '#000', layout: 'sidebar' }) }));
vi.mock('../src/fontService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getCurrentFontSettings: () => ({ pairingId: 'modern-clean' }) };
});
vi.mock('../src/spacingService.js', () => ({ getSpacingSettings: () => ({}) }));
vi.mock('../src/accentService.js', () => ({ getAccentSettings: () => ({}) }));

describe('typstExport.generateTyp', () => {
  let generateTyp;
  beforeEach(async () => { ({ generateTyp } = await import('../src/typstExport.js')); });
  it('builds .typ from the model + settings, honoring pageSize and layout', () => {
    const typ = generateTyp();
    expect(typ).toContain('#set page(paper: "a4"');
    expect(typ).toContain('font: "Inter"');   // modern-clean body font
    expect(typ).toContain('#grid(');          // sidebar layout
  });
});
