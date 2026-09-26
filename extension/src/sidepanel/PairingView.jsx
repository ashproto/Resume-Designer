import { useState } from 'react';

export const DOWNLOAD_URL = 'https://github.com/ashproto/Resume-Designer/releases/latest';

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
  incompatible: {
    heading: 'Update On Paper',
    body: 'This extension needs a newer compatible version of the desktop app.',
    action: 'Check connection again',
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
}) {
  const [token, setToken] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const copy = COPY[state] ?? COPY.unreachable;
  const primaryAction = state === 'incompatible' ? onRetry : onOpen;
  const canCancel = operation === 'opening' || operation === 'checking' || operation === 'cancelling';

  async function cancelAndPairManually() {
    if (await onCancel()) setManualOpen(true);
  }

  return (
    <section className="panel-section pairing-section" aria-labelledby="pairing-heading">
      <h2 id="pairing-heading">{copy.heading}</h2>
      <p className="supporting-copy">{copy.body}</p>
      <button
        type="button"
        className="primary-button"
        disabled={busy}
        onClick={primaryAction}
      >
        {operation === 'cancelling'
          ? 'Cancelling…'
          : operation === 'checking' ? 'Checking connection…'
            : operation === 'opening' ? 'Opening On Paper…'
              : copy.action}
      </button>
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
      <a className="download-link" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
        Download On Paper
      </a>
    </section>
  );
}
