/**
 * menuPortal.js — re-parent floating menus to a body-level layer so their
 * backdrop-filter works in the liquid-glass theme.
 *
 * WHY: in the Tauri glass build the ambient surfaces (.chat-panel,
 * .structure-panel, .header-bar) carry their own `backdrop-filter`. WebKit/
 * WKWebView refuses to blur an element whose backdrop-filter is NESTED inside
 * another backdrop-filter, so a dropdown rendered inside those surfaces never
 * frosts its backdrop — the content behind bleeds through its translucent tint.
 * `position: fixed` alone does NOT escape this (the element is still a DOM
 * descendant of the filtered ancestor). Only DOM RE-PARENTING out to a sibling
 * of the filtered surfaces fixes it. (Precedent: inlineEditor.js already appends
 * its menu to <body> "to escape stacking context".)
 *
 * HOW: register a menu with its trigger. A MutationObserver watches the element
 * whose class toggles the menu open (the trigger's wrapper, or the menu itself).
 * On open we move the menu into #glass-portal (a plain, filter-free, body-level
 * layer), pin it `fixed` at the trigger's rect, and force it visible with inline
 * styles (so we don't depend on the original `.open .menu` descendant selector
 * still matching after the move). On close we strip those inline styles and put
 * the menu back exactly where it came from, so its normal hidden-state CSS and
 * any later full re-render behave as before.
 *
 * Gated on glass mode (`<html data-tauri="true">`, set by the index.html detector
 * for the Tauri shell and the ?translucent preview flag). In a plain browser this
 * is a no-op, so the non-glass code path is completely unchanged.
 */

const PORTAL_ID = 'glass-portal';

// menuEl -> { active, parent, next, observer, repos }
const records = new WeakMap();

function isGlass() {
  return document.documentElement.getAttribute('data-tauri') === 'true';
}

function ensurePortal() {
  let p = document.getElementById(PORTAL_ID);
  if (!p) {
    p = document.createElement('div');
    p.id = PORTAL_ID;
    document.body.appendChild(p);
  }
  return p;
}

/** Pin `menuEl` (fixed) at `triggerEl`'s current viewport rect. */
function place(menuEl, triggerEl, opts) {
  const r = triggerEl.getBoundingClientRect();
  const gap = opts.gap == null ? 4 : opts.gap;
  const s = menuEl.style;
  s.position = 'fixed';
  s.margin = '0';
  if (opts.align === 'right') {
    s.right = Math.round(window.innerWidth - r.right) + 'px';
    s.left = 'auto';
  } else {
    s.left = Math.round(r.left) + 'px';
    s.right = 'auto';
  }
  if (opts.matchWidth) s.minWidth = Math.round(r.width) + 'px';
  if (opts.placement === 'up') {
    // Anchor the menu's BOTTOM to just above the trigger — no height measurement
    // needed, so it works before the menu has laid out.
    s.bottom = Math.round(window.innerHeight - r.top + gap) + 'px';
    s.top = 'auto';
  } else {
    s.top = Math.round(r.bottom + gap) + 'px';
    s.bottom = 'auto';
  }
}

const SHOWN_PROPS = ['opacity', 'visibility', 'pointerEvents', 'transform', 'transition'];
const PLACE_PROPS = ['position', 'left', 'right', 'top', 'bottom', 'margin', 'minWidth'];

function openPortal(menuEl, triggerEl, opts) {
  const rec = records.get(menuEl);
  if (!rec) return;
  if (rec.active) { place(menuEl, triggerEl, opts); return; }
  rec.active = true;
  rec.parent = menuEl.parentNode;
  rec.next = menuEl.nextSibling;
  ensurePortal().appendChild(menuEl);
  menuEl.setAttribute('data-portaled', 'true');
  const s = menuEl.style;
  // Force-visible: the original `.open .menu` descendant rule no longer matches
  // once the menu leaves its wrapper, so drive the shown state inline instead.
  // Animate ONLY opacity while portaled. These menus carry `transition: all`, so
  // without this override the position/left/top jump applied by place() below
  // would animate as a long slide "from far away". Opacity-only keeps a gentle
  // fade while the menu appears pinned at the trigger. (Cleared in closePortal.)
  s.transition = 'opacity var(--transition-fast)';
  s.opacity = '1';
  s.visibility = 'visible';
  s.pointerEvents = 'auto';
  s.transform = 'none';
  place(menuEl, triggerEl, opts);
  rec.repos = () => { if (rec.active && menuEl.isConnected) place(menuEl, triggerEl, opts); };
  window.addEventListener('scroll', rec.repos, true);
  window.addEventListener('resize', rec.repos);
}

