/**
 * Native window dragging for the custom (overlay) titlebar.
 *
 * Tauri v2's declarative `data-tauri-drag-region` attribute is unreliable on
 * WKWebView/WebView2 (tauri-apps/tauri#9901 — it can fail to register, or
 * swallow clicks on child controls), so we use the pattern the official v2
 * docs recommend: a synchronous mousedown handler that calls
 * `window.startDragging()`.
 *
 * WHY THE HANDLER MUST STAY SYNCHRONOUS:
 *   AppKit only hands the drag off to the window server if startDragging()
 *   fires on the SAME event-loop tick as the mousedown. Any `await` before the
 *   call (e.g. dynamically importing the Tauri window API inside the handler)
 *   pushes startDragging() to a later microtask and the drag silently no-ops.
 *   We therefore resolve getCurrentWindow() ONCE during init and cache the
 *   window object, so the handler itself never awaits.
 *
 * Capabilities required (capabilities/default.json):
 *   - core:window:allow-start-dragging   (drag)
 *   - core:window:allow-toggle-maximize  (double-click to zoom)
 */

import { isTauri } from './native.js';

// A mousedown whose target is (or sits inside) one of these keeps its own
// click behavior and is ignored by the drag handler — otherwise pressing a
// header button would start a window drag instead of activating the control.
const INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="switch"]',
  '[contenteditable="true"]',
  '[data-no-drag]',
  '.custom-dropdown',
].join(', ');

// Resolved once at init so the mousedown handler can call into it synchronously.
let cachedWindow = null;

function handleDragMouseDown(e) {
  // Primary (left) button only — never hijack right/middle or modifier clicks.
  if (e.button !== 0) return;
  // Window not resolved yet (mousedown in the first moments of startup): bail.
  if (!cachedWindow) return;

  const target = e.target;
  if (target && typeof target.closest === 'function' && target.closest(INTERACTIVE_SELECTOR)) {
    return; // click landed on a control inside the titlebar
  }

  // Fire-and-forget: dispatch is synchronous (what AppKit needs); the returned
  // promise only reports completion, so a rejection is swallowed.
  if (e.detail === 2) {
    void cachedWindow.toggleMaximize().catch(() => {}); // native double-click-to-zoom
  } else {
    void cachedWindow.startDragging().catch(() => {});
  }
}

/**
 * Wire native window dragging onto a handle element (the header bar).
 * No-op outside Tauri, so it is safe to call unconditionally from init().
 *
 * @param {HTMLElement|null} handleEl element that should act as the titlebar
 */
export async function initWindowDrag(handleEl) {
  if (!isTauri || !handleEl) return;

  try {
    // Dynamic import keeps `@tauri-apps/api/window` out of the browser (web)
    // bundle path, matching native.js's lazy-load pattern.
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    cachedWindow = getCurrentWindow();
  } catch (err) {
    console.warn('[window-drag] could not resolve current window:', err);
    return;
  }

  // Attach only AFTER the window is cached, so the handler is fully synchronous.
  handleEl.addEventListener('mousedown', handleDragMouseDown);
}
