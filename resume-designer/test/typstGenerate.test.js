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
  it('defaults to the stacked layout and falls back for an unknown layout', () => {
    const base = modelToTypst(model('auto'), { theme });
    expect(modelToTypst(model('auto'), { theme, layout: 'stacked' })).toBe(base);
    expect(modelToTypst(model('auto'), { theme, layout: 'nope' })).toBe(base); // unknown → stacked
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

describe('modelToTypst — sidebar', () => {
  const theme2 = buildTheme({});
  const m = flatToModel({
    name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
    summary: 'S.', sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
    experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['v2'] }],
    tools: 'Figma • git',
  });
  it('emits a grid and puts the sidebar (Skills, Tools) before main (Summary, Experience)', () => {
    const typ = modelToTypst(m, { theme: theme2, layout: 'sidebar' });
    expect(typ).toContain('#grid(');
    const iSkills = typ.indexOf('#"Skills"');
    const iTools = typ.indexOf('#"Tools"');
    const iSummary = typ.indexOf('#"Summary"');
    const iExp = typ.indexOf('#"Experience"');
    expect(iSkills).toBeGreaterThanOrEqual(0);
    expect(iSkills).toBeLessThan(iSummary);
    expect(iTools).toBeLessThan(iSummary);
    expect(iSummary).toBeLessThan(iExp);
  });
  it('uses the gradient header fill', () => {
    expect(modelToTypst(m, { theme: theme2, layout: 'sidebar' })).toContain('gradient.linear');
  });
  it('matches the recorded sidebar snapshot', () => {
    expect(modelToTypst(m, { theme: theme2, layout: 'sidebar' })).toMatchSnapshot();
  });
});

describe('modelToTypst — classic', () => {
  const t3 = buildTheme({});
  const m = flatToModel({
    name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
    summary: 'S.', sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust'] }],
    experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['v2'] }],
    education: ['BSc — MIT — 2018'], tools: 'Figma',
  });
  it('uses the Professional Summary/Experience labels and a solid (non-gradient) header', () => {
    const typ = modelToTypst(m, { theme: t3, layout: 'classic' });
    expect(typ).toContain('#"Professional Summary"');
    expect(typ).toContain('#"Professional Experience"');
    expect(typ).not.toContain('gradient.linear');
  });
  it('orders summary → experience → education → custom → tools', () => {
    const typ = modelToTypst(m, { theme: t3, layout: 'classic' });
    const at = (s) => typ.indexOf(s);
    expect(at('#"Professional Summary"')).toBeLessThan(at('#"Professional Experience"'));
    expect(at('#"Professional Experience"')).toBeLessThan(at('#"Education"'));
    expect(at('#"Education"')).toBeLessThan(at('#"Skills"'));
    expect(at('#"Skills"')).toBeLessThan(at('#"Tools"'));
  });
  it('matches the recorded classic snapshot', () => {
    expect(modelToTypst(m, { theme: t3, layout: 'classic' })).toMatchSnapshot();
  });
});

describe('modelToTypst — right-sidebar', () => {
  const t = buildTheme({});
  const m = flatToModel({ name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' }, summary: 'S.',
    sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust'] }],
    experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['v2'] }], tools: 'Figma' });
  it('emits a grid; main (Summary, Experience) precedes sidebar (Skills, Tools) in source order', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'right-sidebar' });
    const at = (s) => typ.indexOf(s);
    expect(typ).toContain('#grid(');
    expect(at('#"Summary"')).toBeGreaterThanOrEqual(0);
    expect(at('#"Summary"')).toBeLessThan(at('#"Skills"'));   // main col before sidebar col (sidebar title is #upper[#"Skills"], so #"Skills" IS in the source)
    expect(at('#"Experience"')).toBeLessThan(at('#"Tools"'));
  });
  it('matches the recorded right-sidebar snapshot', () => {
    expect(modelToTypst(m, { theme: t, layout: 'right-sidebar' })).toMatchSnapshot();
  });
});

describe('modelToTypst — compact', () => {
  const t = buildTheme({});
  const m = flatToModel({
    name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
    summary: 'S.',
    sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust'] }],
    experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['v2'] }],
    education: ['BSc — MIT'],
    tools: 'Figma',
  });
  it('emits a #grid( and main (Summary, Experience) precedes sidebar (Skills) in source order', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'compact' });
    expect(typ).toContain('#grid(');
    const iSummary = typ.indexOf('#"Summary"');
    const iExp = typ.indexOf('#"Experience"');
    const iSkills = typ.indexOf('#"Skills"');
    expect(iSummary).toBeGreaterThanOrEqual(0);
    expect(iExp).toBeGreaterThanOrEqual(0);
    expect(iSkills).toBeGreaterThanOrEqual(0);
    // main-left: main cell emitted first, sidebar cell second
    expect(iSummary).toBeLessThan(iSkills);
    expect(iExp).toBeLessThan(iSkills);
  });
  it('uses scaled-down sizes relative to default theme', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'compact' });
    // Compact preamble should have a smaller base size than the default 9pt
    // Default: 9 * 1 = 9pt; compact scales by 0.88 → 7.92pt (rounds to something < 9pt)
    expect(typ).toContain('#set text(');
    // The compact preamble size should be less than the default 9pt
    const match = typ.match(/#set text\(font: "[^"]+", size: ([\d.]+)pt/);
    expect(match).not.toBeNull();
    expect(parseFloat(match[1])).toBeLessThan(9);
  });
  it('matches the recorded compact snapshot', () => {
    expect(modelToTypst(m, { theme: t, layout: 'compact' })).toMatchSnapshot();
  });
});

