import { useState } from 'react';

export const DOWNLOAD_URL = 'https://github.com/ashproto/Resume-Designer/releases/latest';

const COPY = {
  needs_pairing: {
    heading: 'Connect Resume Designer',
    body: 'Open the desktop app and approve this extension to use your résumés and AI settings.',
    action: 'Open and connect',
  },
  unreachable: {
    heading: 'Resume Designer is required',
    body: 'Open the desktop app to continue. If it is not installed yet, download it first.',
    action: 'Open Resume Designer',
  },
  launch_failed: {
    heading: 'We couldn’t connect',
    body: 'Resume Designer may not be installed, may still be starting, or may need an update.',
    action: 'Try opening again',
  },
  incompatible: {
    heading: 'Update Resume Designer',
    body: 'This extension needs a newer compatible version of the desktop app.',
    action: 'Try again',
  },
};

export default function PairingView({
  state = 'needs_pairing',
  busy = false,
  onOpen,
  onRetry,
  onPair,
}) {
  const [token, setToken] = useState('');
  const copy = COPY[state] ?? COPY.unreachable;
  const primaryAction = state === 'incompatible' ? onRetry : onOpen;

  return (
    <section className="panel-section pairing-section" aria-labelledby="pairing-heading">
      <h2 id="pairing-heading">{copy.heading}</h2>
      <p>{copy.body}</p>
      <button
        type="button"
        className="primary-button"
        disabled={busy}
        onClick={primaryAction}
      >
        {busy ? 'Opening Resume Designer…' : copy.action}
      </button>
      <a className="download-link" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
        Download Resume Designer
      </a>
      {state === 'launch_failed' && onRetry ? (
        <button type="button" className="text-button" disabled={busy} onClick={onRetry}>
          Check connection again
        </button>
      ) : null}
      {state !== 'incompatible' ? (
        <details className="manual-pairing">
          <summary>Advanced: pair manually</summary>
          <p className="supporting-copy">
            In Resume Designer, open Settings, then Data, then Companion extension. Copy the
            pairing token and paste it here.
          </p>
          <label htmlFor="pairing-token">Pairing token</label>
          <input
            id="pairing-token"
            type="password"
            autoComplete="off"
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
            {busy ? 'Pairing…' : 'Pair with token'}
          </button>
        </details>
      ) : null}
    </section>
  );
}
