/**
 * Header Bar Component
 * Contains variant selector, export menu, and branding
 */

import {
  getVariants,
  getCurrentVariantId,
  setCurrentVariantId,
  saveVariant,
  deleteVariant,
  renameVariant,
  initPersistence,
  importFile,
  exportAsJSON,
  exportAsMarkdown,
  exportFullBackup,
  importFullBackupFromEnvelope,
  importFullBackupMerge,
  generateUniqueVariantName
} from './persistence.js';
import { registerPortalMenu, isInPortal, purgePortal } from './menuPortal.js';
import { store, generateId, EMPTY_RESUME } from './store.js';
import { flushPendingProfileSave } from './userProfilePanel.js';
import {
  isElectron,
  isTauri,
  checkForUpdates,
  onUpdateStatus,
  getUpdateChannel,
  setUpdateChannel,
  probeLegacyElectronData,
  importLegacyElectronData,
} from './native.js';

let currentVariantId = null;
let onVariantChangeCallback = null;
let updateListenersInitialized = false;
let updateToastTimer = null;
let manualUpdateCheckActive = false;

/**
 * Show a custom prompt modal (native prompt doesn't work in Electron)
 * @param {string} message - The prompt message
 * @param {string} defaultValue - Default input value
 * @returns {Promise<string|null>} - The input value or null if cancelled
 */
function showPromptModal(message, defaultValue = '') {
  return new Promise((resolve) => {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'prompt-modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width: 400px;">
        <div class="modal-header">
          <h3 class="modal-title">${message}</h3>
          <button class="modal-close" id="prompt-modal-close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="modal-content">
          <div class="form-group">
            <input type="text" class="input" id="prompt-modal-input" value="${defaultValue.replace(/"/g, '&quot;')}" autofocus>
          </div>
          <div class="form-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
            <button class="btn btn-secondary" id="prompt-modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="prompt-modal-confirm">OK</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Show with animation
    requestAnimationFrame(() => {
      overlay.classList.add('show');
    });
    
    const input = overlay.querySelector('#prompt-modal-input');
    const closeBtn = overlay.querySelector('#prompt-modal-close');
    const cancelBtn = overlay.querySelector('#prompt-modal-cancel');
    const confirmBtn = overlay.querySelector('#prompt-modal-confirm');
    
    // Focus and select input
    setTimeout(() => {
      input.focus();
      input.select();
    }, 100);
    
    const cleanup = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => {
        overlay.remove();
      }, 200);
      resolve(result);
    };
    
    // Event handlers
    closeBtn.addEventListener('click', () => cleanup(null));
    cancelBtn.addEventListener('click', () => cleanup(null));
    confirmBtn.addEventListener('click', () => {
      const value = input.value.trim();
      cleanup(value || null);
    });
    
    // Handle Enter key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = input.value.trim();
        cleanup(value || null);
      } else if (e.key === 'Escape') {
        cleanup(null);
      }
    });
    
    // Click outside to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup(null);
      }
    });
  });
}

/**
 * Three-button modal for the "Import from previous Electron version"
 * flow. Resolves to 'merge', 'replace', or null (cancel).
 *
 * Uses the project's existing .modal-overlay / .modal classes so
 * theming, dark mode, and the print-mode hide rule come for free.
 * Native `confirm()` only supports OK/Cancel, so we hand-roll this
 * to expose all three choices in one dialog rather than chaining
 * confirms.
 *
 * Dynamic values (counts, source path) are injected via textContent
 * placeholders rather than template-string interpolation, so a path
 * that happens to contain `<`/`>` can never become HTML.
 */
