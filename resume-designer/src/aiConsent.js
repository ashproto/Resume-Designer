import { appStorage } from './appStorage.js';

// Deliberately outside the owned-key inventories: never profile-namespaced,
// exported, restored from a backup, or accepted as a CloudKit unit.
const CONSENT_KEY = 'resume-designer-ai-sharing-consent';

export const AI_CONSENT_DISCLOSURE = Object.freeze({
  revision: 1,
  title: 'Share data with AI?',
  message: 'AI features send your prompts and relevant resume, profile, job description, '
    + 'chat history, and imported document text to OpenRouter and the providers running '
    + 'your selected AI models. Automatic fallback can send this data to other model '
    + 'providers. When web search is enabled, search queries may also be shared with '
    + 'search providers. Their privacy policies apply.\n\n'
    + 'Allow this for future AI requests on this device? You can turn it off in Settings '
    + 'to stop future requests; data already sent cannot be recalled. Local editing, '
    + 'saving, and export remain available if you decline.',
});

let presenter = null;
let pending = null;
let generation = 0;
let savingConsent = false;
let paused = false;
let revocationPending = false;
const listeners = new Set();

function consentError(code = 'AI_CONSENT_DECLINED') {
  const error = new Error(code === 'AI_CONSENT_STORAGE'
    ? 'AI data sharing could not be saved on this device. Your data was not sent. Try again after checking available storage.'
    : 'AI request cancelled. Your data was not sent. Allow AI data sharing in Settings to use AI.');
  error.code = code;
  return error;
}

function revocationError() {
  const error = new Error('AI sharing is paused for this session, but the change could not be saved. Retry stopping AI sharing in Settings before closing the app.');
  error.code = 'AI_CONSENT_STORAGE';
  return error;
}

function announce() {
  for (const listener of listeners) {
    try { listener(); } catch (error) { console.error('[aiConsent] status listener failed:', error); }
  }
}

export function hasAIConsent() {
  if (savingConsent || paused || revocationPending) return false;
  try {
    const saved = JSON.parse(appStorage.getItem(CONSENT_KEY));
    return saved?.revision === AI_CONSENT_DISCLOSURE.revision && saved?.accepted === true;
  } catch { return false; }
}

// When the denial write succeeds, failed deletion leaves it on disk. Settings
// must offer cleanup retry even after process-local flags reset on relaunch.
export function isAIConsentRevocationPending() {
  if (revocationPending) return true;
  try {
    return JSON.parse(appStorage.getItem(CONSENT_KEY))?.revocationPending === true;
  } catch { return false; }
}

export function setAIConsentPresenter(nextPresenter) {
  presenter = typeof nextPresenter === 'function' ? nextPresenter : null;
}

export function subscribeAIConsent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('AI request stopped.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new DOMException('AI request stopped.', 'AbortError'));
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

function beginRequest({ modelIds = [], feature = 'chat', webSearch = false }) {
  if (!presenter) throw consentError();
  const present = presenter;
  const started = generation;
  const current = { controller: new AbortController(), consumers: 0, promise: null };
  pending = current;
  current.promise = (async () => {
    let allowed;
    try {
      allowed = await waitWithSignal(Promise.resolve().then(() => present({
        ...AI_CONSENT_DISCLOSURE, modelIds, feature, webSearch,
        signal: current.controller.signal,
      })), current.controller.signal);
    } catch { throw consentError(); }
    if (allowed !== true || started !== generation || current.controller.signal.aborted) throw consentError();
    savingConsent = true;
    try {
      // Restore guards defer writes and still allow an empty flush to succeed.
      // A deferred grant is not permission and must not be acknowledged.
      if (appStorage.isRestoreGuardActive()) throw consentError('AI_CONSENT_STORAGE');
      appStorage.setItem(CONSENT_KEY, JSON.stringify({
        revision: AI_CONSENT_DISCLOSURE.revision, accepted: true,
        acceptedAt: new Date().toISOString(),
      }));
      if (!(await appStorage.flush())) throw consentError('AI_CONSENT_STORAGE');
      if (started !== generation || current.controller.signal.aborted) throw consentError();
      paused = false;
    } catch (error) {
      if (started === generation) {
        paused = true;
        appStorage.removeItem(CONSENT_KEY);
        await appStorage.flush();
      }
      throw error?.code ? error : consentError('AI_CONSENT_STORAGE');
    } finally {
      savingConsent = false;
    }
    announce();
  })().finally(() => { if (pending === current) pending = null; });
  return current;
}

/** Called at every inference boundary, including retries and fallback attempts. */
export async function requestAIConsent({ signal, ...details } = {}) {
  if (signal?.aborted) throw new DOMException('AI request stopped.', 'AbortError');
  if (isAIConsentRevocationPending()) throw revocationError();
  if (hasAIConsent()) return;
  const current = pending || beginRequest(details);
  current.consumers += 1;
  try {
    await waitWithSignal(current.promise, signal);
    if (!hasAIConsent()) throw consentError();
  } finally {
    current.consumers -= 1;
    // A shared prompt remains useful while any request still wants an answer.
    if (current.consumers === 0 && pending === current) current.controller.abort();
  }
}

/** Synchronous final check: a revocation can land while an awaited gate resumes. */
export function assertAIConsent() {
  if (!hasAIConsent()) throw consentError();
}

export async function revokeAIConsent() {
  generation += 1;
  const revoked = generation;
  paused = true;
  revocationPending = true;
  pending?.controller.abort();
  announce();
  if (appStorage.isRestoreGuardActive()) throw revocationError();
  try {
    // Commit denial BEFORE deleting: a failed deletion must not resurrect an
    // accepted grant on the next launch. Separate flushes prevent coalescing
    // this write away. If writing fails, still try deleting the old grant.
    appStorage.setItem(CONSENT_KEY, JSON.stringify({
      revision: AI_CONSENT_DISCLOSURE.revision, accepted: false,
      revocationPending: true,
    }));
    await appStorage.flush();
  } catch { /* Deletion can succeed even when storage cannot accept a write. */ }
  try {
    appStorage.removeItem(CONSENT_KEY);
    if (appStorage.isRestoreGuardActive() || !(await appStorage.flush())) throw revocationError();
  } catch {
    throw revocationError();
  }
  if (generation === revoked) {
    paused = false;
    revocationPending = false;
    announce();
  }
}