function closePortal(menuEl) {
  const rec = records.get(menuEl);
  if (!rec || !rec.active) return;
  rec.active = false;
  if (rec.repos) {
    window.removeEventListener('scroll', rec.repos, true);
    window.removeEventListener('resize', rec.repos);
    rec.repos = null;
  }
  const s = menuEl.style;
  [...SHOWN_PROPS, ...PLACE_PROPS].forEach((p) => { s[p] = ''; });
  menuEl.removeAttribute('data-portaled');
  // Restore to the exact original spot so normal CSS + future re-renders behave.
  if (rec.parent) {
    if (rec.next && rec.next.parentNode === rec.parent) {
      rec.parent.insertBefore(menuEl, rec.next);
    } else {
      rec.parent.appendChild(menuEl);
    }
  }
  rec.parent = null;
  rec.next = null;
}

/**
 * Portal `menuEl` to the glass layer whenever `opts.watch` (default: the menu)
 * gains `opts.activeClass` (default: 'open').
 *
 * @param {HTMLElement} menuEl    the floating menu to re-parent
 * @param {HTMLElement} triggerEl element to position against
 * @param {object} [opts]
 * @param {HTMLElement} [opts.watch]       element whose class toggles open (wrapper or menu)
 * @param {string}      [opts.activeClass] open-state class (default 'open')
 * @param {'down'|'up'} [opts.placement]   default 'down'
 * @param {'left'|'right'} [opts.align]     default 'left'
 * @param {boolean}     [opts.matchWidth]   pin min-width to the trigger width
 * @param {number}      [opts.gap]          px gap from trigger (default 4)
 * @returns {() => void} teardown
 */
export function registerPortalMenu(menuEl, triggerEl, opts = {}) {
  if (!menuEl || !triggerEl || !isGlass()) return () => {};

  // Re-registration safety (menus get rebuilt): drop any prior observer/state.
  const prior = records.get(menuEl);
  if (prior && prior.observer) prior.observer.disconnect();

  const watch = opts.watch || menuEl;
  const activeClass = opts.activeClass || 'open';
  const rec = { active: false, parent: null, next: null, observer: null, repos: null };
  records.set(menuEl, rec);

  const sync = () => {
    if (watch.classList.contains(activeClass)) openPortal(menuEl, triggerEl, opts);
    else closePortal(menuEl);
  };

  rec.observer = new MutationObserver(sync);
  rec.observer.observe(watch, { attributes: true, attributeFilter: ['class'] });
  sync(); // honor an already-open state

  return () => {
    if (rec.observer) rec.observer.disconnect();
    closePortal(menuEl);
  };
}

/** True when the click target is inside the portal layer (a portaled menu). */
export function isInPortal(target) {
  const p = document.getElementById(PORTAL_ID);
  return !!(p && target && p.contains(target));
}

/**
 * Drop any menus still parked in the portal — call at the top of a full
 * re-render that destroys/recreates triggers, so an open menu from the old
 * render doesn't leak as an orphan. No-op when nothing is parked.
 */
export function purgePortal() {
  const p = document.getElementById(PORTAL_ID);
  if (!p) return;
  // Properly close each parked menu — removes the window scroll/resize listeners
  // registered in openPortal, clears its inline styles, and resets its record —
  // instead of just orphaning the DOM nodes (which would leak those listeners).
  Array.from(p.children).forEach((menuEl) => closePortal(menuEl));
  // Drop anything left without a record (defensive).
  while (p.firstChild) p.removeChild(p.firstChild);
}