function showLegacyImportDialog(probe) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'legacy-import-modal-overlay';
    const variantWord = probe.variantCount === 1 ? 'resume' : 'resumes';
    const jdWord = probe.jobDescriptionCount === 1 ? 'job description' : 'job descriptions';
    // Static HTML skeleton with placeholder ids; populated below via
    // textContent (XSS-safe).
    overlay.innerHTML = `
      <div class="modal" style="max-width: 480px;">
        <div class="modal-header">
          <h3 class="modal-title">Import data from your previous version?</h3>
          <button class="modal-close" id="legacy-import-close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="modal-content">
          <p style="margin-top: 0;">Found data from the old Electron version:</p>
          <ul style="margin: 8px 0 12px 20px; padding: 0;">
            <li><strong id="legacy-import-variant-count"></strong> <span id="legacy-import-variant-word"></span></li>
            <li><strong id="legacy-import-jd-count"></strong> <span id="legacy-import-jd-word"></span></li>
            <li id="legacy-import-profile-line" hidden>Your user profile</li>
          </ul>
          <p style="font-size: 0.85em; color: var(--color-text-muted); margin: 0 0 16px 0; word-break: break-all;">
            Source: <code id="legacy-import-source-path"></code>
          </p>
          <p style="margin: 0 0 8px 0;"><strong>Merge:</strong> Add the old resumes alongside your current ones. Your current resumes, user profile, and settings are preserved.</p>
          <p style="margin: 0 0 16px 0;"><strong>Replace:</strong> Discard your current data and use the old data instead.</p>
          <div class="form-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
            <button class="btn btn-secondary" id="legacy-import-cancel">Cancel</button>
            <button class="btn btn-secondary" id="legacy-import-replace">Replace</button>
            <button class="btn btn-primary" id="legacy-import-merge">Merge</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Inject dynamic values via textContent — never innerHTML — so a
    // hostile path or unexpected count value can't break out into
    // executable markup.
    overlay.querySelector('#legacy-import-variant-count').textContent = String(probe.variantCount);
    overlay.querySelector('#legacy-import-variant-word').textContent = variantWord;
    overlay.querySelector('#legacy-import-jd-count').textContent = String(probe.jobDescriptionCount);
    overlay.querySelector('#legacy-import-jd-word').textContent = jdWord;
    overlay.querySelector('#legacy-import-source-path').textContent = probe.sourcePath ?? 'unknown';
    if (probe.userProfilePresent) {
      overlay.querySelector('#legacy-import-profile-line').hidden = false;
    }

    requestAnimationFrame(() => overlay.classList.add('show'));

    const cleanup = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      document.removeEventListener('keydown', keyHandler);
      resolve(result);
    };
    overlay.querySelector('#legacy-import-close').addEventListener('click', () => cleanup(null));
    overlay.querySelector('#legacy-import-cancel').addEventListener('click', () => cleanup(null));
    overlay.querySelector('#legacy-import-replace').addEventListener('click', () => cleanup('replace'));
    overlay.querySelector('#legacy-import-merge').addEventListener('click', () => cleanup('merge'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(null);
    });
    const keyHandler = (e) => {
      if (e.key === 'Escape') cleanup(null);
    };
    document.addEventListener('keydown', keyHandler);
  });
}

/**
 * Bridge the visual gap between "user clicked OK on the post-import
 * alert" and "the WebView finishes reloading and painting the new
 * state."
 *
 * Native `alert()` is modal but synchronous: as soon as the user
 * dismisses it, JS resumes and `window.location.reload()` runs. The
 * actual reload takes 1-3 seconds though (page unload, fetch, re-init,
 * font load, render of 200+ KB of imported data), and during the
 * unload window the WebView keeps painting the OLD DOM — so the user
 * sees the stale, unchanged page and thinks OK didn't fire. Then the
 * page goes blank, then the app reappears.
 *
 * This helper paints a full-viewport "Reloading…" overlay before the
 * reload kicks in, so the moment OK fires the user has continuous
 * "we're working on it" feedback through the transition. Using
 * `void overlay.offsetHeight` + a 16 ms timeout guarantees the
 * browser paints the overlay BEFORE `reload()` blocks the renderer.
 */
function reloadWithOverlay(message = 'Reloading…') {
  const overlay = document.createElement('div');
  overlay.id = 'reload-overlay';
  // Inline styles so the overlay works even if main.css has been
  // partially purged during a teardown — we don't want to depend on
  // class lookups during what's effectively a page-shutdown moment.
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
    // Important: opacity 1 from the start, no transition — we want
    // INSTANT coverage of the stale DOM, not a fade-in.
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

  // Inject the keyframes once (defensive — the class might already
  // exist on a re-entry, but we don't track it; the duplicate <style>
  // is harmless).
  const style = document.createElement('style');
  style.textContent =
    '@keyframes rd-reload-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
  document.head.appendChild(style);

  const text = document.createElement('div');
  text.textContent = message;

  overlay.append(spinner, text);
  document.body.appendChild(overlay);

  // Force a synchronous layout + paint so the overlay is on screen
  // before we ask the browser to unload.
  void overlay.offsetHeight;

  // 16 ms = roughly one frame; enough to ensure the overlay paint
  // commits before reload() begins. setTimeout (not requestAnimationFrame)
  // because the rAF callback can be deferred when the page is about
  // to unload.
  setTimeout(() => window.location.reload(), 16);
}

/**
 * Show a DOM-based "Import successful" modal with an OK button.
 * On OK, transitions into reloadWithOverlay() and reloads the app.
 *
 * Why this exists instead of native `alert(message); reloadWithOverlay()`:
 * The previous flow used the browser's `alert()`, which on macOS
 * WKWebView (and Windows WebView2) is implemented as a native OS
 * dialog. Tightly coupling alert() with a subsequent
 * `location.reload()` exposed a dialog state-machine race in the
 * webview: the user reported the alert re-presenting itself 2-3
 * times after each OK click, then becoming stuck on screen even
 * though the underlying app was fully functional post-reload.
 * Hypothesis: the NSAlert dismissal animation overlaps with the
 * page-navigation handshake, and the webview re-fires the dialog
 * because the JS context that owned it has already moved on.
 *
 * Switching to a fully DOM-based modal sidesteps the entire native
 * dialog stack. The modal's lifetime is under our direct DOM control
 * — created, painted, dismissed in one synchronous JS pass — and
 * carries no dependency on the platform's modal-window manager.
 *
 * Uses the project's existing .modal-overlay / .modal classes so it
 * picks up theming and dark-mode support automatically.
 */
function showImportSuccessAndReload(message) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'import-success-modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width: 480px;">
      <div class="modal-header">
        <h3 class="modal-title">Import successful</h3>
      </div>
      <div class="modal-content">
        <div id="import-success-body" style="white-space: pre-wrap; line-height: 1.5;"></div>
        <div class="form-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
          <button class="btn btn-primary" id="import-success-ok">OK</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Inject as textContent so any unexpected characters in the message
  // can never become HTML (the message comes from app-controlled
  // strings, but defense-in-depth is cheap here).
  overlay.querySelector('#import-success-body').textContent = message;

  requestAnimationFrame(() => overlay.classList.add('show'));

  const okBtn = overlay.querySelector('#import-success-ok');
  // Auto-focus so Enter dismisses without requiring a mouse click.
  setTimeout(() => okBtn.focus(), 50);

  const proceed = () => {
    // Remove the success modal first; reloadWithOverlay() will paint
    // its own full-viewport overlay over whatever's left, but cleaning
    // up here avoids a brief frame where the modal AND the overlay
    // are both in the DOM.
    overlay.remove();
    document.removeEventListener('keydown', keyHandler);
    reloadWithOverlay('Loading your imported data…');
  };

  const keyHandler = (e) => {
    // Enter OR Escape both proceed — the dialog has no Cancel since
    // the import has already happened; the only path forward is to
    // reload into the new state.
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      proceed();
    }
  };

  // `{ once: true }` so a stray double-click can't fire reload twice.
  okBtn.addEventListener('click', proceed, { once: true });
  document.addEventListener('keydown', keyHandler);
}

/**
 * Tools → Import from previous Electron version… handler.
 *
 * - Probe via Rust. If nothing found, show a friendly alert with the
 *   path we checked so the user can see we actually looked.
 * - If found, show the merge/replace/cancel dialog (above).
 * - On Merge: call importFullBackupMerge — current state wins on
 *   collision, so anything the user has built in the new version is
 *   preserved; old variants get added alongside.
 * - On Replace: call importFullBackupFromEnvelope — destructive,
 *   wipes current owned keys and writes the legacy envelope.
 * - On either success, reload so the in-memory store re-reads from
 *   localStorage and the variant selector reflects the new state.
 */
async function handleImportLegacyElectron() {
  if (!isTauri) {
    alert('Legacy-data import is only available in the desktop app.');
    return;
  }
  let probe;
  try {
    probe = await probeLegacyElectronData();
  } catch (err) {
    console.error('[legacy-import] probe failed:', err);
    alert(`Could not check for legacy data: ${err?.message ?? String(err)}`);
    return;
  }
  if (!probe?.found) {
    const where = probe?.sourcePath
      ? `Looked at: ${probe.sourcePath}`
      : 'No legacy Electron data directory exists at the standard userData path.';
    alert(`No legacy Electron data found.\n\n${where}`);
    return;
  }

  const choice = await showLegacyImportDialog(probe);
  if (!choice) return;

  let envelope;
  try {
    envelope = await importLegacyElectronData();
  } catch (err) {
    console.error('[legacy-import] extract failed:', err);
    alert(`Could not read legacy data: ${err?.message ?? String(err)}`);
    return;
  }

  try {
    // Flush ALL pending debounced writers that target owned localStorage
    // keys, then run the import. Two writers exist today:
    //   1. resume store (src/store.js:415) — 500 ms setTimeout that
    //      writes `data` to localStorage via saveCallback(data).
    //   2. profile panel (src/userProfilePanel.js:654) — 500 ms
    //      setTimeout whose saveUserProfile() re-reads
    //      `resume-designer-data`, splices in `userProfile` from
    //      `profileData`, and writes back.
    //
    // Both bypass the import path entirely. The import writes
    // localStorage directly, and reloadWithOverlay() yields the event
    // loop for ~16 ms so its overlay paint commits before reload. Any
    // save callback whose timer already fired (and is sitting in the
    // macrotask queue) will run during that yield — writing PRE-import
    // state on top of the freshly-imported data and reloading into a
    // corrupted backup. Flushing both writers here closes that race.
    //
    // saveNow() and flushPendingProfileSave() both clearTimeout +
    // synchronously persist — the synchronous-persist matters for the
    // Merge path (current data wins on collision, so unsaved edits
    // need to be in localStorage when the merge runs).
    try {
      store.saveNow();
      flushPendingProfileSave();
    } catch (err) {
      // Don't block the import — worst case the user's last few
      // keystrokes since the last debounced save are lost, but the
      // imported data is what they explicitly asked for.
      console.warn('[legacy-import] pre-import flush failed:', err);
    }

    let summary;
    let skipNote = '';
    if (choice === 'merge') {
      const r = importFullBackupMerge(envelope);
      summary =
        `Merged in ${r.variantsAdded} resumes, ${r.jobDescriptionsAdded} job descriptions, ` +
        `and ${r.settingsKeysAdded} settings keys from your previous version.`;
      if (r.historySkipped > 0) {
        skipNote =
          `\n\nNote: ${r.historySkipped} undo/redo history ` +
          `${r.historySkipped === 1 ? 'entry was' : 'entries were'} too large to fit ` +
          `in browser storage and ${r.historySkipped === 1 ? 'was' : 'were'} skipped. ` +
          `Your resumes themselves are intact.`;
      }
    } else {
      const r = importFullBackupFromEnvelope(envelope);
      summary =
        `Restored ${r.keysImported} keys from your previous version ` +
        `(removed ${r.removedExistingKeys} existing keys).`;
      if (r.historySkipped > 0) {
        skipNote =
          `\n\nNote: ${r.historySkipped} undo/redo history ` +
          `${r.historySkipped === 1 ? 'entry was' : 'entries were'} too large to fit ` +
          `in browser storage and ${r.historySkipped === 1 ? 'was' : 'were'} skipped. ` +
          `Your resumes themselves are intact.`;
      }
    }
    // Custom DOM modal instead of native alert() — see
    // showImportSuccessAndReload's doc-comment for why. The "Reloading…"
    // line is dropped from the message text because the OK click flows
    // directly into the loading overlay, which IS the reload UX.
    showImportSuccessAndReload(`${summary}${skipNote}`);
  } catch (err) {
    console.error('[legacy-import] apply failed:', err);
    alert(`Import failed: ${err?.message ?? String(err)}`);
  }
}

// Initialize header bar
export function initHeaderBar(onVariantChange) {
  onVariantChangeCallback = onVariantChange;
  
  // Get current variant from storage
  currentVariantId = getCurrentVariantId();
  
  // Variant action buttons (new/duplicate/rename/delete) are wired purely via
  // event delegation in setupHeaderEventListeners(). Inline onclick is disabled
  // by Tauri's injected CSP nonce in the packaged app, so there are no window.*
  // fallbacks (and firing both delegation + inline would double-act in a browser).
  
  // Render header UI
  renderHeaderBar();
  
  // Set up event listeners
  setupHeaderEventListeners();
  initUpdateUi();
  
  // Load current variant into store
  if (currentVariantId) {
    loadVariant(currentVariantId);
  }
  
  return currentVariantId;
}

// Get current variant ID
export function getCurrentId() {
  return currentVariantId;
}

// Load a variant into the store
export function loadVariant(id) {
  const variants = getVariants();
  const variant = variants[id];
  
  if (variant) {
    currentVariantId = id;
    setCurrentVariantId(id);
    store.setData(variant.data, true, id); // Skip save since we're loading, pass variantId for history
    initPersistence(id);
    
    if (onVariantChangeCallback) {
      onVariantChangeCallback(variant);
    }
    
    updateVariantSelector();
    return true;
  }
  return false;
}

// Create a new variant
export function createVariant(name, data = null) {
  const id = generateId('variant');
  const variantData = data || JSON.parse(JSON.stringify(EMPTY_RESUME));
  
  saveVariant(id, name, variantData);
  loadVariant(id);
  renderHeaderBar();
  
  return id;
}

// Duplicate current variant
export function duplicateVariant() {
  const variants = getVariants();
  const current = variants[currentVariantId];
  
  if (current) {
    const baseName = `${current.name} (Copy)`;
    const newName = generateUniqueVariantName(baseName, variants);
    const newData = JSON.parse(JSON.stringify(current.data));
    return createVariant(newName, newData);
  }
  return null;
}

// Delete current variant
export function deleteCurrentVariant() {
  const variants = getVariants();
  const variantCount = Object.keys(variants).length;
  
  if (variantCount <= 1) {
    alert('Cannot delete the last variant. Create a new one first.');
    return false;
  }
  
  const current = variants[currentVariantId];
  if (confirm(`Are you sure you want to delete "${current.name}"?`)) {
    const newCurrentId = deleteVariant(currentVariantId);
    if (newCurrentId) {
      loadVariant(newCurrentId);
    }
    renderHeaderBar();
    return true;
  }
  return false;
}

// Rename current variant
export async function renameCurrentVariant() {
  const variants = getVariants();
  const current = variants[currentVariantId];
  
  if (current) {
    const newName = await showPromptModal('Enter new name:', current.name);
    if (newName && newName.trim() !== '') {
      renameVariant(currentVariantId, newName.trim());
      renderHeaderBar();
      return true;
    }
  }
  return false;
}

// Import a variant from file
export async function importVariant(file) {
  try {
    const data = await importFile(file);
    const name = file.name.replace(/\.(json|md|markdown)$/i, '');
    createVariant(name, data);
    return true;
  } catch (err) {
    alert('Import failed: ' + err.message);
    return false;
  }
}

// Export current variant
export function exportCurrentVariant(format = 'json') {
  const variants = getVariants();
  const current = variants[currentVariantId];
  
  if (current) {
    const filename = `${current.name.replace(/[^a-z0-9]/gi, '-')}`;
    if (format === 'json') {
      exportAsJSON(current.data, `${filename}.json`);
    } else {
      exportAsMarkdown(current.data, `${filename}.md`);
    }
  }
}

// Render the header bar
export function renderHeaderBar() {
  const container = document.getElementById('header-bar');
  if (!container) return;
  // A full header re-render destroys menu triggers; clear any menu still parked
  // in the glass portal first so an open one can't leak as an orphan.
  purgePortal();
  
  const variants = getVariants();
  const variantList = Object.values(variants).sort((a, b) => {
    // Sort by most recently modified first
    const dateA = a.updatedAt || a.createdAt || '';
    const dateB = b.updatedAt || b.createdAt || '';
    return dateB.localeCompare(dateA);
  });
  
  const currentVariant = variants[currentVariantId];
  const currentName = currentVariant?.name || 'Select Resume';
  
  container.innerHTML = `
    <div class="header-brand">
      <h1 class="header-title">Resume Designer</h1>
    </div>
    
    <div class="header-variant">
      <div class="custom-dropdown" id="variant-dropdown">
        <button class="custom-dropdown-trigger" type="button">
          <span class="dropdown-label">${escapeHtml(currentName)}</span>
          <svg class="dropdown-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div class="custom-dropdown-menu">
          ${variantList.map(v => `
            <button class="custom-dropdown-option ${v.id === currentVariantId ? 'selected' : ''}" 
                    data-value="${v.id}" type="button">
              <svg class="check-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span class="variant-info">
                <span class="variant-name">${escapeHtml(v.name)}</span>
                ${v.updatedAt ? `<span class="variant-date">${formatDate(v.updatedAt)}</span>` : ''}
              </span>
            </button>
          `).join('')}
        </div>
      </div>
      
      <!-- Individual variant action buttons (visible on wide screens) -->
      <div class="header-variant-actions-expanded">
        <button class="header-action-btn" id="btn-new-variant" title="Create new resume">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
        <button class="header-action-btn" id="btn-duplicate-variant" title="Duplicate">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
        <button class="header-action-btn" id="btn-rename-variant" title="Rename">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
          </svg>
        </button>
        <button class="header-action-btn danger" id="btn-delete-variant" title="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
      
      <!-- Collapsed variant actions dropdown (visible on medium screens) -->
      <div class="header-variant-actions-dropdown">
        <button class="header-variant-actions-btn" id="btn-variant-actions" title="Resume Actions">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="1"/>
            <circle cx="19" cy="12" r="1"/>
            <circle cx="5" cy="12" r="1"/>
          </svg>
        </button>
        <div class="header-variant-actions-menu" id="variant-actions-menu">
          <button class="header-variant-action-option" id="btn-new-variant-menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Resume
          </button>
          <button class="header-variant-action-option" id="btn-duplicate-variant-menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Duplicate
          </button>
          <button class="header-variant-action-option" id="btn-rename-variant-menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
            </svg>
            Rename
          </button>
          <button class="header-variant-action-option danger" id="btn-delete-variant-menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Delete
          </button>
        </div>
      </div>
    </div>
    
    <div class="header-actions">
      <!-- Mobile Menu Button (hidden on desktop) -->
      <button class="header-mobile-menu-btn" id="btn-mobile-menu" title="Menu">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      
      <!-- Desktop Actions (hidden on mobile) -->
      <div class="header-desktop-actions">
        <!-- Tools Dropdown -->
        <div class="header-tools-dropdown">
          <button class="header-tools-btn" id="btn-header-tools" title="Tools">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span class="btn-text">Tools</span>
            <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div class="header-tools-menu" id="header-tools-menu">
            <button class="header-tools-option" id="btn-user-profile">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              User Profile
            </button>
            <button class="header-tools-option" id="btn-job-descriptions">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              Job Descriptions
            </button>
            <button class="header-tools-option" id="btn-history">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              Version History
            </button>
            <button class="header-tools-option" id="btn-export-full-backup" title="Save all resumes, settings, job descriptions, and history to a single JSON file">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export Full Backup
            </button>
            <label class="header-tools-option" id="btn-import-full-backup" title="Restore from a backup JSON (replaces current data)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Import Backup…
              <input type="file" id="header-import-backup-file" accept="application/json,.json" hidden>
            </label>
            ${isTauri ? `
            <button class="header-tools-option" id="btn-import-legacy-electron" title="Bring in resumes and settings from the old Electron version of the app">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9"/>
                <polyline points="3 4 3 12 11 12"/>
              </svg>
              Import from previous Electron version…
            </button>
            ` : ''}
            ${isElectron ? `
            <button class="header-tools-option" id="btn-update-channel" title="Choose which release channel this app updates from. Beta installs pre-release builds from the next branch.">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="6" y1="3" x2="6" y2="15"/>
                <circle cx="18" cy="6" r="3"/>
                <circle cx="6" cy="18" r="3"/>
                <path d="M18 9a9 9 0 0 1-9 9"/>
              </svg>
              Update channel: <span id="update-channel-label">${getUpdateChannel() === 'beta' ? 'Beta' : 'Stable'}</span>
            </button>
            <button class="header-tools-option" id="btn-check-updates">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 2v6h-6"/>
                <path d="M3 12a9 9 0 0 1 15-6l3 2"/>
                <path d="M3 22v-6h6"/>
                <path d="M21 12a9 9 0 0 1-15 6l-3-2"/>
              </svg>
              Check for Updates
            </button>
            ` : ''}
          </div>
        </div>
        
        <label class="header-import-btn" title="Import resume">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <span class="btn-text">Import</span>
          <input type="file" id="header-import-file" accept=".json,.md,.markdown" hidden>
        </label>
        
        <div class="header-export-dropdown">
          <button class="header-export-btn" id="btn-header-export">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span class="btn-text">Export</span>
            <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div class="header-export-menu" id="header-export-menu">
            <button class="header-export-option" data-format="json">Export as JSON</button>
            <button class="header-export-option" data-format="md">Export as Markdown</button>
          </div>
        </div>
      </div>
      
      <div class="theme-toggle-dropdown" id="theme-toggle-dropdown">
        <button class="header-action-btn theme-toggle-btn" id="theme-toggle-btn" title="Toggle theme">
          <svg class="theme-icon theme-icon-light" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
          <svg class="theme-icon theme-icon-dark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
          <svg class="theme-icon theme-icon-system" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </button>
        <div class="theme-toggle-menu" id="theme-toggle-menu">
          <button class="theme-option" data-theme="light">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/>
              <line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
            Light
          </button>
          <button class="theme-option" data-theme="dark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            Dark
          </button>
          <button class="theme-option" data-theme="system">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            System
          </button>
        </div>
      </div>
      
      <button class="btn btn-primary header-pdf-btn" id="header-download-pdf">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        <span class="btn-text">PDF</span>
      </button>
    </div>
    
    <!-- Mobile Menu Drawer -->
    <div class="header-mobile-menu" id="header-mobile-menu">
      <div class="mobile-menu-section">
        <div class="mobile-menu-section-title">Resume</div>
        <button class="mobile-menu-option" id="mobile-new-variant">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Resume
        </button>
        <button class="mobile-menu-option" id="mobile-duplicate-variant">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Duplicate
        </button>
        <button class="mobile-menu-option" id="mobile-rename-variant">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
          </svg>
          Rename
        </button>
        <button class="mobile-menu-option danger" id="mobile-delete-variant">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Delete
        </button>
      </div>
      <div class="mobile-menu-section">
        <div class="mobile-menu-section-title">Tools</div>
        <button class="mobile-menu-option" id="mobile-user-profile">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          User Profile
        </button>
        <button class="mobile-menu-option" id="mobile-job-descriptions">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          Job Descriptions
        </button>
        <button class="mobile-menu-option" id="mobile-history">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          Version History
        </button>
        ${isElectron ? `
        <button class="mobile-menu-option" id="mobile-check-updates">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2v6h-6"/>
            <path d="M3 12a9 9 0 0 1 15-6l3 2"/>
            <path d="M3 22v-6h6"/>
            <path d="M21 12a9 9 0 0 1-15 6l-3-2"/>
          </svg>
          Check for Updates
        </button>
        ` : ''}
      </div>
      <div class="mobile-menu-section">
        <div class="mobile-menu-section-title">File</div>
        <label class="mobile-menu-option" id="mobile-import">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Import
          <input type="file" id="mobile-import-file" accept=".json,.md,.markdown" hidden>
        </label>
        <button class="mobile-menu-option" id="mobile-export-json">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export as JSON
        </button>
        <button class="mobile-menu-option" id="mobile-export-md">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export as Markdown
        </button>
      </div>
    </div>
  `;
  
  // Setup variant dropdown events
  setupVariantDropdown();
  setUpdateButtonsDisabled(manualUpdateCheckActive);
}

// Setup variant dropdown events
function setupVariantDropdown() {
  const dropdown = document.getElementById('variant-dropdown');
  const trigger = dropdown?.querySelector('.custom-dropdown-trigger');
  const menu = dropdown?.querySelector('.custom-dropdown-menu');

  trigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Handle option selection. Bound to the MENU (not the wrapper) so it keeps
  // working after the menu is re-parented into the glass portal.
  menu?.addEventListener('click', (e) => {
    const option = e.target.closest('.custom-dropdown-option');
    if (option) {
      const value = option.dataset.value;
      loadVariant(value);
      dropdown.classList.remove('open');
    }
  });

  // Close dropdown when clicking outside (isInPortal keeps it open when the menu
  // has been re-parented into the glass portal).
  document.addEventListener('click', (e) => {
    if (!dropdown?.contains(e.target) && !isInPortal(e.target)) {
      dropdown?.classList.remove('open');
    }
  });

  // Glass theme: portal the floating menus out of the frosted header so their
  // backdrop-filter blurs for real (no-op in a plain browser).
  if (menu && trigger) {
    registerPortalMenu(menu, trigger, { watch: dropdown, activeClass: 'open', placement: 'down' });
  }
  const actionsBtn = document.getElementById('btn-variant-actions');
  const actionsMenu = document.getElementById('variant-actions-menu');
  if (actionsBtn && actionsMenu) {
    registerPortalMenu(actionsMenu, actionsBtn, { activeClass: 'show', placement: 'down' });
  }
}

// Update just the variant selector
function updateVariantSelector() {
  const dropdown = document.getElementById('variant-dropdown');
  if (!dropdown) return;
  
  const variants = getVariants();
  const currentVariant = variants[currentVariantId];
  
  // Update label
  const label = dropdown.querySelector('.dropdown-label');
  if (label && currentVariant) {
    label.textContent = currentVariant.name;
  }
  
  // Update selected state
  dropdown.querySelectorAll('.custom-dropdown-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.value === currentVariantId);
  });
}

// Set up event listeners
function setupHeaderEventListeners() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('button, select, .header-import-btn, .header-export-option');
    if (!target) return;
    
    // Variant actions — serves BOTH the always-visible buttons (btn-new-variant…)
    // and the collapsed "⋯" dropdown options (btn-new-variant-menu…). Strip a
    // trailing "-menu" so one branch handles both. Delegation-only: inline onclick
    // is dead under Tauri's CSP nonce, and doubling it here + inline would double-act.
    const variantAction = target.id.replace(/-menu$/, '');
    if (['btn-new-variant', 'btn-duplicate-variant', 'btn-rename-variant', 'btn-delete-variant'].includes(variantAction)) {
      if (variantAction === 'btn-new-variant') {
        if (window.showOnboardingWizard) {
          window.showOnboardingWizard({ skipApiKeyStep: true });
        }
      } else if (variantAction === 'btn-duplicate-variant') {
        duplicateVariant();
      } else if (variantAction === 'btn-rename-variant') {
        renameCurrentVariant();
      } else if (variantAction === 'btn-delete-variant') {
        deleteCurrentVariant();
      }
      // Collapse the "⋯" menu if the click came from it (no-op for the expanded buttons).
      document.getElementById('variant-actions-menu')?.classList.remove('show');
    }
    
    // Tools button
    if (target.id === 'btn-header-tools') {
      const menu = document.getElementById('header-tools-menu');
      if (menu) {
        menu.classList.toggle('show');
      }
      // Close variant actions menu
      document.getElementById('variant-actions-menu')?.classList.remove('show');
    }
    
    // Variant actions dropdown button
    if (target.id === 'btn-variant-actions') {
      const menu = document.getElementById('variant-actions-menu');
      if (menu) {
        menu.classList.toggle('show');
      }
      // Close tools menu
      document.getElementById('header-tools-menu')?.classList.remove('show');
    }
    
    // User Profile
    if (target.id === 'btn-user-profile') {
      document.getElementById('header-tools-menu')?.classList.remove('show');
      if (window.openUserProfilePanel) {
        window.openUserProfilePanel();
      }
    }
    
    // Job Descriptions
    if (target.id === 'btn-job-descriptions') {
      document.getElementById('header-tools-menu')?.classList.remove('show');
      if (window.openJobDescriptionPanel) {
        window.openJobDescriptionPanel();
      }
    }
    
    // History
    if (target.id === 'btn-history') {
      document.getElementById('header-tools-menu')?.classList.remove('show');
      if (window.openHistoryPanel) {
        window.openHistoryPanel();
      }
    }

    // Import from previous Electron version — opt-in path for users
    // whose auto-migration didn't run (or didn't merge the way they
    // wanted). Opens a probe+confirm flow with Merge/Replace choice.
    if (target.id === 'btn-import-legacy-electron') {
      document.getElementById('header-tools-menu')?.classList.remove('show');
      handleImportLegacyElectron();
    }

    // Check for updates
    if (target.id === 'btn-check-updates') {
      document.getElementById('header-tools-menu')?.classList.remove('show');
      triggerManualUpdateCheck();
    }

    // Toggle the update channel (stable <-> beta). Keep the menu open so the
    // label flip is visible; the choice takes effect on the next update check.
    if (target.id === 'btn-update-channel') {
      const next = getUpdateChannel() === 'beta' ? 'stable' : 'beta';
      setUpdateChannel(next);
      const label = document.getElementById('update-channel-label');
      if (label) label.textContent = next === 'beta' ? 'Beta' : 'Stable';
      showUpdateToast(
        next === 'beta'
          ? 'Beta channel on. The next update check will offer pre-release builds.'
          : 'Stable channel on. The next update check will use released versions.',
        'info'
      );
    }

    // Export Full Backup — writes every owned localStorage key into a
    // single JSON file. Pairs with Import Backup… for portable backups.
    if (target.id === 'btn-export-full-backup') {
      document.getElementById('header-tools-menu')?.classList.remove('show');
      try {
        const { keysExported, filename } = exportFullBackup();
        // No alert on success — the browser download bar / native save
        // dialog is feedback enough. Log for debuggability.
        console.log(`[backup] Exported ${keysExported} keys to ${filename}`);
      } catch (err) {
        console.error('[backup] Export failed:', err);
        alert(`Export failed: ${err.message ?? String(err)}`);
      }
    }
    // The Import Backup label wraps a hidden file input; clicking the
    // label triggers the input, whose change handler does the work
    // (registered below). No click handler needed here.

    // Export button
    if (target.id === 'btn-header-export') {
      const menu = document.getElementById('header-export-menu');
      if (menu) {
        menu.classList.toggle('show');
      }
    }
    
    // Export options
    if (target.classList.contains('header-export-option')) {
      const format = target.dataset.format;
      exportCurrentVariant(format);
      document.getElementById('header-export-menu')?.classList.remove('show');
    }
    
    // Download PDF button in header
    if (target.id === 'header-download-pdf') {
      document.getElementById('download-pdf')?.click();
    }
  });
  
  // File import change
  document.addEventListener('change', (e) => {
    if (e.target.id === 'header-import-file') {
      const file = e.target.files[0];
      if (file) {
        importVariant(file);
        e.target.value = ''; // Reset for re-import
      }
    }
    // Import Full Backup — restores every owned localStorage key from
    // a JSON envelope produced by either Export Full Backup or
    // `scripts/migrate-from-electron.mjs`.
    if (e.target.id === 'header-import-backup-file') {
      const file = e.target.files[0];
      e.target.value = ''; // Reset early so re-selecting same file works
      if (!file) return;
      document.getElementById('header-tools-menu')?.classList.remove('show');
      (async () => {
        try {
          // Parse FIRST so we can show key count BEFORE confirming
          // (avoids the "destructive confirm with unknown payload"
          // anti-pattern). This is also the ONLY parse pass — we feed
          // the already-validated `preview` straight into
          // importFullBackupFromEnvelope below, so there's no second
          // `await file.text()` between the flush and the writes (see
          // the comment at that call site).
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
          // Flush all pending debounced writers (resume store + profile
          // panel) before the destructive restore. See
          // handleImportLegacyElectron above for the full reasoning —
          // short version: reloadWithOverlay yields to the event loop
          // for 16 ms before reload(), and any queued save callback
          // (resume `data` OR profile `profileData`) fires in that
          // window and overwrites the just-imported resume-designer-data.
          try {
            store.saveNow();
            flushPendingProfileSave();
          } catch (err) {
            console.warn('[backup] pre-import flush failed:', err);
          }
          // SYNCHRONOUS call (not `await importFullBackup(file)`) on
          // purpose. importFullBackup() would do a second `file.text()`
          // — that await would yield the event loop AFTER our flush
          // but BEFORE the writes, leaving a window where the user's
          // next keystroke could schedule a fresh debounced save that
          // we haven't flushed. importFullBackupFromEnvelope() takes
          // the already-parsed preview and runs the writes
          // synchronously, so flush→writes→alert→reload is one
          // uninterrupted call chain — no yield points, no race.
          const result = importFullBackupFromEnvelope(preview);
          let backupNote = '';
          if (result.historySkipped > 0) {
            // Same skip-note shape as handleImportLegacyElectron so a
            // user sees consistent language whether they import via
            // file picker or via the legacy-Electron menu item.
            backupNote =
              `\n\nNote: ${result.historySkipped} undo/redo history ` +
              `${result.historySkipped === 1 ? 'entry was' : 'entries were'} ` +
              `too large to fit in browser storage and ` +
              `${result.historySkipped === 1 ? 'was' : 'were'} skipped. ` +
              `Your resumes themselves are intact.`;
          }
          // Custom DOM modal owns both the OK confirmation AND the
          // reload transition — see showImportSuccessAndReload's
          // doc-comment for why we don't use native alert() here.
          showImportSuccessAndReload(
            `Restored ${result.keysImported} keys from backup ` +
            `(removed ${result.removedExistingKeys} existing keys).` +
            backupNote
          );
        } catch (err) {
          console.error('[backup] Import failed:', err);
          alert(`Import failed: ${err.message ?? String(err)}`);
        }
      })();
    }
  });
  
  // Close menus when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.header-export-dropdown')) {
      document.getElementById('header-export-menu')?.classList.remove('show');
    }
    if (!e.target.closest('.header-tools-dropdown')) {
      document.getElementById('header-tools-menu')?.classList.remove('show');
    }
    if (!e.target.closest('.header-variant-actions-dropdown')) {
      document.getElementById('variant-actions-menu')?.classList.remove('show');
    }
    // Close mobile menu when clicking outside (but not on the menu button)
    if (!e.target.closest('.header-mobile-menu') && !e.target.closest('.header-mobile-menu-btn')) {
      document.getElementById('header-mobile-menu')?.classList.remove('show');
    }
    
    // Mobile menu button toggle
    if (e.target.closest('#btn-mobile-menu')) {
      e.stopPropagation();
      document.getElementById('header-mobile-menu')?.classList.toggle('show');
      return;
    }
    
    // Mobile menu options (using event delegation)
    const mobileOption = e.target.closest('.mobile-menu-option');
    if (mobileOption) {
      const closeMobileMenu = () => {
        document.getElementById('header-mobile-menu')?.classList.remove('show');
      };
      
      if (mobileOption.id === 'mobile-new-variant') {
        closeMobileMenu();
        if (window.showOnboardingWizard) {
          window.showOnboardingWizard({ skipApiKeyStep: true });
        }
      } else if (mobileOption.id === 'mobile-duplicate-variant') {
        closeMobileMenu();
        duplicateVariant();
      } else if (mobileOption.id === 'mobile-rename-variant') {
        closeMobileMenu();
        renameCurrentVariant();
      } else if (mobileOption.id === 'mobile-delete-variant') {
        closeMobileMenu();
        deleteCurrentVariant();
      } else if (mobileOption.id === 'mobile-user-profile') {
        closeMobileMenu();
        if (window.openUserProfilePanel) {
          window.openUserProfilePanel();
        }
      } else if (mobileOption.id === 'mobile-job-descriptions') {
        closeMobileMenu();
        if (window.openJobDescriptionPanel) {
          window.openJobDescriptionPanel();
        }
      } else if (mobileOption.id === 'mobile-history') {
        closeMobileMenu();
        if (window.openHistoryPanel) {
          window.openHistoryPanel();
        }
      } else if (mobileOption.id === 'mobile-check-updates') {
        closeMobileMenu();
        triggerManualUpdateCheck();
      } else if (mobileOption.id === 'mobile-export-json') {
        closeMobileMenu();
        exportCurrentVariant('json');
      } else if (mobileOption.id === 'mobile-export-md') {
        closeMobileMenu();
        exportCurrentVariant('md');
      }
    }
  });
  
  // Mobile import file change (using event delegation)
  document.addEventListener('change', (e) => {
    if (e.target.id === 'mobile-import-file') {
      const file = e.target.files[0];
      if (file) {
        document.getElementById('header-mobile-menu')?.classList.remove('show');
        importVariant(file);
        e.target.value = '';
      }
    }
  });
}

function initUpdateUi() {
  if (!isElectron || updateListenersInitialized) return;
  updateListenersInitialized = true;

  onUpdateStatus((payload = {}) => {
    handleUpdateStatus(payload);
  });
}

async function triggerManualUpdateCheck() {
  if (!isElectron) return;

  manualUpdateCheckActive = true;
  setUpdateButtonsDisabled(true);
  showUpdateToast('Checking for updates...', 'info', true);

  try {
    const result = await checkForUpdates();
    if (!result?.checking) {
      manualUpdateCheckActive = false;
      setUpdateButtonsDisabled(false);

      if (result?.reason === 'already-checking') {
        showUpdateToast('Already checking for updates...', 'info');
      } else if (result?.message) {
        showUpdateToast(result.message, 'warning');
      }
    }
  } catch (error) {
    manualUpdateCheckActive = false;
    setUpdateButtonsDisabled(false);
    showUpdateToast(`Could not check for updates: ${error.message}`, 'error');
  }
}

function handleUpdateStatus(payload) {
  if (!payload?.status) return;

  const status = payload.status;
  const source = payload.source || 'auto';
  const isManualFlow = source === 'manual' || manualUpdateCheckActive;
  const percent = typeof payload.percent === 'number' ? Math.round(payload.percent) : null;
  const version = payload.version ? ` ${payload.version}` : '';

  switch (status) {
    case 'checking':
      if (isManualFlow) {
        setUpdateButtonsDisabled(true);
        showUpdateToast(payload.message || 'Checking for updates...', 'info', true);
      }
      break;

    case 'up-to-date':
      if (isManualFlow) {
        showUpdateToast(payload.message || 'You are on the latest version.', 'success');
      }
      manualUpdateCheckActive = false;
      setUpdateButtonsDisabled(false);
      break;

    case 'available':
      showUpdateToast(
        payload.message || `Update${version} is available. Choose Download in the dialog to continue.`,
        'info'
      );
      manualUpdateCheckActive = false;
      setUpdateButtonsDisabled(false);
      break;

    case 'download-started':
      setUpdateButtonsDisabled(true);
      showUpdateToast(payload.message || 'Downloading update... 0%', 'info', true);
      break;

    case 'downloading':
      setUpdateButtonsDisabled(true);
      showUpdateToast(
        payload.message || `Downloading update... ${percent || 0}%`,
        'info',
        true
      );
      break;

    case 'downloaded':
      showUpdateToast(
        payload.message || `Update${version} downloaded. Choose Restart Now in the dialog to install.`,
        'success'
      );
      manualUpdateCheckActive = false;
      setUpdateButtonsDisabled(false);
      break;

    case 'restart-deferred':
      showUpdateToast(
        payload.message || 'Update downloaded. Restart the app later to finish installation.',
        'info'
      );
      manualUpdateCheckActive = false;
      setUpdateButtonsDisabled(false);
      break;

    case 'deferred':
      showUpdateToast(payload.message || 'Update download postponed.', 'info');
      manualUpdateCheckActive = false;
      setUpdateButtonsDisabled(false);
      break;

    case 'installing':
      showUpdateToast(payload.message || 'Restarting to install update...', 'info', true);
      manualUpdateCheckActive = false;
      setUpdateButtonsDisabled(true);
      break;

    case 'disabled':
      if (isManualFlow) {
        showUpdateToast(payload.message || 'Updates are disabled in development builds.', 'warning');
      }
      manualUpdateCheckActive = false;
      setUpdateButtonsDisabled(false);
      break;

    case 'error':
      if (isManualFlow || source === 'startup') {
        showUpdateToast(payload.message || 'Could not check for updates.', 'error');
      }
      manualUpdateCheckActive = false;
      setUpdateButtonsDisabled(false);
      break;

    default:
      break;
  }
}

function setUpdateButtonsDisabled(disabled) {
  if (!isElectron) return;

  const desktopBtn = document.getElementById('btn-check-updates');
  const mobileBtn = document.getElementById('mobile-check-updates');

  if (desktopBtn) desktopBtn.disabled = disabled;
  if (mobileBtn) mobileBtn.disabled = disabled;
}

function showUpdateToast(message, tone = 'info', persistent = false) {
  if (!isElectron || !message) return;

  let toast = document.getElementById('update-status-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'update-status-toast';
    toast.className = 'update-status-toast';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.className = `update-status-toast tone-${tone} show`;

  if (updateToastTimer) {
    clearTimeout(updateToastTimer);
    updateToastTimer = null;
  }

  if (!persistent) {
    updateToastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 4500);
  }
}

// Format a date for display (relative or absolute)
function formatDate(isoString) {
  if (!isoString) return '';
  
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    // Today - show time
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    // Show date
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}

// HTML escape utility
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
