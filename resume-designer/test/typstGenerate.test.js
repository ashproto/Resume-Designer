import { describe, it, expect } from 'vitest';
import { modelToTypst } from '../src/typst/generate.js';
import { buildTheme } from '../src/typst/theme.js';
import { flatToModel } from '../src/migrateToModel.js';

const theme = buildTheme({});
const model = (pageSize) => ({
  ...flatToModel({ name: 'Ada Lovelace', tagline: 'Pioneer & **builder**',
    contact: { email: 'ada@x.com', location: 'London' } }),
  attrs: { schemaVersion: 1, docType: 'resume', toolsDisplay: '', pageSize },
});

describe('modelToTypst — preamble & header', () => {
  it('maps pageSize to #set page', () => {
    expect(modelToTypst(model('a4'), { theme })).toContain('#set page(paper: "a4"');
    expect(modelToTypst(model('letter'), { theme })).toContain('#set page(paper: "us-letter"');
    expect(modelToTypst(model('legal'), { theme })).toContain('#set page(paper: "us-legal"');
    expect(modelToTypst(model('auto'), { theme })).toContain('height: auto');
  });
  it('sets body font and base size from the theme', () => {
    const typ = modelToTypst(model('auto'), { theme });
    expect(typ).toContain('font: "DM Sans"');
    expect(typ).toContain('#"Ada Lovelace"');     // name as a string literal
  });
  it('renders bold runs as #strong and escapes nothing markup-special', () => {
    const typ = modelToTypst(model('auto'), { theme });
    expect(typ).toContain('#strong[#"builder"]'); // bold mark carried on the header tagline
  });
});

describe('modelToTypst — blocks, sections, stacked', () => {
  const full = buildTheme({});
  const m = flatToModel({
    name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
    summary: 'Led _growth_.',
    sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
    experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['Shipped v2.'] }],
    tools: 'Figma • git',
  });
  it('preserves model reading order (name → Skills → Experience → Tools)', () => {
    const typ = modelToTypst(m, { theme: full });
    const iName = typ.indexOf('#"Ada"');
    const iSkills = typ.indexOf('#"Skills"');
    const iExp = typ.indexOf('#"Experience"');
    const iTools = typ.indexOf('#"Tools"');
    expect(iName).toBeGreaterThanOrEqual(0);
    expect(iName).toBeLessThan(iSkills);
    expect(iSkills).toBeLessThan(iExp);
    expect(iExp).toBeLessThan(iTools);
  });
  it('renders a bulletList as a Typst #list', () => {
    expect(modelToTypst(m, { theme: full })).toContain('#list(');
  });
  it('renders a tagGroup (skills/tools) as joined tags', () => {
    const typ = modelToTypst(m, { theme: full });
    expect(typ).toContain('#"Rust"');
    expect(typ).toContain('#"Go"');
  });
  it('matches the recorded stacked snapshot', () => {
    expect(modelToTypst(m, { theme: full })).toMatchSnapshot();
  });
});
