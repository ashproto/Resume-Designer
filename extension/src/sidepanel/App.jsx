import { useEffect, useState } from 'react';

const INITIAL_STATE = {
  kind: 'loading',
  message: 'Checking the local Resume Designer connection…',
};

function statusFromResponse(response) {
  if (response?.ok && response.data?.connected) {
    return { kind: 'connected', message: 'Connected to Resume Designer.' };
  }

  if (response?.ok) {
    return {
      kind: 'pairing',
      message: 'Resume Designer is running. Pairing setup arrives with the review workflow.',
    };
  }

  return {
    kind: 'pairing',
    message: 'Resume Designer must be running. Pairing setup arrives with the review workflow.',
  };
}

export default function App() {
  const [status, setStatus] = useState(INITIAL_STATE);

  useEffect(() => {
    let active = true;

    if (!globalThis.chrome?.runtime?.sendMessage) {
      setStatus(statusFromResponse(null));
      return () => {
        active = false;
      };
    }

    chrome.runtime.sendMessage({ type: 'connection.check' })
      .then((response) => {
        if (active) setStatus(statusFromResponse(response));
      })
      .catch(() => {
        if (active) setStatus(statusFromResponse(null));
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="panel-shell">
      <p className="eyebrow">Local companion</p>
      <h1>Resume Designer</h1>
      <p className={`connection-status connection-status--${status.kind}`} role="status">
        {status.message}
      </p>
      <p className="foundation-note">
        Review-first application tools will appear here in the complete workflow.
      </p>
    </main>
  );
}
