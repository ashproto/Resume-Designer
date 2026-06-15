/**
 * On-screen pagination: turn the just-rendered résumé into true page "sheets".
 *
 * The PURE core is assignBlocksToPages() — fully unit-tested. The DOM glue
 * (paginate + adapters, added in later tasks) MEASURES the rendered blocks and
 * MOVES the existing nodes into page-height sheets; it is verified in the
 * desktop app / browser preview, not under jsdom (which has no layout engine).
 */

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
