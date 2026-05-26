/**
 * Native Platform Utilities
 * Unified API for native features across web and Tauri.
 *
 * Migrated from Electron preload IPC to Tauri 2 plugin imports.
 * Exported names are preserved (incl. legacy `isElectron` alias) so the rest
 * of the renderer keeps working unchanged.
 */

// Detect Tauri without statically importing tauri APIs at the web entry
// (so `npm run dev` outside Tauri doesn't blow up at import time).
// Per Tauri 2.5 release notes (v2.tauri.app/release/@tauri-apps/api/v2.5.0),
// `core.isTauri` checks for the `isTauri` property on `globalThis`, which
// Tauri's runtime sets at startup. Doing the sniff inline keeps it sync
// (so module-init code can rely on it) without dynamic-importing
// @tauri-apps/api/core.
export const isTauri =
  typeof globalThis !== 'undefined' && 'isTauri' in globalThis;

// Back-compat alias — keeps src/pdf.js, src/headerBar.js, etc. unchanged.
// Slated for removal in a follow-up cleanup PR.
export const isElectron = isTauri;

let _platformCache = null;
let _appInfoCache = null;

// Lazy holders for the Tauri plugin modules. Dynamic-imported so the web
// branch never tries to resolve `@tauri-apps/*` packages.
//
// `@tauri-apps/plugin-fs` is intentionally NOT loaded here. No renderer
// code reads or writes via fs anymore — PDF export goes through the
// dedicated Rust commands (pick_pdf_save_path + capture_pdf_from_window),
// JSON/Markdown import/export use the browser's File API and `<a download>`.
// Keeping fs out of the renderer means a compromised script can't reach
// the filesystem even if `@tauri-apps/plugin-fs` were re-introduced in
// Cargo without a matching capability.
let _tauri = null;
async function tauri() {
  if (_tauri) return _tauri;
  if (!isTauri) throw new Error('Tauri APIs unavailable outside the desktop app');
  const [dialog, shell, app, osPlugin, updater, process, core, event] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-shell'),
    import('@tauri-apps/api/app'),
    import('@tauri-apps/plugin-os'),
    import('@tauri-apps/plugin-updater'),
    import('@tauri-apps/plugin-process'),
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);
  _tauri = { dialog, shell, app, osPlugin, updater, process, core, event };
  return _tauri;
}

const PLATFORM_MAP = {
  macos: 'darwin',
  windows: 'win32',
  linux: 'linux',
};

/**
 * Returns 'darwin' | 'win32' | 'linux' | 'web'.
 * Now async (Tauri's platform() is async). The only renderer callers are
 * in main.js init() and persistence.js, both of which can await.
 */
export async function getPlatform() {
  if (!isTauri) return 'web';
  if (_platformCache) return _platformCache;
  const { osPlugin } = await tauri();
  const raw = await osPlugin.platform();
  _platformCache = PLATFORM_MAP[raw] ?? raw;
  return _platformCache;
}

/**
 * Show a message dialog. Returns the index of the clicked button (0 or 1).
 */
export async function showMessage(options) {
  if (isTauri) {
    const { dialog } = await tauri();
    const kind = options.type === 'error' || options.type === 'warning' ? options.type : 'info';
    const buttons = options.buttons || ['OK'];
    if (buttons.length <= 1) {
      await dialog.message(options.message ?? '', {
        title: options.title ?? 'Resume Designer',
        kind,
      });
      return 0;
    }
    const yes = await dialog.ask(options.message ?? '', {
      title: options.title ?? 'Resume Designer',
      kind,
      okLabel: buttons[0],
      cancelLabel: buttons[1],
    });
    return yes ? 0 : 1;
  }

  // Web fallback
  if (options.buttons && options.buttons.length > 1) {
    return confirm(options.message) ? 0 : 1;
  }
  alert(options.message);
  return 0;
}

/**
 * Get app metadata.
 */
