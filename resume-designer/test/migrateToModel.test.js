import { describe, it, expect } from 'vitest';
import { flatToModel, modelToFlat } from '../src/migrateToModel.js';
import { validateModel } from '../src/documentModel.js';
import { EMPTY_RESUME } from '../src/store.js';

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
  it('emits a contentful header (name/tagline/contactList nodes)', () => {
    const header = flatToModel(POPULATED).content[0];
    expect(header.content.map((n) => n.type)).toEqual(['name', 'tagline', 'contactList']);
    expect(header.content[0].content[0].text).toBe('Ada Lovelace');
  });
  it('round-trips contact including empty values', () => {
    const back = modelToFlat(flatToModel(POPULATED));
    expect(back.contact).toEqual(POPULATED.contact); // phone/portfolio/instagram '' preserved
    expect(Object.keys(back.contact)).toEqual(Object.keys(POPULATED.contact)); // order preserved
  });
});

const SPARSE = {
  name: 'X', tagline: '', contact: { location: '', email: '', phone: '', portfolio: '', instagram: '' },
  summary: '', sections: [], experience: [], education: [], tools: '',
};

const EMPHASIS = {
  name: 'A', tagline: 'B', contact: { location: '', email: '', phone: '', portfolio: '', instagram: '' },
  summary: 'Led **growth** and _scaled_ the team — 3×.',
  sections: [
    { id: 'a', title: 'Skills', type: 'list', content: ['C++', 'Rust • WASM'] },
    { id: 'b', title: 'Awards', type: 'list', content: ['Turing Award (1966)'] },
  ],
  experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020–24', bullets: ['Shipped **v2**.', 'Cut costs 40%.'] }],
  education: ['PhD — MIT — 2018', 'BSc — UCL — 2014'],
  tools: 'Figma • VS Code • git',
};

// Exercises: a section with NO `type` key (onboarding shape), a section with
// type:'skills', and the top-level toolsDisplay field — all must round-trip.
const REAL_VARIANT = {
  name: 'B', tagline: '', contact: { location: '', email: '', phone: '', portfolio: '', instagram: '' },
  summary: '',
  sections: [
    { id: 'h', title: 'Highlights', content: ['- Did a thing'] },
    { id: 'sk', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] },
  ],
  experience: [], education: [], tools: 'a • b', toolsDisplay: 'skills',
};

// Exercises the relaxed cardinalities: empty custom-section content + an
// experience item with NO bullets must survive as empty (not `['']`).
const EMPTY_FIELDS = {
  name: 'A', tagline: '', contact: { location: '', email: '', phone: '', portfolio: '', instagram: '' },
  summary: '',
  sections: [{ id: 'x', title: 'Empty Sec', type: 'list', content: [] }],
  experience: [{ id: 'e', title: 'Role', company: 'Co', dates: '', bullets: [] }],
  education: [], tools: '',
};

describe('modelToFlat (lossless round-trip)', () => {
  for (const [label, sample] of [['POPULATED', POPULATED], ['SPARSE', SPARSE], ['EMPTY_RESUME', EMPTY_RESUME], ['EMPHASIS', EMPHASIS], ['EMPTY_FIELDS', EMPTY_FIELDS], ['REAL_VARIANT', REAL_VARIANT]]) {
    it(`round-trips ${label} byte-for-byte`, () => {
      const back = modelToFlat(flatToModel(sample));
      expect(back).toEqual(sample);
    });
  }
});

describe('experienceItem fields', () => {
  it('exposes jobTitle/company/dates as editable child nodes', () => {
    const exp = flatToModel(POPULATED).content
      .find((n) => n.attrs?.sectionKind === 'experience').content
      .find((n) => n.type === 'experienceItem');
    expect(exp.content.map((n) => n.type)).toEqual(['jobTitle', 'company', 'dates', 'bulletList']);
    expect(exp.content[0].content[0].text).toBe('Collaborator');
  });
  it('omits the bulletList node when an experience item has no bullets', () => {
    const exp = flatToModel(EMPTY_FIELDS).content
      .find((n) => n.attrs?.sectionKind === 'experience').content
      .find((n) => n.type === 'experienceItem');
    expect(exp.content.map((n) => n.type)).toEqual(['jobTitle', 'company', 'dates']);
  });
});

import { getVariantModel } from '../src/migrateToModel.js';

describe('getVariantModel', () => {
  it('derives a valid model from a stored variant, defaulting missing fields', () => {
    const variant = { id: 'v1', name: 'CV', data: { name: 'Ada', tagline: '', contact: {} } };
    const model = getVariantModel(variant);
    const header = model.content[0];
    expect(header.type).toBe('header');
    const nameNode = header.content.find((n) => n.type === 'name');
    const nameText = (nameNode?.content ?? []).find((n) => n.type === 'text')?.text ?? '';
    expect(nameText).toBe('Ada');
  });
});

describe('section headings', () => {
  it('stores a section title in an editable heading node, not an attr', () => {
    const skills = flatToModel(POPULATED).content.find((n) => n.attrs?.id === 'sec_1');
    expect(skills.content[0]).toEqual({ type: 'heading', content: [{ type: 'text', text: 'Skills' }] });
    expect(skills.attrs.title).toBeUndefined();
  });
});

