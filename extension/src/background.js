import { BridgeError, createBridgeClient } from './bridgeClient.js';
import { requestMapping } from './mapping.js';
import { isSensitiveQuestion } from './sensitivity.js';

const STORAGE_KEY = 'bridgeToken';
const CONSENT_KEY = 'privacyConsentVersion';
const CONSENT_VERSION = 1;

const SUPPORTED_MESSAGES = new Set([
  'privacy.status',
  'privacy.accept',
  'pairing.disconnect',
  'pairing.cancel',
  'connection.check',
  'app.open',
  'pairing.save',
  'resumes.list',
  'ai.models',
  'page.scan',
  'mapping.create',
  'page.fill',
  'answer.save',
  'application.log',
  'job.fit.analyze',
  'resume.tailor',
]);

const APP_OPEN_URL = 'resume-designer://companion/open?protocolVersion=2';
const DEFAULT_HEALTH_POLL_ATTEMPTS = 80;
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 250;
const DEFAULT_PAIRING_POLL_ATTEMPTS = 120;
const DEFAULT_PAIRING_POLL_INTERVAL_MS = 500;
const HTTP_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function serializeError(error) {
  if (error instanceof BridgeError) {
    return {
      message: error.message,
      status: error.status,
      code: error.code,
      retryable: error.retryable,
    };
  }

  return {
    message: error instanceof Error ? error.message : 'Unexpected extension error',
    status: null,
    code: 'unexpected_error',
    retryable: false,
  };
}

function lostActiveTabError() {
  return new BridgeError(
    'Page access was lost. Click the extension toolbar button again on that page.',
    { code: 'active_tab_grant_lost', retryable: true },
  );
}

function restrictedPageError() {
  return new BridgeError(
    'This browser page is restricted. Open an HTTPS application page instead. Local test fixtures may use HTTP on localhost.',
    { code: 'restricted_page', retryable: false },
  );
}

function isAllowedApplicationUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      || (url.protocol === 'http:' && HTTP_LOOPBACK_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}

