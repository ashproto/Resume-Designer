import { useState } from 'react';
import { isValidDesktopVersion } from '../bridgeClient.js';

export const DOWNLOAD_URL = 'https://github.com/ashproto/Resume-Designer/releases/latest';
const BETA_DOWNLOAD_URL = 'https://github.com/ashproto/Resume-Designer/releases/tag/next';
const RELEASES_URL = 'https://github.com/ashproto/Resume-Designer/releases';
const COMPANION_STORE_URL = 'https://chromewebstore.google.com/detail/on-paper-companion/keggfbelidgpjiapcbgkjidenhdjmega';

const COPY = {
  needs_pairing: {
    heading: 'Connect On Paper',
    body: 'Open the desktop app and approve this extension to use your resumes and AI settings.',
    action: 'Open and connect',
  },
  unreachable: {
    heading: 'On Paper is required',
    body: 'Open the desktop app to continue. If it is not installed yet, download it first.',
    action: 'Open On Paper',
  },
  launch_failed: {
    heading: 'We couldn’t connect',
    body: 'On Paper may still be starting. Check the connection or use the manual pairing steps below.',
    action: 'Try opening again',
  },
  unsupported_extension: {
    heading: 'Update Companion',
    body: 'This copy of Companion has an extension ID that On Paper does not recognize. Restarting the app won’t fix this. Install the official extension, or reload the current trusted build if you installed it manually.',
    action: 'Get official Companion',
  },
  incompatible: {
    heading: 'Update On Paper',
    body: 'This desktop app doesn’t support the features this version of Companion needs.',
  },
  opening: {
    heading: 'Connecting to On Paper',
    body: 'Approve the connection in the desktop app. If it does not open, cancel and use the manual pairing steps below.',
    action: 'Opening On Paper…',
  },
  checking: {
    heading: 'Checking On Paper',
    body: 'Checking whether the desktop app is available on this device.',
    action: 'Checking connection…',
  },
  reconnecting: {
    heading: 'Reconnecting to On Paper',
    body: 'Waiting for the desktop app to finish reloading. Your review stays here.',
    action: 'Open On Paper',
  },
};

export default function PairingView({
  state = 'needs_pairing',
  busy = false,
  operation = 'idle',
  onOpen,
  onRetry,
  onCancel,
  onPair,
  desktopVersion,
}) {
  const [token, setToken] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const copy = COPY[state] ?? COPY.unreachable;
  const detectedVersion = isValidDesktopVersion(desktopVersion) ? desktopVersion : '';
  const isBeta = detectedVersion.split('+')[0].includes('-');
  const updateUrl = !detectedVersion ? RELEASES_URL : isBeta ? BETA_DOWNLOAD_URL : DOWNLOAD_URL;
  const updateLabel = !detectedVersion ? 'View desktop releases' : isBeta ? 'View beta updates' : 'View desktop updates';
  const canCancel = state !== 'incompatible' && (operation === 'opening' || operation === 'checking' || operation === 'cancelling');

  async function cancelAndPairManually() {
    if (await onCancel()) setManualOpen(true);
  }

  return (
    <section className="panel-section pairing-section" aria-labelledby="pairing-heading">
      <h2 id="pairing-heading">{copy.heading}</h2>
      <p className="supporting-copy">{copy.body}</p>
      {state === 'incompatible' ? (
        <>
          <p className="supporting-copy compatibility-version">
            <strong>Detected desktop version</strong>
            {detectedVersion || 'Desktop version unavailable'}
          </p>
          <a className="primary-button" href={updateUrl} target="_blank" rel="noreferrer">
            {updateLabel}
          </a>
          <button type="button" className="secondary-button" disabled={busy} onClick={onRetry}>
            {operation === 'checking' ? 'Checking connection…' : 'Check connection again'}
          </button>
          <p className="supporting-copy">
            Install the update, reopen On Paper, then check the connection. If you’re already up to date,
            a compatible update may not have been released yet.
          </p>
        </>
      ) : state === 'unsupported_extension' ? (
        <a className="primary-button" href={COMPANION_STORE_URL} target="_blank" rel="noreferrer">
          {copy.action}
        </a>
      ) : (
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={onOpen}
        >
          {operation === 'cancelling'
            ? 'Cancelling…'
            : operation === 'checking' ? 'Checking connection…'
              : operation === 'opening' ? 'Opening On Paper…'
                : copy.action}
        </button>
      )}
      {canCancel && onCancel ? (
        <button type="button" className="secondary-button" disabled={operation === 'cancelling'} onClick={cancelAndPairManually}>
          {operation === 'cancelling' ? 'Cancelling connection…' : 'Cancel and pair manually'}
        </button>
      ) : null}
      {state !== 'incompatible' && onRetry ? (
        <button type="button" className="text-button" disabled={busy} onClick={onRetry}>
          Check connection again
        </button>
      ) : null}
      {state !== 'incompatible' ? (
        <details className="manual-pairing" open={manualOpen} onToggle={(event) => setManualOpen(event.currentTarget.open)}>
          <summary>Pair manually</summary>
          <p className="supporting-copy">
            In On Paper, open Settings, then Data, then Companion extension. Copy the
            pairing token and paste it here.
          </p>
          <label htmlFor="pairing-token">Pairing token</label>
          <input
            id="pairing-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !token.trim()}
            onClick={() => onPair(token)}
          >
            {operation === 'pairing' ? 'Pairing…' : 'Pair with token'}
          </button>
        </details>
      ) : null}
      {state !== 'incompatible' ? (
        <a className="download-link" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
          Download On Paper
        </a>
      ) : null}
    </section>
  );
}
