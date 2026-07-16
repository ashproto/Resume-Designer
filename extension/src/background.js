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
      return { connected: false, health, resumes: [] };
    }

    const { resumes = [] } = await bridge.listResumes();
    return { connected: true, health, resumes };
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

  async function relayToActiveTab(message) {
    const tab = await getActiveTab();

    try {
      await chromeApi.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      return await chromeApi.tabs.sendMessage(tab.id, message);
    } catch {
      throw lostActiveTabError();
    }
  }

  function enqueuePdf(resumeId) {
    const result = pdfQueue.then(() => bridge.getPdf(resumeId));
    pdfQueue = result.catch(() => undefined);
    return result;
  }

  async function fillPage(message) {
    const fields = Array.isArray(message.fields) ? message.fields : [];
    const needsPdf = fields.some(({ value }) => value === '__resume_pdf__');
    const payload = { fields };

    if (needsPdf) {
      payload.pdf = await enqueuePdf(message.resumeId);
    }

    return relayToActiveTab({ type: 'content.fill', payload });
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
        const resume = await bridge.getResume(message.resumeId);
        return requestMapping({
          descriptors: message.descriptors,
          resume,
          complete: bridge.complete,
        });
      }
      case 'page.fill':
        return fillPage(message);
      case 'answer.save':
        return bridge.saveAnswer({
          question: message.question,
          answer: message.answer,
        });
      case 'application.log': {
        const payload = {
          variantId: message.variantId,
          company: message.company,
          title: message.title,
        };
        if (Object.prototype.hasOwnProperty.call(message, 'notes')) {
          payload.notes = message.notes;
        }
        return bridge.logApplication(payload);
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
