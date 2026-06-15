import { describe, it, expect } from 'vitest';
import { resumeSchema, validateModel, createEmptyModel, SCHEMA_VERSION } from '../src/documentModel.js';

const validDoc = {
  type: 'doc',
  content: [
    { type: 'header', content: [
      { type: 'name', content: [{ type: 'text', text: 'Ada Lovelace' }] },
      { type: 'tagline', content: [{ type: 'text', text: 'Pioneer' }] },
      { type: 'contactList', content: [
        { type: 'contactItem', attrs: { kind: 'email' }, content: [{ type: 'text', text: 'ada@x.com' }] },
      ] },
    ] },
    { type: 'section', attrs: { id: 's1', type: 'text', sectionKind: 'summary' },
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Summary' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'First programmer.' }] },
      ] },
  ],
};

describe('resumeSchema', () => {
  it('accepts a valid résumé document', () => {
    expect(() => validateModel(validDoc)).not.toThrow();
  });
  it('header is contentful — name/tagline/contactList are editable child nodes', () => {
    const header = resumeSchema.nodeFromJSON(validDoc).firstChild;
    expect(header.type.name).toBe('header');
    const childTypes = [];
    header.forEach((child) => childTypes.push(child.type.name));
    expect(childTypes).toEqual(['name', 'tagline', 'contactList']);
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
  it('exposes tagGroup/tag nodes and the underline mark', () => {
    expect(resumeSchema.nodes.tagGroup).toBeDefined();
    expect(resumeSchema.nodes.tag).toBeDefined();
    expect(resumeSchema.marks.underline).toBeDefined();
    const doc = {
      type: 'doc',
      content: [
        { type: 'header', content: [
          { type: 'name', content: [{ type: 'text', text: 'A', marks: [{ type: 'underline' }] }] },
          { type: 'tagline', content: [] },
          { type: 'contactList', content: [] },
        ] },
        { type: 'section', attrs: { id: 's', type: 'list', sectionKind: 'skills' }, content: [
          { type: 'heading', content: [{ type: 'text', text: 'Skills' }] },
          { type: 'tagGroup', content: [
            { type: 'tag', content: [{ type: 'text', text: 'Rust' }] },
            { type: 'tag', content: [{ type: 'text', text: 'Go' }] },
          ] },
        ] },
      ],
    };
    expect(() => validateModel(doc)).not.toThrow();
  });
  it('doc carries a pageSize attr defaulting to auto', () => {
    expect(resumeSchema.nodeFromJSON(validDoc).attrs.pageSize).toBe('auto');
  });
  it('createEmptyModel carries pageSize auto', () => {
    expect(createEmptyModel().attrs.pageSize).toBe('auto');
  });
  it('preserves an explicit pageSize through the schema', () => {
    const doc = { ...validDoc, attrs: { pageSize: 'a4' } };
    expect(resumeSchema.nodeFromJSON(doc).attrs.pageSize).toBe('a4');
  });
  it('serializes to DOM in model order', async () => {
    const { DOMSerializer } = await import('prosemirror-model');
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><body></body>');
    const doc = resumeSchema.nodeFromJSON({
      type: 'doc', content: [
        { type: 'header', content: [
          { type: 'name', content: [{ type: 'text', text: 'Ada' }] },
          { type: 'tagline', content: [] },
          { type: 'contactList', content: [] },
        ] },
        { type: 'section', attrs: { id: 'a', type: 'list', sectionKind: 'custom' },
          content: [
            { type: 'heading', content: [{ type: 'text', text: 'Skills' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Math' }] },
          ] },
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
