/**
 * Settings bridge.
 *
 * The Settings panel is now a React component (src/components/SettingsDialog.jsx).
 * This module is the thin shim that lets the still-vanilla callers open it:
 *   - the header gear (headerBar.js) calls openSettings() directly;
 *   - the chat-panel gear (#chat-settings-btn) is wired below.
 * Both dispatch a window event the React dialog listens for. The dialog reads
 * and writes every setting through the same owner modules (persistence.js,
 * theme.js, native.js, tokenTrackingService.js), so the backup bus and
 * SETTINGS_UPDATED flows are unchanged.
 */

/** Open the Settings dialog, optionally to a tab (general|api-keys|updates|data|usage). */
export function openSettings(tab) {
  window.dispatchEvent(new CustomEvent('rd:open-settings', { detail: { tab: tab || 'general' } }));
}

/** Wire the chat-panel gear to open Settings on the AI tab. (The header gear is
 *  wired in headerBar.js, which imports openSettings directly.) */
export function initSettingsModal() {
  document
    .getElementById('chat-settings-btn')
    ?.addEventListener('click', () => openSettings('api-keys'));
}

/** Retained no-op: main.js calls this from the SETTINGS_UPDATED_EVENT handler.
 *  The React dialog reads settings reactively, so nothing needs reloading. */
export function loadApiKeysToModal() {}
