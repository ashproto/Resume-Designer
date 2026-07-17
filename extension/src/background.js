import { BridgeError, createBridgeClient } from './bridgeClient.js';
import { requestMapping } from './mapping.js';

const STORAGE_KEY = 'bridgeToken';

const SUPPORTED_MESSAGES = new Set([
  'connection.check',
  'pairing.save',
  'resumes.list',
  'page.scan',
  'mapping.create',
  'page.fill',
  'answer.save',
  'application.log',
]);

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
    'This browser page is restricted. Open an HTTP(S) application page instead.',
    { code: 'restricted_page', retryable: false },
  );
}

function profileChangedError() {
  return new BridgeError(
    'Resume Designer reloaded or switched profiles. Review the refreshed résumé list and scan again.',
    { code: 'profile_changed', retryable: true },
  );
}

export function createBackgroundService({
  chromeApi = globalThis.chrome,
  fetchImpl = globalThis.fetch,
} = {}) {
  let installed = false;
  let pdfQueue = Promise.resolve();

  async function getStoredToken() {
    const stored = await chromeApi.storage.local.get(STORAGE_KEY);
    return stored[STORAGE_KEY] ?? '';
  }

  const bridge = createBridgeClient({ fetchImpl, getToken: getStoredToken });

  async function probeConnection() {
    const health = await bridge.health();
    const token = String(await getStoredToken()).trim();

    if (!token) {
      return {
        connected: false, health, profileId: null, profileContextId: null, resumes: [],
      };
    }

    const {
      profileId = null, profileContextId = null, resumes = [],
    } = await bridge.listResumes();
    return {
      connected: true, health, profileId, profileContextId, resumes,
    };
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

    await chromeApi.storage.local.set({ [STORAGE_KEY]: token });
    return probeConnection();
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

    if (!/^https?:\/\//i.test(tab.url)) {
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
      return relayToActiveTab(
        { type: 'content.fill', payload },
        () => assertProfileContext(profileContextId),
      );
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
