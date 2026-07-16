import { fillForm } from './content/fill.js';
import { scanForm, scrapePageContext } from './content/scan.js';

const INSTALL_MARKER = '__resumeDesignerCompanionContentInstalled';

function pageUrl(root) {
  return root.location?.href
    || root.ownerDocument?.defaultView?.location?.href
    || location.href;
}

function relayMessage(message, root = document) {
  if (message?.type === 'content.scan') {
    return {
      descriptors: scanForm(root),
      page: scrapePageContext(root, pageUrl(root)),
    };
  }

  if (message?.type === 'content.fill') {
    return fillForm(message.payload?.fields, { root, pdf: message.payload?.pdf });
  }

  return undefined;
}

function onMessage(message, _sender, sendResponse) {
  const response = relayMessage(message);
  if (response !== undefined) sendResponse(response);
  return false;
}

if (!globalThis[INSTALL_MARKER] && globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(onMessage);
  Object.defineProperty(globalThis, INSTALL_MARKER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
