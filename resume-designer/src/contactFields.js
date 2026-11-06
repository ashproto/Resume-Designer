// Resume-local ordering: absent metadata retains each template's original order.
export const CONTACT_FIELDS = {
  location: { label: 'Location', type: 'text' },
  email: { label: 'Email', type: 'email' },
  phone: { label: 'Phone', type: 'tel' },
  portfolio: { label: 'Portfolio URL', type: 'text' },
  instagram: { label: 'Instagram', type: 'text' },
  linkedin: { label: 'LinkedIn', type: 'text' },
  github: { label: 'GitHub', type: 'text' },
  twitter: { label: 'X / Twitter', type: 'text' },
};

export const CONTACT_LAYOUTS = [
  'sidebar', 'stacked', 'stacked-vertical', 'right-sidebar', 'compact',
  'executive', 'classic', 'classic-featured', 'modern', 'timeline', 'creative',
];

const contactLayoutKey = layout => CONTACT_LAYOUTS.includes(layout) ? layout : 'sidebar';

function normalizeContactLayoutRows(contact, rows) {
  const assigned = new Set();
  const normalized = (Array.isArray(rows) ? rows : []).map(row =>
    (Array.isArray(row) ? row : []).filter(field => {
      if (!Object.hasOwn(CONTACT_FIELDS, field) || assigned.has(field)) return false;
      assigned.add(field);
      return true;
    })
  ).filter(row => row.length);
  // Keep assigned empty fields in place. Contacts populated after customization
  // appear in their own row until the user places them with the other fields.
  for (const field of Object.keys(CONTACT_FIELDS)) {
    if (contact?.[field] && !assigned.has(field)) normalized.push([field]);
  }
  return normalized;
}

export function getContactLayout(data, layout) {
  const override = data.contactLayouts?.[contactLayoutKey(layout)];
  if (override?.mode === 'auto') return { mode: 'auto', source: 'layout', rows: [] };
  if (override?.mode === 'custom') {
    return { mode: 'custom', source: 'layout', rows: normalizeContactLayoutRows(data.contact, override.rows) };
  }
  if (Array.isArray(data.contactBreakBefore) && data.contactBreakBefore.length) {
    return { mode: 'custom', source: 'legacy', rows: getContactRows(data.contact, data.contactOrder, data.contactBreakBefore, layout) };
  }
  // Automatic rows come from the actual rendered template, including wrapping.
  return { mode: 'auto', source: 'template', rows: [] };
}

export function setContactLayoutRows(data, layout, rows) {
  return {
    ...data,
    contactLayouts: {
      ...data.contactLayouts,
      [contactLayoutKey(layout)]: { mode: 'custom', rows: normalizeContactLayoutRows(data.contact, rows) },
    },
  };
}

export function resetContactLayout(data, layout) {
  return {
    ...data,
    contactLayouts: { ...data.contactLayouts, [contactLayoutKey(layout)]: { mode: 'auto' } },
  };
}

export function getContactPresentation(data, layout) {
  const contactLayout = getContactLayout(data, layout);
  if (contactLayout.source !== 'layout') return data;
  if (contactLayout.mode === 'auto') return { ...data, contactOrder: undefined, contactBreakBefore: undefined };
  return {
    ...data,
    contactOrder: contactLayout.rows.flat(),
    // The first row also carries a break marker so one custom row takes the
    // explicit-row renderer path, even in templates with vertical defaults.
    contactBreakBefore: contactLayout.rows.map((row, index) => index === 0 ? row[0] : row.find(field => data.contact?.[field]) || row[0]),
  };
}

export function getContactOrder(order, layout = 'sidebar') {
  const defaults = layout === 'creative' ? ['email', 'phone', 'location', 'portfolio']
    : layout === 'modern' ? ['email', 'phone', 'portfolio', 'location'] : [];
  return [...new Set([
    ...(Array.isArray(order) ? order.filter(field => Object.hasOwn(CONTACT_FIELDS, field)) : defaults),
    ...Object.keys(CONTACT_FIELDS),
  ])];
}

// Breaks belong to fields, so they follow contact reordering and survive empty
// fields being filled in later. Only populated fields can start a visible row.
export function getContactRows(contact, order, breakBefore, layout) {
  const breaks = new Set(Array.isArray(breakBefore) ? breakBefore : []);
  const rows = [];
  for (const field of getContactOrder(order, layout).filter(field => contact?.[field])) {
    if (!rows.length || breaks.has(field)) rows.push([]);
    rows.at(-1).push(field);
  }
  return rows;
}
