import { SCHEMA_VERSION } from './documentModel.js';

const para = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const section = (sectionKind, title, type, content, extra = {}) =>
  ({ type: 'section', attrs: { id: extra.id ?? '', title, type, sectionKind }, content });

// Flat résumé (store.js EMPTY_RESUME shape) → document model. Order is fixed:
// summary, custom sections (in order), experience, education, tools.
export function flatToModel(flat) {
  const content = [{
    type: 'header',
    attrs: { name: flat.name ?? '', tagline: flat.tagline ?? '', contact: flat.contact ?? {} },
  }];

  if (flat.summary) content.push(section('summary', 'Summary', 'text', [para(flat.summary)]));

  for (const s of flat.sections ?? []) {
    content.push(section('custom', s.title ?? '', s.type ?? 'list', (s.content ?? []).map(para), { id: s.id }));
  }

  if ((flat.experience ?? []).length) {
    content.push(section('experience', 'Experience', 'experience', flat.experience.map((e) => ({
      type: 'experienceItem',
      attrs: { id: e.id ?? '', title: e.title ?? '', company: e.company ?? '', dates: e.dates ?? '' },
      content: e.bullets?.length ? [{ type: 'bulletList', content: e.bullets.map((b) => ({ type: 'listItem', content: [para(b)] })) }] : [],
    }))));
  }

  if ((flat.education ?? []).length) {
    content.push(section('education', 'Education', 'list', flat.education.map(para)));
  }

  if (flat.tools) content.push(section('tools', 'Tools', 'text', [para(flat.tools)]));

  return { type: 'doc', attrs: { schemaVersion: SCHEMA_VERSION }, content };
}

export function modelToFlat() { throw new Error('not implemented yet'); }