export async function getAppInfo() {
  if (_appInfoCache) return _appInfoCache;
  if (isTauri) {
    const { app } = await tauri();
    _appInfoCache = {
      version: await app.getVersion(),
      name: await app.getName(),
      platform: await getPlatform(),
      isPackaged: import.meta.env.PROD,
    };
    return _appInfoCache;
  }
  return {
    version: '1.0.0',
    name: 'Resume Designer',
    platform: 'web',
    isPackaged: false,
  };
}

// ============================================
// Updater state machine — mirrors the Electron behavior exactly:
//   checking → up-to-date | available → (download? Y/N) →
//     download-started → downloading (with percent) → downloaded →
//     (restart? Y/N) → installing | restart-deferred
// ============================================

const updateStatusListeners = [];
const updateProgressListeners = [];
let isCheckingForUpdates = false;
let lastSource = 'auto';

function emitStatus(payload) {
  const enriched = { timestamp: Date.now(), ...payload };
  for (const cb of updateStatusListeners) {
    try { cb(enriched); } catch (_) { /* swallow */ }
  }
}
function emitProgress(percent) {
  for (const cb of updateProgressListeners) {
    try { cb(percent); } catch (_) { /* swallow */ }
  }
}

export function onUpdateStatus(callback) {
  if (typeof callback === 'function') updateStatusListeners.push(callback);
}
export function onUpdateProgress(callback) {
  if (typeof callback === 'function') updateProgressListeners.push(callback);
}

export async function checkForUpdates(source = 'manual') {
  if (!isTauri) {
    return {
      checking: false,
      message: 'Update checks are only available in the desktop app.',
    };
  }

  if (import.meta.env.DEV) {
    emitStatus({
      status: 'disabled',
      source,
      message: 'Updates are disabled in development builds.',
    });
    return { checking: false, message: 'Updates disabled in development', reason: 'disabled' };
  }

  if (isCheckingForUpdates) {
    emitStatus({
      status: 'checking',
      source,
      message: 'Already checking for updates...',
    });
    return { checking: false, reason: 'already-checking' };
  }

  isCheckingForUpdates = true;
  lastSource = source;
  emitStatus({ status: 'checking', source, message: 'Checking for updates...' });

  try {
    // Inside try so a dynamic-import failure (chunk load, transient network)
    // is caught by the handler below and resets isCheckingForUpdates.
    const { updater, process: tauriProcess, dialog } = await tauri();
    const update = await updater.check();
    if (!update) {
      emitStatus({ status: 'up-to-date', source, message: 'You are on the latest version.' });
      isCheckingForUpdates = false;
      return { checking: true };
    }

    const currentVersion = await getAppInfo().then((i) => i.version).catch(() => null);
    emitStatus({
      status: 'available',
      source,
      version: update.version,
      currentVersion,
      message: `Version ${update.version} is available.`,
    });

    const wantsDownload = await dialog.ask(
      `A new version (${update.version}) is available. Would you like to download it now?`,
      { title: 'Update Available', okLabel: 'Download', cancelLabel: 'Later' }
    );
    if (!wantsDownload) {
      emitStatus({
        status: 'deferred',
        source,
        version: update.version,
        message: 'Update download postponed.',
      });
      isCheckingForUpdates = false;
      return { checking: true };
    }

    emitStatus({
      status: 'download-started',
      source,
      version: update.version,
      message: `Downloading version ${update.version}...`,
    });

    let downloaded = 0;
    let total = 0;
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data?.contentLength ?? 0;
          break;
        case 'Progress': {
          downloaded += event.data?.chunkLength ?? 0;
          if (total > 0) {
            const percent = Math.min(100, (downloaded / total) * 100);
            emitProgress(percent);
            emitStatus({
              status: 'downloading',
              source,
              percent,
              message: `Downloading update... ${Math.round(percent)}%`,
            });
          }
          break;
        }
        case 'Finished':
          emitProgress(100);
          emitStatus({
            status: 'downloaded',
            source,
            version: update.version,
            message: `Version ${update.version} is ready to install.`,
          });
          break;
        default:
          break;
      }
    });

    const wantsRestart = await dialog.ask(
      `Version ${update.version} has been downloaded. Restart the app to apply the update.`,
      { title: 'Update Ready', okLabel: 'Restart Now', cancelLabel: 'Later' }
    );
    if (wantsRestart) {
      emitStatus({
        status: 'installing',
        source,
        version: update.version,
        message: 'Restarting to install update...',
      });
      // Mirror Electron's 10s watchdog: if relaunch doesn't actually start,
      // surface guidance instead of hanging silently.
      const guard = setTimeout(() => {
        emitStatus({
          status: 'error',
          source,
          message:
            'Update install did not start. Please verify that the app is properly signed/notarized.',
        });
      }, 10000);
      try {
        await tauriProcess.relaunch();
      } finally {
        clearTimeout(guard);
      }
    } else {
      emitStatus({
        status: 'restart-deferred',
        source,
        version: update.version,
        message: 'Update downloaded. Restart the app later to finish installation.',
      });
    }

    isCheckingForUpdates = false;
    return { checking: true };
  } catch (err) {
    isCheckingForUpdates = false;
    const raw = err?.message ?? String(err);
    const signatureFailure = /signature|verify|verification|invalid/i.test(raw);
    const message = signatureFailure
      ? 'Updater rejected this update because signature verification failed. The release artifact may be unsigned or corrupted.'
      : `Updater error: ${raw}`;
    emitStatus({ status: 'error', source, message });
    return { checking: false, error: raw };
  }
}

