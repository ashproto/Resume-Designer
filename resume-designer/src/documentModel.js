import { Schema } from 'prosemirror-model';

// Bump when the model's node/attr shape changes in a way that needs migration.
export const SCHEMA_VERSION = 1;

// Résumé document schema. Reading order = depth-first node order. Every visible
// field is an editable node (no data hidden in atom attrs). Emphasis is stored as
// bold/italic/underline MARKS on text nodes, and skills/tools as tagGroup/tag nodes;
// the flat⇄model migration (migrateToModel.js + inlineMarkdown.js) parses/serializes
// these to/from the flat shape's markdown markers and ' • '-joined strings.
export const resumeSchema = new Schema({
  nodes: {
    doc: {
      content: 'header section*',
      attrs: {
        schemaVersion: { default: SCHEMA_VERSION },
        docType: { default: 'resume' },
        toolsDisplay: { default: '' },
      },
    },
    header: {
      content: 'name tagline contactList',
      toDOM: () => ['header', 0],
      parseDOM: [{ tag: 'header' }],
    },
    name: {
      content: 'text*',
      toDOM: () => ['h1', { class: 'resume-name' }, 0],
      parseDOM: [{ tag: 'h1.resume-name' }],
    },
    tagline: {
      content: 'text*',
      toDOM: () => ['p', { class: 'resume-tagline' }, 0],
      parseDOM: [{ tag: 'p.resume-tagline' }],
    },
    contactList: {
      content: 'contactItem*',
      toDOM: () => ['ul', { class: 'contact-list' }, 0],
      parseDOM: [{ tag: 'ul.contact-list' }],
    },
    contactItem: {
      content: 'text*',
      attrs: { kind: { default: '' } },
      toDOM: (n) => ['li', { class: 'contact-item', 'data-kind': n.attrs.kind }, 0],
      parseDOM: [{ tag: 'li.contact-item', getAttrs: (el) => ({ kind: el.getAttribute('data-kind') || '' }) }],
    },
    section: {
      attrs: { id: { default: '' }, type: { default: 'text' }, sectionKind: { default: 'custom' } },
      content: 'heading block*',
      toDOM: (n) => ['section', { 'data-kind': n.attrs.sectionKind, 'data-type': n.attrs.type, 'data-id': n.attrs.id }, 0],
      parseDOM: [{ tag: 'section', getAttrs: (el) => ({
        id: el.getAttribute('data-id') || '',
        type: el.getAttribute('data-type') || 'text',
        sectionKind: el.getAttribute('data-kind') || 'custom',
      }) }],
    },
    heading: {
      content: 'text*',
      toDOM: () => ['h2', 0],
      parseDOM: [{ tag: 'h2' }],
    },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    bulletList: { group: 'block', content: 'listItem*', toDOM: () => ['ul', 0], parseDOM: [{ tag: 'ul' }] },
    listItem: { content: 'paragraph', toDOM: () => ['li', 0], parseDOM: [{ tag: 'li' }] },
    educationItem: { group: 'block', content: 'text*', toDOM: () => ['div', { class: 'edu-item' }, 0], parseDOM: [{ tag: 'div.edu-item' }] },
    tagGroup: { group: 'block', content: 'tag*', toDOM: () => ['ul', { class: 'tag-group' }, 0], parseDOM: [{ tag: 'ul.tag-group' }] },
    tag: { content: 'text*', toDOM: () => ['li', { class: 'tag' }, 0], parseDOM: [{ tag: 'li.tag' }] },
    experienceItem: {
      group: 'block',
      attrs: { id: { default: '' }, relevanceRank: { default: null } },
      content: 'jobTitle company dates bulletList?',
      toDOM: (n) => ['div', { class: 'exp', 'data-id': n.attrs.id }, 0],
      parseDOM: [{ tag: 'div.exp', getAttrs: (el) => ({ id: el.getAttribute('data-id') || '' }) }],
    },
    jobTitle: { content: 'text*', toDOM: () => ['div', { class: 'exp-title' }, 0], parseDOM: [{ tag: 'div.exp-title' }] },
    company: { content: 'text*', toDOM: () => ['div', { class: 'exp-company' }, 0], parseDOM: [{ tag: 'div.exp-company' }] },
    dates: { content: 'text*', toDOM: () => ['div', { class: 'exp-dates' }, 0], parseDOM: [{ tag: 'div.exp-dates' }] },
    text: { group: 'inline' },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }] },
    italic: { toDOM: () => ['em', 0], parseDOM: [{ tag: 'em' }] },
    underline: { toDOM: () => ['u', 0], parseDOM: [{ tag: 'u' }] },
    link: { attrs: { href: {} }, toDOM: (m) => ['a', { href: m.attrs.href }, 0], parseDOM: [{ tag: 'a[href]', getAttrs: (el) => ({ href: el.getAttribute('href') }) }] },
  },
});

// Throws if `json` is not a valid résumé document for the schema.
export function validateModel(json) {
  const doc = resumeSchema.nodeFromJSON(json); // throws on structural violations
  doc.check();                                  // throws on content-model violations
  return doc;
}

export function createEmptyModel() {
  return {
    type: 'doc',
    attrs: { schemaVersion: SCHEMA_VERSION, docType: 'resume', toolsDisplay: '' },
    content: [{
      type: 'header',
      content: [
        { type: 'name', content: [] },
        { type: 'tagline', content: [] },
        { type: 'contactList', content: [] },
      ],
    }],
  };
}
