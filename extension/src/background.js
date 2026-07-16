import { BridgeError, createBridgeClient } from './bridgeClient.js';

const STORAGE_KEY = 'bridgeToken';

async function getStoredToken() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] ?? '';
}

const bridge = createBridgeClient({
  fetchImpl: (...args) => fetch(...args),
  getToken: getStoredToken,
});

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

  await chrome.storage.local.set({ [STORAGE_KEY]: token });
  return probeConnection();
}

async function handleMessage(message) {
  switch (message?.type) {
    case 'connection.check':
      return probeConnection();
    case 'pairing.save':
      return savePairing(message.token);
    case 'resumes.list':
      return bridge.listResumes();
    default:
      throw new BridgeError(`Unsupported message type: ${message?.type ?? 'unknown'}`, {
        code: 'unsupported_message',
        retryable: false,
      });
  }
}

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

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.windowId === 'number') {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

const supportedMessages = new Set(['connection.check', 'pairing.save', 'resumes.list']);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!supportedMessages.has(message?.type)) return false;

  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));

  return true;
});
