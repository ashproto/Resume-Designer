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

export function getContactOrder(order, layout = 'sidebar') {
  const defaults = layout === 'creative' ? ['email', 'phone', 'location', 'portfolio']
    : layout === 'modern' ? ['email', 'phone', 'portfolio', 'location'] : [];
  return [...new Set([
    ...(Array.isArray(order) ? order.filter(field => Object.hasOwn(CONTACT_FIELDS, field)) : defaults),
    ...Object.keys(CONTACT_FIELDS),
  ])];
}
