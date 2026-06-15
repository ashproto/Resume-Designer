/**
 * On-screen pagination: turn the just-rendered résumé into true page "sheets".
 *
 * The PURE core is assignBlocksToPages() — fully unit-tested. The DOM glue
 * (paginate + adapters, added in later tasks) MEASURES the rendered blocks and
 * MOVES the existing nodes into page-height sheets; it is verified in the
 * desktop app / browser preview, not under jsdom (which has no layout engine).
 */

import { pageDimsIn } from './pageSetup.js';

const PX_PER_IN = 96;

// Layout adapter map. `body` (single) = the wrapper whose direct children are
// blocks. For two-column layouts `grid`/`cols`/`bodyWrap`/`lead` are used.
const LAYOUTS = {
  stacked:            { family: 'single', body: '.stacked-body' },
  'stacked-vertical': { family: 'single', body: '.stacked-vertical-body' },
  classic:            { family: 'single', body: '.classic-body' },
  'classic-featured': { family: 'single', body: '.classic-featured-body' },
  creative:           { family: 'single', body: '.creative-body' },
  sidebar:        { family: 'two', grid: '.resume-body',        cols: ['.resume-sidebar', '.resume-main'] },
  'right-sidebar':{ family: 'two', grid: '.right-sidebar-body', cols: ['.resume-main', '.resume-sidebar'] },
  modern:         { family: 'two', grid: '.modern-body',        cols: ['.modern-sidebar', '.modern-main'] },
  timeline:       { family: 'two', grid: '.timeline-body',      cols: ['.timeline-main', '.timeline-sidebar'] },
  compact:        { family: 'two', bodyWrap: '.compact-body',   grid: '.compact-columns',   cols: ['.compact-main', '.compact-sidebar'] },
  executive:      { family: 'two', bodyWrap: '.executive-body', grid: '.executive-columns', cols: ['.executive-main', '.executive-side'], lead: '.executive-summary' },
};

/**
 * Greedy block-break assignment.
 * @param {number[]} blockHeightsPx - height (incl. inter-block gap) of each block, in order.
 * @param {{firstPageContentPx:number, pageContentPx:number}} budgets - usable content height per page
 *   (page 0 is smaller when a full-width header/lead sits on it).
 * @returns {number[]} page index (0-based) for each block.
 *
 * A block that overflows the current page starts a new page; a block taller than
 * a whole page gets its own page (content allowed to overflow the sheet bottom).
 * A new page is never started while the current page is still empty.
 */
export function assignBlocksToPages(blockHeightsPx, { firstPageContentPx, pageContentPx }) {
  const pages = [];
  let page = 0;
  let used = 0;
  let budget = firstPageContentPx;
  for (const h of blockHeightsPx) {
    if (used > 0 && used + h > budget) {
      page += 1;
      used = 0;
      budget = pageContentPx;
    }
    pages.push(page);
    used += h;
  }
  return pages;
}

// --- measurement (offsetTop/offsetHeight are layout px — unaffected by the zoom
// CSS transform on .resume-container, so no scale math is needed) ---

function computedV(el, prop) {
  const v = parseFloat(getComputedStyle(el)[prop]);
  return Number.isFinite(v) ? v : 0;
}
// Outer box height incl. vertical margins (for the header / lead band).
function blockOuterHeight(el) {
  return el.offsetHeight + computedV(el, 'marginTop') + computedV(el, 'marginBottom');
}
// Vertical padding of a content wrapper (column/body), applied on every sheet.
function vPadding(el) {
  return computedV(el, 'paddingTop') + computedV(el, 'paddingBottom');
}
// Per-block "slot" heights via offsetTop deltas (captures margins AND flex/grid
// gaps); the last block uses its own border-box + bottom margin. Siblings share
// an offsetParent, so the deltas are valid regardless of what it is.
function measureBlocks(blocks) {
  const n = blocks.length;
  if (!n) return [];
  const tops = blocks.map((b) => b.offsetTop);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(i < n - 1 ? tops[i + 1] - tops[i] : blocks[i].offsetHeight + computedV(blocks[i], 'marginBottom'));
  }
  return out;
}

