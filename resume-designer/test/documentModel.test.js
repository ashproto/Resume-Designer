import { describe, it, expect } from 'vitest';
import { resumeSchema, validateModel, createEmptyModel, SCHEMA_VERSION } from '../src/documentModel.js';

const validDoc = {
  type: 'doc',
  content: [
    { type: 'header', attrs: { name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' } } },
    { type: 'section', attrs: { id: 's1', title: 'Summary', type: 'text', sectionKind: 'summary' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First programmer.' }] }] },
  ],
};

describe('resumeSchema', () => {
  it('accepts a valid résumé document', () => {
    expect(() => validateModel(validDoc)).not.toThrow();
  });
  it('rejects a document whose first node is not a header', () => {
    const bad = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
    expect(() => validateModel(bad)).toThrow();
  });
  it('createEmptyModel() is valid and carries the schema version', () => {
    const empty = createEmptyModel();
    expect(empty.attrs?.schemaVersion ?? SCHEMA_VERSION).toBe(SCHEMA_VERSION);
    expect(() => validateModel(empty)).not.toThrow();
  });
  it('serializes to DOM in model order', async () => {
    const { DOMSerializer } = await import('prosemirror-model');
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><body></body>');
    const doc = resumeSchema.nodeFromJSON({
      type: 'doc', content: [
        { type: 'header', attrs: { name: 'Ada', tagline: '', contact: {} } },
        { type: 'section', attrs: { id: 'a', title: 'Skills', type: 'list', sectionKind: 'custom' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Math' }] }] },
      ],
    });
    const frag = DOMSerializer.fromSchema(resumeSchema)
      .serializeFragment(doc.content, { document: dom.window.document });
    const wrap = dom.window.document.createElement('div');
    wrap.appendChild(frag);
    const text = wrap.textContent.replace(/\s+/g, ' ').trim();
    expect(text.indexOf('Ada')).toBeLessThan(text.indexOf('Math'));
  });
});
