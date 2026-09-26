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
    const fields = message.payload?.fields ?? [];
    const context = message.payload?.reviewContext;
    const page = scrapePageContext(root, pageUrl(root));
    const samePage = context?.page && ['url', 'title', 'company', 'description', 'fingerprint']
      .every((key) => context.page[key] === page[key]);
    if (!samePage || !Array.isArray(context?.descriptors)) {
      return {
        filled: [],
        unfilled: fields.map(({ field_id }) => ({
          field_id, reason: 'The application page changed or its review expired; prepare a new review before filling.',
        })),
      };
    }
    return fillForm(fields, {
      root, pdf: message.payload?.pdf, expectedDescriptors: context.descriptors,
    });
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
