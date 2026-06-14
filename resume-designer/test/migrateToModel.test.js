import { describe, it, expect } from 'vitest';
import { flatToModel, modelToFlat } from '../src/migrateToModel.js';
import { validateModel } from '../src/documentModel.js';

const POPULATED = {
  name: 'Ada Lovelace',
  tagline: 'Analytical Engine Pioneer',
  contact: { location: 'London', email: 'ada@x.com', phone: '', portfolio: '', instagram: '' },
  summary: 'First published algorithm author.',
  sections: [{ id: 'sec_1', title: 'Skills', type: 'list', content: ['Mathematics', 'Algorithm Design'] }],
  experience: [{ id: 'exp_1', title: 'Collaborator', company: 'Analytical Engine', dates: '1842 – 1843', bullets: ['Authored Note G.'] }],
  education: ['B.A. — Somewhere — 1840'],
  tools: 'Difference Engine • Slide Rule',
};

describe('flatToModel', () => {
  it('produces a schema-valid model', () => {
    expect(() => validateModel(flatToModel(POPULATED))).not.toThrow();
  });
  it('puts the header first and sidebar-ish kinds in document order', () => {
    const model = flatToModel(POPULATED);
    expect(model.content[0].type).toBe('header');
    const kinds = model.content.filter((n) => n.type === 'section').map((n) => n.attrs.sectionKind);
    expect(kinds).toContain('summary');
    expect(kinds).toContain('experience');
  });
});