/**
 * Auto-check on app launch. Called once from src/main.js init().
 * Equivalent of electron/main.cjs:106 `checkForUpdates('startup')`.
 */
export async function startupUpdateCheck() {
  if (!isTauri || import.meta.env.DEV) return;
  await checkForUpdates('startup');
}

/**
 * Open a URL in the system default browser.
 * Mirror of electron's setWindowOpenHandler/shell.openExternal pattern.
 */
export async function openExternal(url) {
  if (isTauri) {
    const { shell } = await tauri();
    await shell.open(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Show the native save-file dialog (PDF filter) and return the chosen path,
 * or `null` if the user cancelled. Pure dialog interaction — no capture yet.
 * Lets pdf.js separate "pick where to save" from "render and capture", which
 * is what enables the background hidden-window flow.
 */
export async function pickPdfSavePath(defaultName = 'Resume.pdf') {
  if (!isTauri) return null;
  const { core } = await tauri();
  return await core.invoke('pick_pdf_save_path', { defaultName });
}

/**
 * Invoke the Rust capture command against a SPECIFIC window's web view
 * (identified by label). Used by pdf.js after spawning a hidden print window
 * at `/?print=1` and receiving its `print-ready` event.
 *
 * Notice there is NO `savePath` parameter: the destination path is bound
 * server-side by the prior `pickPdfSavePath` call (which stashes the
 * user-confirmed path in Rust state). This prevents the renderer from
 * writing PDFs to arbitrary filesystem locations even under XSS / a
 * compromised dependency.
 *
 * - `pageSize` (inches) is consumed by the Windows WebView2 PrintToPdfAsync path.
 * - `captureRect` (CSS pixels, doc-relative; in the new flow the print window
 *   anchors the resume at origin so x/y are always 0) is consumed by the
 *   macOS WKWebView createPDF path.
 */
export async function capturePdfFromWindow(windowLabel, pageSize = null, captureRect = null) {
  if (!isTauri) {
    return { success: false, error: 'Native PDF generation not available in browser' };
  }
  const { core } = await tauri();
  return await core.invoke('capture_pdf_from_window', {
    windowLabel,
    pageSize,
    captureRect,
  });
}
