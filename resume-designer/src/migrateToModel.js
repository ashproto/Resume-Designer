import { SCHEMA_VERSION } from './documentModel.js';
import { parseInlineMarks, serializeInlineMarks } from './inlineMarkdown.js';

const text = (s) => parseInlineMarks(s);
const field = (type, s) => ({ type, content: text(s) });
const para = (s) => ({ type: 'paragraph', content: text(s) });
const heading = (title) => ({ type: 'heading', content: text(title) });
const splitTools = (s) => String(s ?? '').split('•').map((t) => t.trim()).filter(Boolean);
const tagGroup = (items) => ({ type: 'tagGroup', content: items.map((t) => ({ type: 'tag', content: text(t) })) });

const contactList = (contact) => ({
  type: 'contactList',
  content: Object.entries(contact ?? {}).map(([kind, value]) => ({
    type: 'contactItem', attrs: { kind }, content: text(value),
  })),
});
const headerNode = (flat) => ({
  type: 'header',
  content: [field('name', flat.name ?? ''), field('tagline', flat.tagline ?? ''), contactList(flat.contact)],
});

const experienceItemNode = (e) => ({
  type: 'experienceItem',
  attrs: { id: e.id ?? '', relevanceRank: Number.isFinite(e._relevanceRank) ? e._relevanceRank : null },
  content: [
    field('jobTitle', e.title ?? ''),
    field('company', e.company ?? ''),
    field('dates', e.dates ?? ''),
    ...(e.bullets?.length
      ? [{ type: 'bulletList', content: e.bullets.map((b) => ({ type: 'listItem', content: [para(b)] })) }]
      : []),
  ],
});

const section = (sectionKind, title, type, blocks, extra = {}) => ({
  type: 'section',
  attrs: { id: extra.id ?? '', type, sectionKind },
  content: [heading(title), ...blocks],
});

// Flat résumé (store.js EMPTY_RESUME shape) → document model. Order is fixed:
// summary, custom sections (in order), experience, education, tools.
export function flatToModel(flat) {
  const content = [headerNode(flat)];

  if (flat.summary) content.push(section('summary', 'Summary', 'text', [para(flat.summary)]));

  for (const s of flat.sections ?? []) {
    const type = s.type ?? '';
    const blocks = type === 'skills'
      ? [tagGroup(s.content ?? [])]
      : (s.content ?? []).map(para);
    content.push(section('custom', s.title ?? '', type, blocks, { id: s.id }));
  }

  if ((flat.experience ?? []).length) {
    content.push(section('experience', 'Experience', 'experience', flat.experience.map(experienceItemNode)));
  }

  if ((flat.education ?? []).length) {
    content.push(section('education', 'Education', 'list', flat.education.map((e) => field('educationItem', e))));
  }

  if (flat.tools) content.push(section('tools', 'Tools', 'text', [tagGroup(splitTools(flat.tools))]));

  return {
    type: 'doc',
    attrs: {
      schemaVersion: SCHEMA_VERSION,
      docType: 'resume',
      toolsDisplay: flat.toolsDisplay ?? '',
      pageSize: flat.pageSize ?? 'auto',
    },
    content,
  };
}

const textOf = (node) => serializeInlineMarks((node?.content ?? []).filter((c) => c.type === 'text'));
const paragraphsText = (sectionNode) =>
  (sectionNode.content ?? []).filter((n) => n.type === 'paragraph').map(textOf);
const childOfType = (node, type) => (node?.content ?? []).find((n) => n.type === type);
const tagsOf = (node) => {
  const tg = childOfType(node, 'tagGroup');
  return tg ? (tg.content ?? []).filter((n) => n.type === 'tag').map(textOf) : null;
};
const headingTitle = (sectionNode) => textOf(childOfType(sectionNode, 'heading'));
const blocksOfType = (sectionNode, type) => (sectionNode?.content ?? []).filter((n) => n.type === type);
const contactOf = (header) => {
  const list = childOfType(header, 'contactList');
  const contact = {};
  for (const item of list?.content ?? []) contact[item.attrs?.kind ?? ''] = textOf(item);
  return contact;
};

export function modelToFlat(model) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const sections = (model.content ?? []).filter((n) => n.type === 'section');

  const flat = {
    name: textOf(childOfType(header, 'name')),
    tagline: textOf(childOfType(header, 'tagline')),
    contact: contactOf(header),
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
      flat.experience = blocksOfType(s, 'experienceItem').map((it) => {
        const e = {
          id: it.attrs?.id ?? '',
          title: textOf(childOfType(it, 'jobTitle')),
          company: textOf(childOfType(it, 'company')),
          dates: textOf(childOfType(it, 'dates')),
          bullets: ((childOfType(it, 'bulletList')?.content) ?? [])
            .filter((li) => li.type === 'listItem')
            .map((li) => textOf((li.content ?? [])[0])),
        };
        if (Number.isFinite(it.attrs?.relevanceRank)) e._relevanceRank = it.attrs.relevanceRank;
        return e;
      });
    } else if (kind === 'education') {
      flat.education = blocksOfType(s, 'educationItem').map(textOf);
    } else if (kind === 'tools') {
      const tags = tagsOf(s);
      flat.tools = tags ? tags.join(' • ') : (paragraphsText(s)[0] ?? '');
    } else { // 'custom'
      const tags = tagsOf(s);
      const entry = { id: s.attrs?.id ?? '', title: headingTitle(s), content: tags ?? paragraphsText(s) };
      if (s.attrs?.type) entry.type = s.attrs.type; // omit when the empty sentinel
      flat.sections.push(entry);
    }
  }
  if (model.attrs?.toolsDisplay) flat.toolsDisplay = model.attrs.toolsDisplay;
  if (model.attrs?.pageSize && model.attrs.pageSize !== 'auto') flat.pageSize = model.attrs.pageSize;
  return flat;
}

const FLAT_DEFAULTS = {
  name: '', tagline: '', contact: {}, summary: '',
  sections: [], experience: [], education: [], tools: '', pageSize: 'auto',
};

// Compute a document model for a stored variant on demand. Pure; persists nothing.
export function getVariantModel(variant) {
  return flatToModel({ ...FLAT_DEFAULTS, ...(variant?.data ?? {}) });
}
