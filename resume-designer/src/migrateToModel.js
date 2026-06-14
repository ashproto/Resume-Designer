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

const textOf = (node) =>
  (node?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
const paragraphsText = (sectionNode) =>
  (sectionNode.content ?? []).filter((n) => n.type === 'paragraph').map(textOf);

export function modelToFlat(model) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const sections = (model.content ?? []).filter((n) => n.type === 'section');

  const flat = {
    name: header?.attrs?.name ?? '',
    tagline: header?.attrs?.tagline ?? '',
    contact: header?.attrs?.contact ?? {},
    summary: '',
    sections: [],
    experience: [],
    education: [],
    tools: '',
  };

  for (const s of sections) {
    const kind = s.attrs?.sectionKind;
    if (kind === 'summary') {
      flat.summary = paragraphsText(s)[0] ?? '';
    } else if (kind === 'experience') {
      flat.experience = (s.content ?? []).filter((n) => n.type === 'experienceItem').map((it) => ({
        id: it.attrs?.id ?? '',
        title: it.attrs?.title ?? '',
        company: it.attrs?.company ?? '',
        dates: it.attrs?.dates ?? '',
        bullets: (((it.content ?? [])[0]?.content) ?? [])
          .filter((li) => li.type === 'listItem')
          .map((li) => textOf((li.content ?? [])[0])),
      }));
    } else if (kind === 'education') {
      flat.education = paragraphsText(s);
    } else if (kind === 'tools') {
      flat.tools = paragraphsText(s)[0] ?? '';
    } else { // 'custom'
      flat.sections.push({
        id: s.attrs?.id ?? '',
        title: s.attrs?.title ?? '',
        type: s.attrs?.type ?? 'list',
        content: paragraphsText(s),
      });
    }
  }
  return flat;
}
