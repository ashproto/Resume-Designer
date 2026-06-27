/**
 * Page-setup model: the single source of truth for page dimensions, shared by
 * the on-screen paginator (sheet sizes) and the print/PDF export. Pure; no DOM.
 *
 * The inch dimensions below are the standard paper sizes; the on-screen sheets
 * and the printed PDF both derive from them (1in = 96px on screen) so screen
 * and PDF agree on size — the same HTML renders both.
 */

export const PAGE_SIZES = ['continuous', 'letter', 'a4', 'legal', 'tabloid'];
export const ORIENTATIONS = ['portrait', 'landscape'];
export const DEFAULT_PAGE_WIDTH_IN = 8.5;

// Portrait dimensions (inches). Landscape swaps width/height.
export const PAGE_DIMS_IN = {
  letter:  { widthIn: 8.5,  heightIn: 11 },
  a4:      { widthIn: 8.27, heightIn: 11.69 },
  legal:   { widthIn: 8.5,  heightIn: 14 },
  tabloid: { widthIn: 11,   heightIn: 17 },
};

// Legacy 'auto' (and undefined/unknown) → 'continuous'.
export function normalizePageSize(size) {
  return PAGE_SIZES.includes(size) ? size : 'continuous';
}

/**
 * Resolve a page-setup selection to concrete dimensions.
 * @returns {{ widthIn: number, heightIn: number|null }} — heightIn null = continuous (open height).
 */
export function pageDimsIn({ pageSize, orientation = 'portrait', pageWidthIn = DEFAULT_PAGE_WIDTH_IN } = {}) {
  const size = normalizePageSize(pageSize);
  if (size === 'continuous') {
    return { widthIn: Number.isFinite(pageWidthIn) ? pageWidthIn : DEFAULT_PAGE_WIDTH_IN, heightIn: null };
  }
  const { widthIn, heightIn } = PAGE_DIMS_IN[size];
  return orientation === 'landscape'
    ? { widthIn: heightIn, heightIn: widthIn }
    : { widthIn, heightIn };
}
