import { Schema } from 'prosemirror-model';

// Bump when the model's node/attr shape changes in a way that needs migration.
export const SCHEMA_VERSION = 1;

// Résumé document schema. Reading order = depth-first node order. `header` is an
// atom holding name/tagline/contact in attrs; every résumé area becomes a typed
// `section`. Text (incl. any **markers**) is stored verbatim in text nodes.
export const resumeSchema = new Schema({
  nodes: {
    doc: { content: 'header section*', attrs: { schemaVersion: { default: SCHEMA_VERSION }, toolsDisplay: { default: '' } } },
    header: {
      atom: true,
      attrs: { name: { default: '' }, tagline: { default: '' }, contact: { default: {} } },
      toDOM: (n) => ['header', {}, `${n.attrs.name} ${n.attrs.tagline}`.trim()],
      parseDOM: [{ tag: 'header' }],
    },
    section: {
      attrs: { id: { default: '' }, title: { default: '' }, type: { default: 'text' }, sectionKind: { default: 'custom' } },
      content: 'block*',
      toDOM: (n) => ['section', { 'data-kind': n.attrs.sectionKind, 'data-type': n.attrs.type, 'data-id': n.attrs.id }, 0],
      parseDOM: [{ tag: 'section' }],
    },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    bulletList: { group: 'block', content: 'listItem*', toDOM: () => ['ul', 0], parseDOM: [{ tag: 'ul' }] },
    listItem: { content: 'paragraph', toDOM: () => ['li', 0], parseDOM: [{ tag: 'li' }] },
    experienceItem: {
      group: 'block',
      attrs: { id: { default: '' }, title: { default: '' }, company: { default: '' }, dates: { default: '' } },
      content: 'bulletList?',
      toDOM: (n) => ['div', { class: 'exp', 'data-id': n.attrs.id, 'data-title': n.attrs.title, 'data-company': n.attrs.company, 'data-dates': n.attrs.dates }, 0],
      parseDOM: [{ tag: 'div.exp' }],
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }] },
    italic: { toDOM: () => ['em', 0], parseDOM: [{ tag: 'em' }] },
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
    attrs: { schemaVersion: SCHEMA_VERSION },
    content: [{ type: 'header', attrs: { name: '', tagline: '', contact: {} } }],
  };
}