describe('modelToTypst — modern', () => {
  const t = buildTheme({});
  const m = flatToModel({
    name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
    summary: 'S.',
    sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust'] }],
    experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['v2'] }],
    education: ['BSc — MIT'],
    tools: 'Figma',
  });
  it('emits a #grid( and sidebar (Skills, Tools, Education) precedes main (Summary, Experience)', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'modern' });
    expect(typ).toContain('#grid(');
    // sidebar titles use renderSidebarSection → #upper[...] so #"Skills" appears in source
    const iSkills = typ.indexOf('#"Skills"');
    const iTools  = typ.indexOf('#"Tools"');
    const iEduc   = typ.indexOf('#"Education"');
    const iSummary = typ.indexOf('#"Summary"');
    const iExp    = typ.indexOf('#"Experience"');
    expect(iSkills).toBeGreaterThanOrEqual(0);
    expect(iTools).toBeGreaterThanOrEqual(0);
    expect(iEduc).toBeGreaterThanOrEqual(0);
    // sidebar content before main content in source order
    expect(iSkills).toBeLessThan(iSummary);
    expect(iTools).toBeLessThan(iSummary);
    expect(iEduc).toBeLessThan(iSummary);
    expect(iSummary).toBeLessThan(iExp);
  });
  it('uses the gradient.linear header', () => {
    expect(modelToTypst(m, { theme: t, layout: 'modern' })).toContain('gradient.linear');
  });
  it('uses 1.8in for the sidebar column width', () => {
    expect(modelToTypst(m, { theme: t, layout: 'modern' })).toContain('1.8in');
  });
  it('matches the recorded modern snapshot', () => {
    expect(modelToTypst(m, { theme: t, layout: 'modern' })).toMatchSnapshot();
  });
});

describe('modelToTypst — executive', () => {
  const t = buildTheme({});
  const m = flatToModel({
    name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
    summary: 'S.',
    sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust'] }],
    experience: [{ id: 'e', title: 'Collaborator', company: 'Acme', dates: '2020', bullets: ['v2'] }],
    education: ['BSc — MIT'],
    tools: 'Figma',
  });

  it('emits a #grid(', () => {
    expect(modelToTypst(m, { theme: t, layout: 'executive' })).toContain('#grid(');
  });

  it('places the summary BEFORE the grid, inside #emph and #align(center)', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'executive' });
    // Summary section contains "S." as text
    const iSummary = typ.indexOf('#"S."');
    const iGrid = typ.indexOf('#grid(');
    expect(iSummary).toBeGreaterThanOrEqual(0);
    expect(iGrid).toBeGreaterThanOrEqual(0);
    expect(iSummary).toBeLessThan(iGrid);
    // The summary block is wrapped in #emph and #align(center)
    expect(typ).toContain('#emph[');
    expect(typ).toContain('#align(center)');
  });

  it('labels experience as "Professional Experience"', () => {
    expect(modelToTypst(m, { theme: t, layout: 'executive' })).toContain('#"Professional Experience"');
  });

  it('uses a gradient (not solid) header', () => {
    expect(modelToTypst(m, { theme: t, layout: 'executive' })).toContain('gradient.linear');
  });

  it('matches the recorded executive snapshot', () => {
    expect(modelToTypst(m, { theme: t, layout: 'executive' })).toMatchSnapshot();
  });
});

describe('modelToTypst — stacked-vertical', () => {
  const t = buildTheme({});
  // Model with BOTH a type:'list' custom (a highlight) AND a type:'skills' custom
  const m = flatToModel({
    name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
    summary: 'S.',
    sections: [
      { id: 'h', title: 'Highlights', type: 'list', content: ['Did X'] },
      { id: 's', title: 'Skills', type: 'skills', content: ['Rust'] },
    ],
    experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['v2'] }],
    education: ['BSc'],
    tools: 'Figma',
  });

  it('orders: Summary → Highlights → Skills → Experience → Education → Tools', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'stacked-vertical' });
    const at = (s) => typ.indexOf(s);
    expect(at('#"Summary"')).toBeGreaterThanOrEqual(0);
    expect(at('#"Highlights"')).toBeGreaterThanOrEqual(0);
    expect(at('#"Skills"')).toBeGreaterThanOrEqual(0);
    expect(at('#"Experience"')).toBeGreaterThanOrEqual(0);
    expect(at('#"Education"')).toBeGreaterThanOrEqual(0);
    expect(at('#"Tools"')).toBeGreaterThanOrEqual(0);
    // Summary is first (after preamble/header)
    expect(at('#"Summary"')).toBeLessThan(at('#"Highlights"'));
    // Highlights (non-skills custom) before Skills custom
    expect(at('#"Highlights"')).toBeLessThan(at('#"Skills"'));
    // Skills before Experience
    expect(at('#"Skills"')).toBeLessThan(at('#"Experience"'));
    // Experience before Education
    expect(at('#"Experience"')).toBeLessThan(at('#"Education"'));
    // Education before Tools
    expect(at('#"Education"')).toBeLessThan(at('#"Tools"'));
  });

  it('renders each section as a boxed card (fill: rgb(")', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'stacked-vertical' });
    expect(typ).toContain('fill: rgb("');
  });

  it('does NOT emit a #line accent rule inside section cards', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'stacked-vertical' });
    expect(typ).not.toContain('#line(length: 100%');
  });

  it('is single-column (no #grid()', () => {
    const typ = modelToTypst(m, { theme: t, layout: 'stacked-vertical' });
    expect(typ).not.toContain('#grid(');
  });

  it('matches the recorded stacked-vertical snapshot', () => {
    expect(modelToTypst(m, { theme: t, layout: 'stacked-vertical' })).toMatchSnapshot();
  });
});