// --- sheet builders ---
function makePagesContainer() {
  const el = document.createElement('div');
  el.className = 'resume-pages';
  return el;
}
function makeSheet(widthPx, heightPx) {
  const page = document.createElement('div');
  page.className = 'resume-page';
  page.style.width = `${widthPx}px`;
  if (heightPx == null) page.classList.add('is-continuous');
  else page.style.height = `${heightPx}px`;
  return page;
}
function grow(el) { el.style.flex = '1 1 auto'; el.style.minHeight = '0'; return el; }

/**
 * Paginate the just-rendered résumé in place.
 * @param {HTMLElement} resumeEl - the #resume element (its children are header + body).
 * @param {{pageSize,orientation,pageWidthIn}} setup - from the store accessors.
 * @param {string} layoutId - the active layout (passed in; not read from the DOM).
 */
export function paginate(resumeEl, setup, layoutId) {
  if (!resumeEl) return;
  const cfg = LAYOUTS[layoutId] || LAYOUTS.sidebar;
  const { widthIn, heightIn } = pageDimsIn(setup);
  const widthPx = Math.round(widthIn * PX_PER_IN);
  const heightPx = heightIn == null ? null : Math.round(heightIn * PX_PER_IN);

  // Enter paginated state (idempotent; persists across re-renders on the
  // long-lived #resume / #resume-container elements).
  resumeEl.classList.add('is-paginated');
  const container = resumeEl.closest('.resume-container');
  if (container) container.classList.add('is-paginated');
  resumeEl.style.width = `${widthPx}px`;

  if (heightPx == null) { paginateContinuous(resumeEl, widthPx); return; }
  if (cfg.family === 'single') paginateSingle(resumeEl, cfg, widthPx, heightPx);
  else paginateTwo(resumeEl, cfg, widthPx, heightPx);
}

// Continuous: one open-height sheet, no splitting. Works for every layout.
function paginateContinuous(resumeEl, widthPx) {
  const kids = Array.from(resumeEl.childNodes);
  const pages = makePagesContainer();
  const page = makeSheet(widthPx, null);
  kids.forEach((k) => page.appendChild(k));
  pages.appendChild(page);
  resumeEl.replaceChildren(pages);
}

function paginateSingle(resumeEl, cfg, widthPx, heightPx) {
  const header = resumeEl.querySelector(`:scope > .resume-header`);
  const body = resumeEl.querySelector(`:scope > ${cfg.body}`);
  if (!body) { paginateContinuous(resumeEl, widthPx); return; }

  const blocks = Array.from(body.children);
  const headerH = header ? blockOuterHeight(header) : 0;
  const pad = vPadding(body);
  const pageContentPx = Math.max(1, heightPx - pad);
  const firstPageContentPx = Math.max(1, pageContentPx - headerH);
  const heights = measureBlocks(blocks);
  const assign = assignBlocksToPages(heights, { firstPageContentPx, pageContentPx });
  const numPages = Math.max(1, (assign[assign.length - 1] ?? 0) + 1);

  const pages = makePagesContainer();
  for (let p = 0; p < numPages; p++) {
    const page = makeSheet(widthPx, heightPx);
    if (p === 0 && header) page.appendChild(header);
    const bodyClone = body.cloneNode(false); // shallow: keep classes, drop children
    blocks.forEach((b, i) => { if (assign[i] === p) bodyClone.appendChild(b); });
    grow(bodyClone);
    page.appendChild(bodyClone);
    pages.appendChild(page);
  }
  resumeEl.replaceChildren(pages);
}

// TEMPORARY stub — the real two-column implementation is a later task.
function paginateTwo(resumeEl, _cfg, widthPx, _heightPx) { paginateContinuous(resumeEl, widthPx); }
