/**
 * User profile panel bridge.
 *
 * The profile editor is now a React component (src/components/profile/ProfileDialog.jsx)
 * that listens for the `rd:profile-*` window events dispatched here. This thin
 * module preserves the original ES exports so the still-vanilla callers keep
 * working unchanged:
 *
 *   - Header.jsx / onboarding.js → window.openUserProfilePanel() (wired in main.js)
 *   - backupFlow.js              → flushPendingProfileSave()
 *
 * CustomEvent dispatch runs listeners synchronously, so flushPendingProfileSave()
 * still flushes the dialog's pending debounced save *before* it returns — exactly
 * what backupFlow.js relies on right before its delayed reload (the documented
 * autosave-clobbers-import race). The dialog is always mounted, so the listener
 * is present even when the editor is closed (a no-op when nothing is pending).
 */

// Open the profile editor.
export function openUserProfilePanel() {
  window.dispatchEvent(new CustomEvent('rd:open-profile'));
}

// Synchronously flush any pending profile autosave (safe to call anytime).
export function flushPendingProfileSave() {
  window.dispatchEvent(new CustomEvent('rd:profile-flush'));
}
