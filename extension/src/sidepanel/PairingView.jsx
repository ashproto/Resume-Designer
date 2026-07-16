import { useState } from 'react';

export default function PairingView({ busy = false, onPair }) {
  const [token, setToken] = useState('');

  return (
    <section className="panel-section pairing-section" aria-labelledby="pairing-heading">
      <h2 id="pairing-heading">Pair this extension</h2>
      <p>Resume Designer must be running.</p>
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
        className="primary-button"
        disabled={busy || !token.trim()}
        onClick={() => onPair(token)}
      >
        {busy ? 'Pairing…' : 'Pair extension'}
      </button>
    </section>
  );
}
