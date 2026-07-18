/**
 * Bridge Glue
 *
 * Tauri-side wiring for the companion-extension bridge: owns the pairing
 * token, subscribes to `bridge:request` events from the Rust loopback server
 * (src-tauri/src/commands/bridge.rs), routes them through the pure router
 * (bridgeRoutes.js) with the app's real modules injected, and answers via the
 * `bridge_respond` command. No-op outside Tauri (browser dev/tests).
 */

import { appStorage } from './appStorage.js';
import { store } from './store.js';
import { createBridgeRouter } from './bridgeRoutes.js';
import {
  generateUniqueVariantName,
  getSettings,
  getVariants,
  getUserProfile,
  saveVariant,
} from './persistence.js';
import { addApplication } from './applications.js';
import { getAllLearnedAnswers, saveLearnedAnswer } from './learnedAnswers.js';
import {
  analyzeResumeDataAgainstJobs,
  completeForBridge,
  generateResumeChangesForData,
  getDefaultModelId,
} from './aiService.js';
import { createCompanionJobActions } from './companionJobActions.js';
import { createCompanionPairing } from './companionPairing.js';
import { loadVariant } from './variantManager.js';

const TOKEN_KEY = 'resume-designer-bridge-token';

// Same Tauri sniff as appStorage.js (duplicated for the same cycle reason).
const IS_TAURI =
  typeof window !== 'undefined' &&
  ('isTauri' in window || '__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export function getBridgeToken() {
  return appStorage.getItem(TOKEN_KEY) || '';
}

function ensureBridgeToken() {
  let token = getBridgeToken();
  if (!token) {
    token = crypto.randomUUID();
    appStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}

export async function initBridge({ profileId = null } = {}) {
  if (!IS_TAURI) return;
  ensureBridgeToken();

  // A new opaque context on every app boot invalidates extension work after
  // profile switches, imports, or any other reload — even when profileId is
  // unchanged. The resolved profileId is captured by main.js before React can
  // initiate a switch, so it stays aligned with this boot's storage mapping.
  const profileContextId = crypto.randomUUID();

  const [
    { listen },
    { invoke },
    { getVersion },
    { getCurrent, onOpenUrl },
    { confirm: confirmNative },
  ] = await Promise.all([
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/app'),
    import('@tauri-apps/plugin-deep-link'),
    import('@tauri-apps/plugin-dialog'),
  ]);
  const version = await getVersion();

  const pairing = createCompanionPairing({
    ensureToken: ensureBridgeToken,
    flush: () => appStorage.flush(),
    confirmPairing: () => confirmNative(
      'Allow the Resume Designer Companion extension to read your local résumés, use your configured AI, and save tailored résumés, answers, and application records?',
      {
        title: 'Connect browser extension',
        kind: 'info',
        okLabel: 'Connect',
        cancelLabel: 'Cancel',
      },
    ),
  });

  const jobActions = createCompanionJobActions({
    getVariants,
    getSettings,
    getDefaultModelId,
    analyzeResumeDataAgainstJobs,
    generateResumeChangesForData,
    generateUniqueVariantName,
    saveVariant,
    loadVariant,
    flush: () => appStorage.flush(),
    writesSuspended: () => store.areSavesSuspended(),
  });

  // Defensive lookup of pdf.js's export: if the module fails to load or the
  // export is missing, the PDF route 500s cleanly instead of breaking init.
  let exportVariantPdf = async () => {
    throw new Error('PDF export over the bridge is not available yet');
  };
  try {
    const pdf = await import('./pdf.js');
    if (typeof pdf.exportVariantPdfBase64 === 'function') {
      exportVariantPdf = pdf.exportVariantPdfBase64;
    }
  } catch (e) {
    console.warn('[Bridge] pdf module unavailable:', e);
  }

  const handle = createBridgeRouter({
    version,
    profileId,
    profileContextId,
    getToken: getBridgeToken,
    getVariants,
    getUserProfile,
    getLearnedAnswers: getAllLearnedAnswers,
    addApplication,
    saveLearnedAnswer,
    complete: completeForBridge,
    exportVariantPdf,
    claimPairing: pairing.claim,
    analyzeJobFit: jobActions.analyzeJobFit,
    createTailoredResume: jobActions.createTailoredResume,
    // Reject persisting writes while a destructive import is mid-flight — the
    // bridge's writers (addApplication / saveLearnedAnswer) bypass the store, so
    // store.suspendSaves() alone doesn't stop them serializing stale caches over
    // the just-restored keys. Cleared automatically when the import reloads (or
    // resumes saves on failure), since this reads the store's live flag.
    writesSuspended: () => store.areSavesSuspended(),
  });

  await listen('bridge:request', async (event) => {
    const { id, method, path, authorization, body } = event.payload || {};
    let res;
    try {
      res = await handle({ method, path, authorization, body });
    } catch (err) {
      res = { status: 500, body: { error: err?.message || 'internal error' } };
    }
    try {
      await invoke('bridge_respond', { id, status: res.status, body: JSON.stringify(res.body) });
    } catch (err) {
      // Late answer after the HTTP thread timed out — nothing to do.
      console.warn('[Bridge] respond failed:', err);
    }
  });

  const registerDeepLinks = (urls) => {
    for (const url of urls ?? []) {
      void pairing.registerUrl(url).catch((error) => {
        console.warn('[Bridge] companion link could not be handled:', error?.message || error);
      });
    }
  };
  await onOpenUrl(registerDeepLinks);
  try {
    registerDeepLinks(await getCurrent());
  } catch (error) {
    console.warn('[Bridge] initial companion link unavailable:', error?.message || error);
  }
  console.log('[Bridge] ready on 127.0.0.1:17872');
}