describe('education entries', () => {
  it('become educationItem nodes', () => {
    const edu = flatToModel(POPULATED).content.find((n) => n.attrs?.sectionKind === 'education');
    const items = edu.content.filter((n) => n.type === 'educationItem');
    expect(items).toHaveLength(1);
    expect(items[0].content[0].text).toBe('B.A. — Somewhere — 1840');
  });
});

describe('tags in the migration', () => {
  it('emits tools as a tagGroup of tags', () => {
    const tools = flatToModel(POPULATED).content.find((n) => n.attrs?.sectionKind === 'tools');
    const tg = tools.content.find((n) => n.type === 'tagGroup');
    expect(tg).toBeDefined();
    expect(tg.content.map((t) => t.content[0].text)).toEqual(['Difference Engine', 'Slide Rule']);
  });
  it('emits a type:"skills" custom section as a tagGroup', () => {
    const sk = flatToModel(REAL_VARIANT).content.find((n) => n.attrs?.id === 'sk'); // type:'skills'
    const tg = sk.content.find((n) => n.type === 'tagGroup');
    expect(tg).toBeDefined();
    expect(tg.content.map((t) => t.content[0].text)).toEqual(['Rust', 'Go']);
  });
  it('leaves a non-skills custom section as paragraphs', () => {
    const hi = flatToModel(REAL_VARIANT).content.find((n) => n.attrs?.id === 'h'); // no type
    expect(hi.content.some((n) => n.type === 'tagGroup')).toBe(false);
    expect(hi.content.some((n) => n.type === 'paragraph')).toBe(true);
  });
});

describe('marks in the migration', () => {
  it('parses summary emphasis into marks', () => {
    const flat = { ...SPARSE, summary: 'Led **growth** today' };
    const para = flatToModel(flat).content.find((n) => n.attrs?.sectionKind === 'summary')
      .content.find((n) => n.type === 'paragraph');
    const bold = para.content.find((c) => c.marks?.some((m) => m.type === 'bold'));
    expect(bold.text).toBe('growth');
  });
});

describe('experience relevanceRank', () => {
  it('carries _relevanceRank into the experienceItem attr and back', () => {
    const flat = { ...SPARSE, experience: [{ id: 'e1', title: 'Dev', company: 'Co', dates: '2020', bullets: [], _relevanceRank: 2 }] };
    const exp = flatToModel(flat).content.find((n) => n.attrs?.sectionKind === 'experience')
      .content.find((n) => n.type === 'experienceItem');
    expect(exp.attrs.relevanceRank).toBe(2);
    expect(modelToFlat(flatToModel(flat)).experience[0]._relevanceRank).toBe(2);
  });
  it('omits _relevanceRank when absent (round-trip unchanged)', () => {
    const back = modelToFlat(flatToModel(POPULATED)); // POPULATED has no _relevanceRank
    expect('_relevanceRank' in back.experience[0]).toBe(false);
  });
  it('preserves a rank of 0 (the onboarding first-item case)', () => {
    const flat = { ...SPARSE, experience: [{ id: 'e0', title: 'Dev', company: 'Co', dates: '2020', bullets: [], _relevanceRank: 0 }] };
    const back = modelToFlat(flatToModel(flat));
    expect(back.experience[0]._relevanceRank).toBe(0);
  });
});

describe('pageSize in the migration', () => {
  it('defaults pageSize to auto when absent', () => {
    expect(flatToModel(POPULATED).attrs.pageSize).toBe('auto');
  });
  it('carries an explicit pageSize into the doc attr', () => {
    expect(flatToModel({ ...POPULATED, pageSize: 'a4' }).attrs.pageSize).toBe('a4');
  });
  it('round-trips a non-default pageSize losslessly', () => {
    const sample = { ...POPULATED, pageSize: 'letter' };
    expect(modelToFlat(flatToModel(sample))).toEqual(sample);
  });
  it('omits pageSize from flat output when auto (keeps golden samples clean)', () => {
    expect('pageSize' in modelToFlat(flatToModel(POPULATED))).toBe(false);
  });
});

describe('experience startDate/endDate round-trip', () => {
  it('preserves machine-readable dates through flat → model → flat', () => {
    const flat = {
      name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
      experience: [{
        id: 'e1', title: 'Eng', company: 'Acme', dates: 'Jan 2020 – Present',
        startDate: '2020-01', endDate: 'Present', bullets: ['Did X'],
      }],
    };
    const model = flatToModel(flat);
    const back = modelToFlat(model);
    expect(back.experience[0].startDate).toBe('2020-01');
    expect(back.experience[0].endDate).toBe('Present');
  });

  it('omits the date fields when absent (flat shape unchanged for date-less resumes)', () => {
    const flat = {
      name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
      experience: [{ id: 'e1', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['X'] }],
    };
    const back = modelToFlat(flatToModel(flat));
    expect('startDate' in back.experience[0]).toBe(false);
    expect('endDate' in back.experience[0]).toBe(false);
  });
});
