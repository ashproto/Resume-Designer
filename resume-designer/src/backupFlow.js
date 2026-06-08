/**
 * Full-backup export / import flow.
 *
 * Moved verbatim out of headerBar.js during the React migration (Step 6). The
 * Settings dialog (SettingsDialog.jsx) now calls these directly instead of
 * relying on headerBar's document-level delegated handlers. The race-sensitive
 * flush -> synchronous import -> reload chain is preserved exactly — see the
 * inline comments for why every step is ordered the way it is.
 */

import { exportFullBackup, importFullBackupFromEnvelope } from './persistence.js';
import { store } from './store.js';
import { flushPendingProfileSave } from './userProfilePanel.js';

/**
 * Bridge the visual gap between "user clicked OK on the post-import alert" and
 * "the WebView finishes reloading and painting the new state." Paints a
 * full-viewport "Reloading…" overlay before reload() blocks the renderer, so
 * the user has continuous feedback through the transition. `void offsetHeight`
 * + a 16 ms timeout guarantees the overlay paints BEFORE reload() begins.
 */
function reloadWithOverlay(message = 'Reloading…') {
  const overlay = document.createElement('div');
  overlay.id = 'reload-overlay';
  // Inline styles so the overlay works even if main.css has been partially
  // purged during a teardown — we don't want to depend on class lookups during
  // what's effectively a page-shutdown moment.
  overlay.style.cssText = [
    'position: fixed',
    'inset: 0',
    'z-index: 99999',
    'background: var(--color-bg, #ffffff)',
    'color: var(--color-text, #333333)',
    'font-family: var(--font-body, system-ui, -apple-system, sans-serif)',
    'font-size: 16px',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'flex-direction: column',
    'gap: 12px',
    'opacity: 1',
  ].join(';');

  const spinner = document.createElement('div');
  spinner.style.cssText = [
    'width: 28px',
    'height: 28px',
    'border: 3px solid var(--color-border, #ccc)',
    'border-top-color: var(--color-accent, #c45c3e)',
    'border-radius: 50%',
    'animation: rd-reload-spin 0.7s linear infinite',
  ].join(';');

  const style = document.createElement('style');
  style.textContent =
    '@keyframes rd-reload-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
  document.head.appendChild(style);

  const text = document.createElement('div');
  text.textContent = message;

  overlay.append(spinner, text);
  document.body.appendChild(overlay);

  // Force a synchronous layout + paint so the overlay is on screen before we
  // ask the browser to unload.
  void overlay.offsetHeight;

  // 16 ms ≈ one frame; enough to ensure the overlay paint commits before
  // reload() begins. setTimeout (not rAF) because rAF can be deferred when the
  // page is about to unload.
  setTimeout(() => window.location.reload(), 16);
}

/**
 * DOM-based "Import successful" modal with an OK button. On OK, transitions
 * into reloadWithOverlay() and reloads the app.
 *
 * Why DOM instead of native alert(): tightly coupling alert() with a subsequent
 * location.reload() exposed a dialog state-machine race in WKWebView/WebView2
 * (the alert re-presented itself, then got stuck). A fully DOM-built modal is
 * under our direct control — created, painted, dismissed in one synchronous JS
 * pass — with no dependency on the platform's modal-window manager. Built with
 * createElement (no innerHTML) so the message can never be interpreted as HTML.
 * Reuses the existing .modal-overlay / .modal classes for theming + dark mode.
 */
