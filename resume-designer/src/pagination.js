/**
 * On-screen pagination: turn the just-rendered résumé into true page "sheets".
 *
 * The PURE core is assignBlocksToPages() — fully unit-tested. The DOM glue
 * (paginate + adapters, added in later tasks) MEASURES the rendered blocks and
 * MOVES the existing nodes into page-height sheets; it is verified in the
 * desktop app / browser preview, not under jsdom (which has no layout engine).
 */

import { pageDimsIn } from './pageSetup.js';
import { getZoom } from './zoomControls.js';

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

// --- measurement (getBoundingClientRect is VISUAL px; divide by the zoom scale
// on .resume-container to recover layout px) ---

function computedV(el, prop) {
  const v = parseFloat(getComputedStyle(el)[prop]);
  return Number.isFinite(v) ? v : 0;
}
// Vertical padding of a content wrapper (column/body), applied on every sheet.
function vPadding(el) {
  return computedV(el, 'paddingTop') + computedV(el, 'paddingBottom');
}
// Outer height incl. vertical margins (for the header / lead band).
function rectOuterH(el, scale) {
  return el.getBoundingClientRect().height / scale + computedV(el, 'marginTop') + computedV(el, 'marginBottom');
}

// --- flow units: break long sections (experience/education) between their items
// so pages fill tightly. The section heading rides with its first item so it
// never orphans; every other child is one whole-block unit. ---
function splittableInfo(el) {
  if (!el.classList) return null;
  if (el.classList.contains('experience-section')) {
    // Timeline nests items in .timeline-container as .timeline-item; the other
    // layouts render .experience-item directly under the section.
    if (el.querySelector(':scope > .timeline-container')) {
      return { itemSel: ':scope > .timeline-item', itemWrap: '.timeline-container' };
    }
    return { itemSel: ':scope > .experience-item', itemWrap: null };
  }
  if (el.classList.contains('education-section')) return { itemSel: ':scope > p', itemWrap: '.education-content' };
  return null;
}
function flowUnits(containerEl) {
  const leaves = [];
  for (const child of Array.from(containerEl.children)) {
    const info = splittableInfo(child);
    if (!info) { leaves.push({ node: child, section: null }); continue; }
    const itemsParent = info.itemWrap ? child.querySelector(`:scope > ${info.itemWrap}`) : child;
    const items = itemsParent ? Array.from(itemsParent.querySelectorAll(info.itemSel)) : [];
    if (!items.length) { leaves.push({ node: child, section: null }); continue; }
    const heading = child.querySelector(':scope > .section-title');
    items.forEach((item, i) => {
      leaves.push({ node: item, section: child, info, heading: i === 0 ? heading : null, first: i === 0 });
    });
  }
  return leaves;
}
// The first item of a section is measured from the SECTION top, so its slot
// includes the heading + the section's top padding.
function leafTopEl(l) { return (l.first && l.section) ? l.section : l.node; }
function measureLeaves(leaves, scale) {
  const tops = leaves.map((l) => leafTopEl(l).getBoundingClientRect().top);
  const out = [];
  for (let i = 0; i < leaves.length; i++) {
    out.push(i < leaves.length - 1
      ? (tops[i + 1] - tops[i]) / scale
      : (leaves[i].node.getBoundingClientRect().bottom - tops[i]) / scale);
  }
  return out;
}
// Rebuild a column/body from the leaves assigned to one page. Consecutive items
// of the same section are regrouped under a cloned section wrapper; the heading
// appears only on the page where the section begins.
function buildColumn(targetEl, leaves) {
  let curSection = null;
  let itemsParent = null;
  for (const l of leaves) {
    if (!l.section) { targetEl.appendChild(l.node); curSection = null; continue; }
    if (l.section !== curSection) {
      curSection = l.section;
      const sectionClone = l.section.cloneNode(false);
      if (l.heading) sectionClone.appendChild(l.heading);
      if (l.info && l.info.itemWrap) {
        const wrap = l.section.querySelector(`:scope > ${l.info.itemWrap}`).cloneNode(false);
        sectionClone.appendChild(wrap);
        itemsParent = wrap;
      } else {
        itemsParent = sectionClone;
      }
      targetEl.appendChild(sectionClone);
    }
    itemsParent.appendChild(l.node);
  }
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

// Remove the paginated state from the long-lived containers — used when the
// preview falls back to the non-paginated empty state (no résumé loaded).
export function resetPaginatedState(resumeEl) {
  if (!resumeEl) return;
  resumeEl.classList.remove('is-paginated');
  resumeEl.style.width = '';
  resumeEl.closest('.resume-container')?.classList.remove('is-paginated');
}

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
  const scale = getZoom() || 1;

  // Enter paginated state (idempotent; persists across re-renders on the
  // long-lived #resume / #resume-container elements).
  resumeEl.classList.add('is-paginated');
  const container = resumeEl.closest('.resume-container');
  if (container) container.classList.add('is-paginated');
  resumeEl.style.width = `${widthPx}px`;

  if (heightPx == null) { paginateContinuous(resumeEl, widthPx); return; }
  if (cfg.family === 'single') paginateSingle(resumeEl, cfg, widthPx, heightPx, scale);
  else paginateTwo(resumeEl, cfg, widthPx, heightPx, scale);
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

function paginateSingle(resumeEl, cfg, widthPx, heightPx, scale) {
  const header = resumeEl.querySelector(`:scope > .resume-header`);
  const body = resumeEl.querySelector(`:scope > ${cfg.body}`);
  if (!body) { paginateContinuous(resumeEl, widthPx); return; }

  const leaves = flowUnits(body);
  if (!leaves.length) { paginateContinuous(resumeEl, widthPx); return; }
  const heights = measureLeaves(leaves, scale);
  const headerH = header ? rectOuterH(header, scale) : 0;
  const pad = vPadding(body);
  const pageContentPx = Math.max(1, heightPx - pad);
  const firstPageContentPx = Math.max(1, pageContentPx - headerH);
  const assign = assignBlocksToPages(heights, { firstPageContentPx, pageContentPx });
  const numPages = Math.max(1, (assign[assign.length - 1] ?? 0) + 1);

  const pages = makePagesContainer();
  for (let p = 0; p < numPages; p++) {
    const page = makeSheet(widthPx, heightPx);
    if (p === 0 && header) page.appendChild(header);
    const bodyClone = body.cloneNode(false); // shallow: keep classes, drop children
    grow(bodyClone);
    buildColumn(bodyClone, leaves.filter((_, i) => assign[i] === p));
    page.appendChild(bodyClone);
    pages.appendChild(page);
  }
  resumeEl.replaceChildren(pages);
}

// Two-column: paginate the sidebar and main columns INDEPENDENTLY, then build
// per-page grids. Cloning the grid + each column (shallow) preserves grid-template,
// CSS `order`, and the sidebar background (which fills each sheet). The full-width
// header and any lead band (executive summary) sit on sheet 1 only.
function paginateTwo(resumeEl, cfg, widthPx, heightPx, scale) {
  const header = resumeEl.querySelector(':scope > .resume-header');
  const bodyWrap = cfg.bodyWrap ? resumeEl.querySelector(`:scope > ${cfg.bodyWrap}`) : null;
  const gridHost = bodyWrap || resumeEl;
  const grid = gridHost.querySelector(`:scope > ${cfg.grid}`);
  if (!grid) { paginateContinuous(resumeEl, widthPx); return; }

  const leadEls = cfg.lead && bodyWrap ? Array.from(bodyWrap.querySelectorAll(`:scope > ${cfg.lead}`)) : [];
  const colEls = cfg.cols.map((sel) => grid.querySelector(`:scope > ${sel}`)).filter(Boolean);
  if (colEls.length < 2) { paginateContinuous(resumeEl, widthPx); return; }

  const headerH = header ? rectOuterH(header, scale) : 0;
  const leadH = leadEls.reduce((s, el) => s + rectOuterH(el, scale), 0);

  const cols = colEls.map((col) => {
    const leaves = flowUnits(col);
    const heights = measureLeaves(leaves, scale);
    const pageContentPx = Math.max(1, heightPx - vPadding(col));
    const firstPageContentPx = Math.max(1, pageContentPx - headerH - leadH);
    const assign = assignBlocksToPages(heights, { firstPageContentPx, pageContentPx });
    return { col, leaves, assign };
  });
  const numPages = Math.max(1, ...cols.map(({ assign }) => (assign[assign.length - 1] ?? 0) + 1));

  const pages = makePagesContainer();
  for (let p = 0; p < numPages; p++) {
    const page = makeSheet(widthPx, heightPx);
    if (p === 0 && header) page.appendChild(header);

    // Rebuild the body-wrapper chain (compact/executive) so its CSS + lead apply.
    let mount = page;
    if (bodyWrap) {
      const bw = bodyWrap.cloneNode(false);
      bw.style.display = 'flex';
      bw.style.flexDirection = 'column';
      grow(bw);
      if (p === 0) leadEls.forEach((el) => bw.appendChild(el));
      page.appendChild(bw);
      mount = bw;
    }

    const gridClone = grid.cloneNode(false); // keep grid-template + classes
    grow(gridClone);
    cols.forEach(({ col, leaves, assign }) => {
      const colClone = col.cloneNode(false); // keep column classes (sidebar bg, order)
      buildColumn(colClone, leaves.filter((_, i) => assign[i] === p));
      gridClone.appendChild(colClone);
    });
    mount.appendChild(gridClone);
    pages.appendChild(page);
  }
  resumeEl.replaceChildren(pages);
}
