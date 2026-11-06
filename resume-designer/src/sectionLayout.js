// Presentation references only. Résumé content stays at its original paths so
// inline editing, AI changes, native editors, backups and undo keep working.
export const STANDARD_SECTIONS = { summary: 'Summary', experience: 'Experience', education: 'Education', tools: 'Tools' };

export function sectionKey(section, index, sections = []) {
  const duplicate = section.id && sections.slice(0, index).some(entry => entry.id === section.id);
  return `section:${(!duplicate && section.id) || `@${index}`}`;
}

export function sectionForKey(data, key) {
  const index = (data.sections || []).findIndex((section, i) => sectionKey(section, i, data.sections) === key);
  return index < 0 ? null : { section: data.sections[index], index };
}

export function sectionNodeTitle(data, node) {
  return node.title ?? sectionForKey(data, node.key)?.section.title ?? STANDARD_SECTIONS[node.key] ?? 'Section group';
}

export function clampSectionScale(value) {
  return Number.isFinite(value) ? Math.min(2, Math.max(0.5, value)) : 1;
}

/** Shared by the desktop and native section editors; content stays canonical. */
export function updateSectionNodeStyle(node, field, value) {
  if (!/^(title|content)(Scale|Font|Bold|Italic|Underline)$/.test(field)) return;
  if (value === undefined) delete node[field];
  else if (field.endsWith('Scale') && Number.isFinite(value)) node[field] = clampSectionScale(value);
  else if (field.endsWith('Font') && ['display', 'body'].includes(value)) node[field] = value;
  else if (/(Bold|Italic|Underline)$/.test(field) && typeof value === 'boolean') node[field] = value;
}

function hasContent(data, key) {
  const value = data[key];
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0;
}

function cleanNode(node) {
  const out = { ...node };
  for (const field of ['titleScale', 'contentScale']) {
    if (node[field] !== undefined) out[field] = clampSectionScale(node[field]);
  }
  for (const field of ['titleFont', 'contentFont']) {
    if (!['display', 'body'].includes(out[field])) delete out[field];
  }
  for (const part of ['title', 'content']) {
    for (const style of ['Bold', 'Italic', 'Underline']) {
      const field = `${part}${style}`;
      if (typeof out[field] !== 'boolean') delete out[field];
    }
  }
  return out;
}

/** Tolerates stale refs and newly added canonical data without losing content. */
export function getSectionLayout(data) {
  const saved = data.sectionLayout;
  const out = { main: [], sidebar: [] };
  const seen = new Set();
  const visit = (nodes, area, inGroup = false) => {
    if (!Array.isArray(nodes)) return [];
    const result = [];
    for (const raw of nodes) {
      if (!raw || typeof raw.key !== 'string' || seen.has(raw.key)) continue;
      const node = cleanNode(raw);
      if (node.key.startsWith('group:')) {
        if (inGroup) continue;
        seen.add(node.key);
        node.children = visit(node.children, area, true);
      } else if (node.key.startsWith('section:')) {
        const match = sectionForKey(data, node.key);
        if (!match || (match.section.area === 'main' ? 'main' : 'sidebar') !== area) continue;
        seen.add(node.key);
      } else if (Object.hasOwn(STANDARD_SECTIONS, node.key)) {
        seen.add(node.key);
      } else continue;
      result.push(node);
    }
    return result;
  };
  for (const area of ['main', 'sidebar']) out[area] = visit(saved?.[area], area);
  for (const key of Object.keys(STANDARD_SECTIONS)) {
    if (!seen.has(key) && (!saved || hasContent(data, key))) {
      out[key === 'tools' ? 'sidebar' : 'main'].push({ key });
    }
  }
  (data.sections || []).forEach((section, index) => {
    const key = sectionKey(section, index, data.sections);
    if (!seen.has(key)) {
      out[section.area === 'main' ? 'main' : 'sidebar'].push({ key });
      seen.add(key);
    }
  });
  // Match the old editor: standard Main cards, then custom sections; Sidebar
  // custom sections, then Tools. No document write occurs merely by opening it.
  if (!saved) out.sidebar.sort((a, b) => Number(a.key === 'tools') - Number(b.key === 'tools'));
  return out;
}

export function findSectionNode(layout, key) {
  for (const area of ['main', 'sidebar']) {
    const nodes = layout[area];
    for (let index = 0; index < nodes.length; index += 1) {
      if (nodes[index].key === key) return { node: nodes[index], nodes, index, area, parent: null };
      const children = nodes[index].children;
      const childIndex = children?.findIndex(child => child.key === key) ?? -1;
      if (childIndex >= 0) return { node: children[childIndex], nodes: children, index: childIndex, area, parent: nodes[index] };
    }
  }
  return null;
}

/** Assign missing IDs only on an explicit structure edit, never on read/load. */
export function editableSectionData(data, makeId) {
  const next = structuredClone(data);
  const replacements = new Map();
  const ids = new Set();
  const previousKeys = (next.sections || []).map((section, index) => sectionKey(section, index, next.sections));
  (next.sections || []).forEach((section, index) => {
    const previous = previousKeys[index];
    if (!section.id || ids.has(section.id)) {
      section.id = makeId('section');
      replacements.set(previous, sectionKey(section, index));
    }
    ids.add(section.id);
  });
  if (next.sectionLayout) {
    const replace = nodes => nodes?.forEach(node => {
      if (replacements.has(node.key)) node.key = replacements.get(node.key);
      if (Array.isArray(node.children)) replace(node.children);
    });
    replace(next.sectionLayout.main);
    replace(next.sectionLayout.sidebar);
  }
  next.sectionLayout = getSectionLayout(next);
  return next;
}

export function relocateSectionNode(data, key, area, parentKey = '') {
  const found = findSectionNode(data.sectionLayout, key);
  if (!found) return;
  const target = parentKey ? findSectionNode(data.sectionLayout, parentKey)?.node.children : data.sectionLayout[area];
  if (!target || target === found.node.children) return;
  found.nodes.splice(found.index, 1);
  target.push(found.node);
  const setArea = node => {
    const match = sectionForKey(data, node.key);
    if (match) match.section.area = area;
    node.children?.forEach(setArea);
  };
  setArea(found.node);
}