function showImportSuccessAndReload(message) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'import-success-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = '480px';

  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('h3');
  title.className = 'modal-title';
  title.textContent = 'Import successful';
  header.appendChild(title);

  const content = document.createElement('div');
  content.className = 'modal-content';

  const body = document.createElement('div');
  body.style.whiteSpace = 'pre-wrap';
  body.style.lineHeight = '1.5';
  body.textContent = message;

  const actions = document.createElement('div');
  actions.className = 'form-actions';
  actions.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;';

  const okBtn = document.createElement('button');
  okBtn.className = 'btn btn-primary';
  okBtn.id = 'import-success-ok';
  okBtn.textContent = 'OK';
  actions.appendChild(okBtn);

  content.append(body, actions);
  modal.append(header, content);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add('show'));
  setTimeout(() => okBtn.focus(), 50);

  const proceed = () => {
    overlay.remove();
    document.removeEventListener('keydown', keyHandler);
    reloadWithOverlay('Loading your imported data…');
  };

  const keyHandler = (e) => {
    // Enter OR Escape both proceed — the import has already happened; the only
    // path forward is to reload into the new state.
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      proceed();
    }
  };

  okBtn.addEventListener('click', proceed, { once: true });
  document.addEventListener('keydown', keyHandler);
}

/**
 * Export every owned localStorage key into a single JSON file. No success
 * alert — the browser download bar / native save dialog is feedback enough.
 */
export function exportFullBackupWithFeedback() {
  try {
    const { keysExported, filename } = exportFullBackup();
    console.log(`[backup] Exported ${keysExported} keys to ${filename}`);
  } catch (err) {
    console.error('[backup] Export failed:', err);
    alert(`Export failed: ${err.message ?? String(err)}`);
  }
}

/**
 * Restore every owned localStorage key from a JSON envelope produced by Export
 * Full Backup or the legacy Electron migration. Parses FIRST (so the
 * destructive confirm can show the key count), flushes pending debounced
 * writers, then runs the writes SYNCHRONOUSLY before reload.
 */
export async function importBackupFromFile(file) {
  if (!file) return;
  try {
    // Parse FIRST so we can show the key count BEFORE confirming (avoids the
    // "destructive confirm with unknown payload" anti-pattern). This is also
    // the ONLY parse pass — the already-validated `preview` feeds straight into
    // importFullBackupFromEnvelope below, so there's no second `await
    // file.text()` between the flush and the writes.
    const text = await file.text();
    let preview;
    try {
      preview = JSON.parse(text);
    } catch (_) {
      throw new Error('Selected file is not valid JSON.');
    }
    if (!preview || preview.backupFormat !== 1 || !preview.keys) {
      throw new Error('Not a Resume Designer backup file.');
    }
    const incoming = Object.keys(preview.keys).length;
    const ok = confirm(
      `Restore from backup?\n\n` +
        `This backup contains ${incoming} keys ` +
        `(created ${preview.createdAt || 'unknown date'}).\n\n` +
        `Your current resumes, job descriptions, history, and ` +
        `settings will be REPLACED.\n\n` +
        `The app will reload after import.`
    );
    if (!ok) return;

    // Flush all pending debounced writers (resume store + profile panel) before
    // the destructive restore: reloadWithOverlay yields to the event loop for
    // 16 ms before reload(), and any queued save callback would otherwise fire
    // in that window and overwrite the just-imported data.
    try {
      store.saveNow();
      flushPendingProfileSave();
    } catch (err) {
      console.warn('[backup] pre-import flush failed:', err);
    }

    // SYNCHRONOUS call (not importFullBackup(file), which would do a second
    // file.text() — that await would yield AFTER our flush but BEFORE the
    // writes, reopening the race). importFullBackupFromEnvelope takes the
    // already-parsed preview and runs the writes synchronously, so
    // flush -> writes -> modal -> reload is one uninterrupted chain.
    const result = importFullBackupFromEnvelope(preview);

    let backupNote = '';
    if (result.historySkipped > 0) {
      backupNote =
        `\n\nNote: ${result.historySkipped} undo/redo history ` +
        `${result.historySkipped === 1 ? 'entry was' : 'entries were'} ` +
        `too large to fit in browser storage and ` +
        `${result.historySkipped === 1 ? 'was' : 'were'} skipped. ` +
        `Your resumes themselves are intact.`;
    }
    showImportSuccessAndReload(
      `Restored ${result.keysImported} keys from backup ` +
        `(removed ${result.removedExistingKeys} existing keys).` +
        backupNote
    );
  } catch (err) {
    console.error('[backup] Import failed:', err);
    alert(`Import failed: ${err.message ?? String(err)}`);
  }
}