function profileChangedError() {
  return new BridgeError(
    'On Paper reloaded or switched profiles. Review the refreshed resume list and scan again.',
    { code: 'profile_changed', retryable: true },
  );
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function launchFailedError(error) {
  return new BridgeError(
    'Could not open On Paper. Make sure the desktop app is installed.',
    {
      code: 'launch_failed',
      retryable: true,
      cause: error,
    },
  );
}

export function createBackgroundService({
  chromeApi = globalThis.chrome,
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  randomBytesImpl = (length) => cryptoImpl.getRandomValues(new Uint8Array(length)),
  waitImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  pollAttempts,
  pollIntervalMs,
  healthPollAttempts = pollAttempts ?? DEFAULT_HEALTH_POLL_ATTEMPTS,
  healthPollIntervalMs = pollIntervalMs ?? DEFAULT_HEALTH_POLL_INTERVAL_MS,
  pairingPollAttempts = pollAttempts ?? DEFAULT_PAIRING_POLL_ATTEMPTS,
  pairingPollIntervalMs = pollIntervalMs ?? DEFAULT_PAIRING_POLL_INTERVAL_MS,
  openingTimeoutMs = 85_000,
} = {}) {
  let installed = false;
  let pdfQueue = Promise.resolve();
  let connectionEpoch = 0;
  let pendingDisconnects = 0;
  let openingAttempt = null;
  let tokenWriteQueue = Promise.resolve();

  function cancelledError() {
    return new BridgeError('Connection cancelled. You can pair manually.', { code: 'pairing_cancelled', retryable: false });
  }

  function cancelOpening() {
    if (openingAttempt) {
      connectionEpoch += 1;
      openingAttempt.controller.abort();
      openingAttempt = null;
    }
    return tokenWriteQueue.then(() => ({ cancelled: true }));
  }

  function assertAttempt(attempt) {
    if (attempt?.controller.signal.aborted) throw cancelledError();
    assertConnectionEpoch(attempt.epoch);
  }

  async function waitForAttempt(promise, attempt) {
    assertAttempt(attempt);
    const signal = attempt.controller.signal;
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(cancelledError());
      signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([promise, cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
  }

  function storePairingToken(token, expectedEpoch, signal) {
    const operation = tokenWriteQueue.then(async () => {
      assertConnectionEpoch(expectedEpoch);
      if (signal?.aborted) throw cancelledError();
      const previous = await getStoredToken();
      assertConnectionEpoch(expectedEpoch);
      await chromeApi.storage.session.set({ [STORAGE_KEY]: token });
      try {
        assertConnectionEpoch(expectedEpoch);
        if (signal?.aborted) throw cancelledError();
      } catch (error) {
        await chromeApi.storage.session.set({ [STORAGE_KEY]: previous });
        throw error;
      }
    });
    tokenWriteQueue = operation.catch(() => undefined);
    return operation;
  }

  function assertConnectionEpoch(expectedEpoch) {
    if (expectedEpoch !== connectionEpoch || pendingDisconnects > 0) {
      throw new BridgeError('This connection was disconnected. Connect again to continue.', {
        code: 'not_paired', retryable: false,
      });
    }
  }

  async function getStoredToken() {
    const stored = await chromeApi.storage.session.get(STORAGE_KEY);
    return stored[STORAGE_KEY] ?? '';
  }

  const bridge = createBridgeClient({ fetchImpl, getToken: getStoredToken });

  function bridgeForToken(token) {
    return createBridgeClient({ fetchImpl, getToken: async () => token });
  }

  async function connectionForToken(token, health, options = {}) {
    const candidate = bridgeForToken(token);
    const checkedHealth = health ?? await candidate.health(options);
    const {
      profileId = null, profileContextId = null, resumes = [],
    } = await candidate.listResumes(options);
    if (
      typeof profileId !== 'string'
      || !profileId.trim()
      || typeof profileContextId !== 'string'
      || !profileContextId.trim()
      || !Array.isArray(resumes)
      || resumes.some((resume) => (
        !resume
        || typeof resume !== 'object'
        || typeof resume.id !== 'string'
        || !resume.id.trim()
      ))
    ) {
      throw new BridgeError('On Paper returned an invalid profile context', {
        code: 'invalid_response',
        retryable: true,
      });
    }
    return {
      connected: true,
      health: checkedHealth,
      profileId,
      profileContextId,
      resumes,
    };
  }

  async function probeConnection() {
    const health = await bridge.health();
    const token = String(await getStoredToken()).trim();

    if (!token) {
      return {
        connected: false, health, profileId: null, profileContextId: null, resumes: [],
      };
    }

    return connectionForToken(token, health);
  }

  function assertResponseContext(expectedContextId, response) {
    const expected = typeof expectedContextId === 'string' ? expectedContextId.trim() : '';
    const active = typeof response?.profileContextId === 'string'
      ? response.profileContextId.trim()
      : '';
    const profileId = typeof response?.profileId === 'string' ? response.profileId.trim() : '';

    if (!expected || !active || !profileId || active !== expected) throw profileChangedError();
    return response;
  }

  async function assertProfileContext(expectedContextId) {
    const context = await bridge.listResumes();
    return assertResponseContext(expectedContextId, context);
  }

  async function rethrowAfterContextCheck(expectedContextId, error) {
    if (error?.code === 'profile_changed') throw error;
    try {
      await assertProfileContext(expectedContextId);
    } catch (contextError) {
      if (contextError?.code === 'profile_changed') throw contextError;
    }
    throw error;
  }

  async function withinProfileContext(expectedContextId, operation) {
    await assertProfileContext(expectedContextId);
    try {
      const result = await operation();
      await assertProfileContext(expectedContextId);
      return result;
    } catch (error) {
      return rethrowAfterContextCheck(expectedContextId, error);
    }
  }

  async function withinProfileMutation(expectedContextId, operation) {
    await assertProfileContext(expectedContextId);
    try {
      // The bridge validates the same context atomically before persisting.
      // Once it acknowledges the write, a later reload must not turn that
      // committed success into a retryable error and invite a duplicate write.
      return await operation();
    } catch (error) {
      return rethrowAfterContextCheck(expectedContextId, error);
    }
  }

  async function savePairing(tokenValue, expectedEpoch) {
    const token = String(tokenValue ?? '').trim();
    if (!token) {
      throw new BridgeError('Pairing token is required', {
        code: 'not_paired',
        retryable: false,
      });
    }

    const connection = await connectionForToken(token);
    assertConnectionEpoch(expectedEpoch);
    await storePairingToken(token, expectedEpoch);
    return connection;
  }

  async function launchUrl(url) {
    try {
      // Chrome needs a foreground tab to present its external-app permission prompt.
      await chromeApi.tabs.create({ url, active: true });
    } catch (error) {
      throw launchFailedError(error);
    }
  }

  async function pollForHealth(attempt) {
    let lastError;
    const attempts = Math.max(1, Number(healthPollAttempts) || 1);
    for (let index = 0; index < attempts; index += 1) {
      try {
        return await bridge.health({ signal: attempt.controller.signal });
      } catch (error) {
        assertAttempt(attempt);
        if (error?.code === 'port_conflict' || error?.code === 'app_update_required') throw error;
        lastError = error;
      }
      if (index + 1 < attempts) await waitForAttempt(waitImpl(healthPollIntervalMs), attempt);
    }
    throw launchFailedError(lastError);
  }

  async function pairingCredentials() {
    const requestId = base64Url(randomBytesImpl(24));
    const verifier = base64Url(randomBytesImpl(32));
    const digest = await cryptoImpl.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(verifier),
    );
    return {
      requestId,
      verifier,
      challenge: base64Url(new Uint8Array(digest)),
    };
  }

  async function claimPairing(credentials, attempt) {
    let received = false;
    const attempts = Math.max(1, Number(pairingPollAttempts) || 1);
    for (let index = 0; index < attempts; index += 1) {
      assertAttempt(attempt);
      try {
        const result = await bridge.claimPairing({
          requestId: credentials.requestId, verifier: credentials.verifier,
        }, { signal: attempt.controller.signal });
        const token = typeof result?.token === 'string' ? result.token.trim() : '';
        if (!token) throw new BridgeError('Pairing claim returned no token', { code: 'invalid_response', retryable: true });
        return token;
      } catch (error) {
        assertAttempt(attempt);
        if (error?.code === 'pairing_pending') received = true;
        if (!['network_error', 'app_timeout', 'pairing_pending', 'pairing_not_found'].includes(error?.code)) throw error;
      }
      if (index + 1 < attempts) await waitForAttempt(waitImpl(pairingPollIntervalMs), attempt);
    }
    throw new BridgeError(received
      ? 'Pairing approval timed out. Try again and approve the request in On Paper, or pair manually.'
      : 'On Paper did not receive the connection request. Open the installed app and try again, or pair manually.', {
      code: received ? 'pairing_timeout' : 'pairing_not_received', retryable: true,
    });
  }

  async function pairAutomatically(attempt, runningHealth) {
    const credentials = await pairingCredentials();
    assertAttempt(attempt);
    let health = runningHealth;
    if (!health?.capabilities?.includes('pairing.request')) {
      const launch = new URL('resume-designer://companion/pair');
      for (const [key, value] of Object.entries({ protocolVersion: '2', requestId: credentials.requestId,
        challenge: credentials.challenge, clientId: chromeApi.runtime?.id || 'resume-designer-companion-extension' })) {
        launch.searchParams.set(key, value);
      }
      await waitForAttempt(launchUrl(launch.href), attempt);
      health = await pollForHealth(attempt);
    }
    assertAttempt(attempt);
    if (health.capabilities?.includes('pairing.request')) {
      await bridge.requestPairing({ protocolVersion: '2', requestId: credentials.requestId,
        challenge: credentials.challenge, clientId: chromeApi.runtime.id,
      }, { signal: attempt.controller.signal });
    }
    const token = await claimPairing(credentials, attempt);
    const connection = await connectionForToken(token, health, { signal: attempt.controller.signal });
    assertAttempt(attempt);
    await storePairingToken(token, attempt.epoch, attempt.controller.signal);
    return connection;
  }

  async function runOpening(attempt) {
    const token = String(await getStoredToken()).trim();
    let health;
    try { health = await bridge.health({ signal: attempt.controller.signal }); }
    catch (error) {
      assertAttempt(attempt);
      if (['port_conflict', 'app_update_required'].includes(error?.code)) throw error;
    }
    assertAttempt(attempt);
    if (!token) return pairAutomatically(attempt, health);
    if (!health) {
      await waitForAttempt(launchUrl(APP_OPEN_URL), attempt);
      health = await pollForHealth(attempt);
    }
    try { return await connectionForToken(token, health, { signal: attempt.controller.signal }); }
    catch (error) {
      assertAttempt(attempt);
      if (error?.code !== 'unauthorized') throw error;
      return pairAutomatically(attempt, health);
    }
  }

  async function openApp() {
    void cancelOpening();
    const attempt = { controller: new AbortController(), epoch: ++connectionEpoch };
    openingAttempt = attempt;
    let deadline;
    const timedOut = new Promise((_, reject) => {
      deadline = setTimeout(() => {
        reject(new BridgeError('Connection timed out. Open On Paper and try again, or pair manually.', {
          code: 'launch_failed', retryable: true,
        }));
        attempt.controller.abort();
      }, openingTimeoutMs);
    });
    try {
      const connection = await Promise.race([waitForAttempt(runOpening(attempt), attempt), timedOut]);
      assertAttempt(attempt);
      return connection;
    } catch (error) {
      if (error?.code === 'request_cancelled') throw cancelledError();
      throw error;
    } finally {
      clearTimeout(deadline);
      if (openingAttempt === attempt) openingAttempt = null;
    }
  }

  async function getActiveTab() {
    let tabs;
    try {
      tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
    } catch {
      throw lostActiveTabError();
    }

    const tab = tabs?.[0];
    if (!tab || typeof tab.id !== 'number' || typeof tab.url !== 'string' || !tab.url) {
      throw lostActiveTabError();
    }

    if (!isAllowedApplicationUrl(tab.url)) {
      throw restrictedPageError();
    }

    return tab;
  }

  function staleReviewError() {
    return new BridgeError('The application page changed. Return to the reviewed tab and prepare a new review.', {
      code: 'stale_review', retryable: true,
    });
  }

  async function assertReviewTab(page) {
    const tab = await getActiveTab();
    if (tab.id !== page.tabId || tab.url !== page.tabUrl) throw staleReviewError();
    return tab;
  }

  async function scanPage() {
    const tab = await getActiveTab();
    // Content deliberately strips query/hash from page.url. Keep that value
    // for content's job comparison; the full browser URL stays local to the
    // immutable review and is used only to reject navigation/tab changes.
    const page = { tabId: tab.id, tabUrl: tab.url };
    const result = await relayToActiveTab({ type: 'content.scan' }, undefined, undefined, page);
    await assertReviewTab(page);
    return { ...result, page: { ...result?.page, ...page } };
  }

  async function relayToActiveTab(message, beforeSend, expectedEpoch, expectedPage) {
    const tab = expectedPage ? await assertReviewTab(expectedPage) : await getActiveTab();

    try {
      await chromeApi.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      if (beforeSend) await beforeSend();
      if (expectedEpoch !== undefined) assertConnectionEpoch(expectedEpoch);
      if (expectedPage) await assertReviewTab(expectedPage);
      return await chromeApi.tabs.sendMessage(tab.id, message);
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      throw lostActiveTabError();
    }
  }

  function enqueuePdfFill({ fields, profileContextId, resumeId, expectedEpoch, reviewContext }) {
    const result = pdfQueue.then(async () => {
      assertConnectionEpoch(expectedEpoch);
      await assertReviewTab(reviewContext.page);
      const response = await withinProfileContext(profileContextId, async () => (
        assertResponseContext(profileContextId, await bridge.getPdf(resumeId))
      ));
      assertConnectionEpoch(expectedEpoch);
      const payload = {
        fields,
        reviewContext,
        pdf: { filename: response.filename, pdfBase64: response.pdfBase64 },
      };
      const fillResult = await relayToActiveTab(
        { type: 'content.fill', payload },
        () => assertProfileContext(profileContextId),
        expectedEpoch,
        reviewContext.page,
      );
      const filled = new Set(Array.isArray(fillResult?.filled) ? fillResult.filled : []);
      const attachments = fields
        .filter(({ field_id: fieldId, value }) => value === '__resume_pdf__' && filled.has(fieldId))
        .map(({ field_id: fieldId }) => ({ field_id: fieldId, filename: response.filename }));
      return { ...fillResult, attachments };
    });
    pdfQueue = result.catch(() => undefined);
    return result;
  }

  async function fillPage(message, expectedEpoch) {
    const fields = Array.isArray(message.fields) ? message.fields : [];
    const needsPdf = fields.some(({ value }) => value === '__resume_pdf__');
    const { reviewContext } = message;
    if (!reviewContext || !Number.isInteger(reviewContext.page?.tabId)
      || typeof reviewContext.page?.url !== 'string' || !reviewContext.page.url
      || typeof reviewContext.page?.tabUrl !== 'string' || !reviewContext.page.tabUrl
      || !Array.isArray(reviewContext.descriptors)) throw staleReviewError();
    const payload = { fields, reviewContext };
    const { profileContextId } = message;

    try {
      if (needsPdf) {
        return await enqueuePdfFill({
          fields, profileContextId, resumeId: message.resumeId, expectedEpoch, reviewContext,
        });
      }

      await assertProfileContext(profileContextId);
      return await relayToActiveTab(
        { type: 'content.fill', payload },
        () => assertProfileContext(profileContextId),
        expectedEpoch,
        reviewContext.page,
      );
    } catch (error) {
      return rethrowAfterContextCheck(profileContextId, error);
    }
  }

  async function hasPrivacyConsent() {
    const stored = await chromeApi.storage.local.get(CONSENT_KEY);
    return stored[CONSENT_KEY] === CONSENT_VERSION;
  }

  async function disconnect() {
    const cancelled = cancelOpening();
    // Invalidate work in every panel before waiting for the desktop app.
    connectionEpoch += 1;
    pendingDisconnects += 1;
    try {
      await cancelled;
      const token = await getStoredToken();
      let revoked = false;
      if (token) {
        try {
          await bridge.health();
          const result = await bridge.revokePairing();
          revoked = result?.ok === true;
        } catch {
          // Always forget this browser, but never claim the app revoked access
          // unless it acknowledged a durable token rotation.
        }
      }
      await chromeApi.storage.session.set({ [STORAGE_KEY]: '' });
      await chromeApi.storage.local.remove(CONSENT_KEY);
      return { disconnected: true, revoked };
    } finally {
      pendingDisconnects -= 1;
    }
  }

  async function handleMessage(message) {
    const expectedEpoch = connectionEpoch;
    if (message?.type === 'privacy.status') return { accepted: await hasPrivacyConsent() };
    if (message?.type === 'privacy.accept' && message.accepted === true) {
      await chromeApi.storage.local.set({ [CONSENT_KEY]: CONSENT_VERSION });
      return { accepted: true };
    }
    if (message?.type === 'pairing.disconnect') return disconnect();
    if (message?.type === 'pairing.cancel') return cancelOpening();
    if (message?.type === 'privacy.accept' || !(await hasPrivacyConsent())) {
      throw new BridgeError('Review and accept the data-use notice before continuing.', {
        code: 'consent_required', retryable: false,
      });
    }
    assertConnectionEpoch(expectedEpoch);
    switch (message?.type) {
      case 'connection.check':
        return probeConnection();
      case 'app.open':
        return openApp();
      case 'pairing.save':
        await cancelOpening();
        return savePairing(message.token, ++connectionEpoch);
      case 'resumes.list':
        return bridge.listResumes();
      case 'ai.models':
        return bridge.getAIModels();
      case 'page.scan':
        return scanPage();
      case 'mapping.create': {
        return withinProfileContext(message.profileContextId, async () => {
          const resume = assertResponseContext(
            message.profileContextId,
            await bridge.getResume(message.resumeId),
          );
          return requestMapping({
            descriptors: message.descriptors,
            resume,
            job: message.job,
            complete: (payload) => bridge.complete({
              ...payload,
              profileContextId: message.profileContextId,
              ...(message.model ? { model: message.model } : {}),
            }),
          });
        });
      }
      case 'page.fill':
        return fillPage(message, expectedEpoch);
      case 'answer.save':
        if (isSensitiveQuestion(message.question)) {
          throw new BridgeError('Answer sensitive questions directly on the application page.', {
            code: 'sensitive_field', retryable: false,
          });
        }
        return withinProfileMutation(message.profileContextId, () => bridge.saveAnswer({
          profileContextId: message.profileContextId,
          question: message.question,
          answer: message.answer,
        }));
      case 'application.log': {
        const payload = {
          profileContextId: message.profileContextId,
          variantId: message.variantId,
          company: message.company,
          title: message.title,
        };
        if (Object.prototype.hasOwnProperty.call(message, 'notes')) {
          payload.notes = message.notes;
        }
        return withinProfileMutation(
          message.profileContextId,
          () => bridge.logApplication(payload),
        );
      }
      case 'job.fit.analyze':
        return withinProfileContext(message.profileContextId, async () => (
          assertResponseContext(
            message.profileContextId,
            await bridge.analyzeJobFit({
              profileContextId: message.profileContextId,
              resumeId: message.resumeId,
              job: message.job,
              ...(message.model ? { model: message.model } : {}),
            }),
          )
        ));
      case 'resume.tailor':
        return withinProfileMutation(message.profileContextId, async () => (
          assertResponseContext(
            message.profileContextId,
            await bridge.createTailoredResume({
              profileContextId: message.profileContextId,
              resumeId: message.resumeId,
              requestId: message.requestId,
              job: message.job,
              ...(message.model ? { model: message.model } : {}),
            }),
          )
        ));
      default:
        throw new BridgeError(`Unsupported message type: ${message?.type ?? 'unknown'}`, {
          code: 'unsupported_message',
          retryable: false,
        });
    }
  }

  function runtimeListener(message, _sender, sendResponse) {
    if (!SUPPORTED_MESSAGES.has(message?.type)) return false;

    void handleMessage(message).then(
      (data) => sendResponse({ ok: true, data }),
      (error) => sendResponse({ ok: false, error: serializeError(error) }),
    );
    return true;
  }

  function actionListener(tab) {
    if (typeof tab?.windowId !== 'number') return;

    try {
      void chromeApi.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    } catch {
      // The toolbar action should remain harmless if the panel cannot open.
    }
  }

  function install() {
    if (installed) return;
    chromeApi.action.onClicked.addListener(actionListener);
    chromeApi.runtime.onMessage.addListener(runtimeListener);
    try {
      void chromeApi.storage.session?.setAccessLevel?.({
        accessLevel: 'TRUSTED_CONTEXTS',
      })?.catch?.(() => {});
    } catch {
      // Older Chromium builds may not expose storage access-level controls.
    }
    try {
      void chromeApi.storage.local?.remove?.(STORAGE_KEY)?.catch?.(() => {});
    } catch {
      // Legacy local credentials are best-effort cleanup only and are never migrated.
    }
    installed = true;
  }

  return {
    actionListener,
    handleMessage,
    install,
    runtimeListener,
  };
}

if (
  globalThis.chrome?.action?.onClicked
  && globalThis.chrome?.runtime?.onMessage
) {
  createBackgroundService({
    chromeApi: globalThis.chrome,
    fetchImpl: (...args) => globalThis.fetch(...args),
  }).install();
}
