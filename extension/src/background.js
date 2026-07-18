import { BridgeError, createBridgeClient } from './bridgeClient.js';
import { requestMapping } from './mapping.js';

const STORAGE_KEY = 'bridgeToken';

const SUPPORTED_MESSAGES = new Set([
  'connection.check',
  'app.open',
  'pairing.save',
  'resumes.list',
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
    'Resume Designer reloaded or switched profiles. Review the refreshed résumé list and scan again.',
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
    'Could not open Resume Designer. Make sure the desktop app is installed.',
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
} = {}) {
  let installed = false;
  let pdfQueue = Promise.resolve();

  async function getStoredToken() {
    const stored = await chromeApi.storage.session.get(STORAGE_KEY);
    return stored[STORAGE_KEY] ?? '';
  }

  const bridge = createBridgeClient({ fetchImpl, getToken: getStoredToken });

  function bridgeForToken(token) {
    return createBridgeClient({ fetchImpl, getToken: async () => token });
  }

  async function connectionForToken(token, health) {
    const candidate = bridgeForToken(token);
    const checkedHealth = health ?? await candidate.health();
    const {
      profileId = null, profileContextId = null, resumes = [],
    } = await candidate.listResumes();
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
      throw new BridgeError('Resume Designer returned an invalid profile context', {
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

  async function savePairing(tokenValue) {
    const token = String(tokenValue ?? '').trim();
    if (!token) {
      throw new BridgeError('Pairing token is required', {
        code: 'not_paired',
        retryable: false,
      });
    }

    const connection = await connectionForToken(token);
    await chromeApi.storage.session.set({ [STORAGE_KEY]: token });
    return connection;
  }

  async function launchUrl(url) {
    try {
      await chromeApi.tabs.create({ url, active: false });
    } catch (error) {
      throw launchFailedError(error);
    }
  }

  async function pollForHealth() {
    let lastError;
    const attempts = Math.max(1, Number(healthPollAttempts) || 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await bridge.health();
      } catch (error) {
        if (error?.code === 'port_conflict' || error?.code === 'app_update_required') throw error;
        lastError = error;
      }
      if (attempt + 1 < attempts) await waitImpl(healthPollIntervalMs);
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

  async function claimPairing(credentials) {
    let lastError;
    const attempts = Math.max(1, Number(pairingPollAttempts) || 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await bridge.claimPairing({
          requestId: credentials.requestId,
          verifier: credentials.verifier,
        });
        const token = typeof result?.token === 'string' ? result.token.trim() : '';
        if (!token) {
          throw new BridgeError('Pairing claim returned no token', {
            code: 'invalid_response', retryable: true,
          });
        }
        return token;
      } catch (error) {
        if (error?.code === 'pairing_rejected') throw error;
        if (!['network_error', 'pairing_pending', 'pairing_not_found'].includes(error?.code)) {
          throw error;
        }
        lastError = error;
      }
      if (attempt + 1 < attempts) await waitImpl(pairingPollIntervalMs);
    }
    throw lastError ?? launchFailedError();
  }

  async function pairAutomatically() {
    const credentials = await pairingCredentials();
    const launch = new URL('resume-designer://companion/pair');
    launch.searchParams.set('protocolVersion', '2');
    launch.searchParams.set('requestId', credentials.requestId);
    launch.searchParams.set('challenge', credentials.challenge);
    launch.searchParams.set(
      'clientId',
      chromeApi.runtime?.id || 'resume-designer-companion-extension',
    );
    await launchUrl(launch.href);
    const health = await pollForHealth();
    const token = await claimPairing(credentials);
    const connection = await connectionForToken(token, health);
    await chromeApi.storage.session.set({ [STORAGE_KEY]: token });
    return connection;
  }

  async function openApp() {
    const token = String(await getStoredToken()).trim();
    if (!token) return pairAutomatically();

    await launchUrl(APP_OPEN_URL);
    const health = await pollForHealth();
    try {
      return await connectionForToken(token, health);
    } catch (error) {
      if (error?.code !== 'unauthorized') throw error;
      return pairAutomatically();
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

  async function relayToActiveTab(message, beforeSend) {
    const tab = await getActiveTab();

    try {
      await chromeApi.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      if (beforeSend) await beforeSend();
      return await chromeApi.tabs.sendMessage(tab.id, message);
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      throw lostActiveTabError();
    }
  }

  function enqueuePdfFill({ fields, profileContextId, resumeId }) {
    const result = pdfQueue.then(async () => {
      const response = await withinProfileContext(profileContextId, async () => (
        assertResponseContext(profileContextId, await bridge.getPdf(resumeId))
      ));
      const payload = {
        fields,
        pdf: { filename: response.filename, pdfBase64: response.pdfBase64 },
      };
      const fillResult = await relayToActiveTab(
        { type: 'content.fill', payload },
        () => assertProfileContext(profileContextId),
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

  async function fillPage(message) {
    const fields = Array.isArray(message.fields) ? message.fields : [];
    const needsPdf = fields.some(({ value }) => value === '__resume_pdf__');
    const payload = { fields };
    const { profileContextId } = message;

    try {
      if (needsPdf) {
        return await enqueuePdfFill({
          fields, profileContextId, resumeId: message.resumeId,
        });
      }

      await assertProfileContext(profileContextId);
      return await relayToActiveTab(
        { type: 'content.fill', payload },
        () => assertProfileContext(profileContextId),
      );
    } catch (error) {
      return rethrowAfterContextCheck(profileContextId, error);
    }
  }

  async function handleMessage(message) {
    switch (message?.type) {
      case 'connection.check':
        return probeConnection();
      case 'app.open':
        return openApp();
      case 'pairing.save':
        return savePairing(message.token);
      case 'resumes.list':
        return bridge.listResumes();
      case 'page.scan':
        return relayToActiveTab({ type: 'content.scan' });
      case 'mapping.create': {
        return withinProfileContext(message.profileContextId, async () => {
          const resume = assertResponseContext(
            message.profileContextId,
            await bridge.getResume(message.resumeId),
          );
          return requestMapping({
            descriptors: message.descriptors,
            resume,
            complete: (payload) => bridge.complete({
              ...payload,
              profileContextId: message.profileContextId,
            }),
          });
        });
      }
      case 'page.fill':
        return fillPage(message);
      case 'answer.save':
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
