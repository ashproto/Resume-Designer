/**
 * Diff View — thin bridge to the React <DiffDialog /> (src/components/DiffDialog.jsx).
 *
 * The diff UI was rebuilt on genuine shadcn primitives as an always-mounted React
 * dialog (§5.9). This module keeps the original public API so every entry point
 * — Chat "Review Changes", Jobs "Tailor Resume", History "Compare", and the
 * inline-changes "Full Review" banner — works unchanged: it just dispatches the
 * `rd:open-diff` window event that DiffDialog listens for.
 *
 * diffEngine.js (the pure diff computation) is untouched and still produces the
 * change sets passed through here.
 */

// The boot-time apply callback (main.js calls initDiffView(handleChatApply)).
// Stored module-side and forwarded on every open event so DiffDialog can invoke
// it after each applied change, exactly as the vanilla onApplyCallback did.
let onApplyCallback = null;

/**
 * Register the callback fired after a change is applied to the store.
 * @param {Function} onApply
 */
export function initDiffView(onApply) {
  onApplyCallback = onApply || null;
}

/**
 * Open the diff review dialog for a change set.
 * @param {Object} changeSet - Change set from diffEngine (has .changes + getSummary()).
 */
export function showDiffView(changeSet) {
  window.dispatchEvent(
    new CustomEvent('rd:open-diff', { detail: { changeSet, onApply: onApplyCallback } }),
  );
}

/**
 * Request that the diff dialog close.
 */
export function closeDiffView() {
  window.dispatchEvent(new CustomEvent('rd:close-diff'));
}
