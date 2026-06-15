/**
 * Job description panel bridge.
 *
 * The Target Job Descriptions panel is now a React component
 * (src/components/jobs/JobsDialog.jsx) that listens for the `rd:*-jobs` /
 * `rd:jobs-*` window events dispatched here. This thin module preserves the
 * original ES exports so the still-vanilla callers keep working unchanged:
 *
 *   - Header.jsx / main.js → window.openJobDescriptionPanel() (wired in main.js)
 *   - main.js              → onJobPanelVariantChange() (on resume/variant switch)
 *
 * (initJobDescriptionPanel is gone — the always-mounted dialog inits the data
 * layer itself.)
 */

// Open the Target Job Descriptions panel.
export function openJobDescriptionPanel() {
  window.dispatchEvent(new CustomEvent('rd:open-jobs'));
}

// Reload per-variant analysis when the active resume variant changes.
export function onJobPanelVariantChange() {
  window.dispatchEvent(new CustomEvent('rd:jobs-variant-change'));
}
