import { useEffect, useRef, useState } from 'react';

import PairingView from './PairingView.jsx';
import ReviewList from './ReviewList.jsx';
import { buildFillPayload, buildReviewItems } from './reviewModel.js';
import { runtimeClient } from './runtimeClient.js';

const RUNNING_APP_ERROR_CODES = new Set([
  'app_timeout',
  'network_error',
  'app_unavailable',
  'runtime_unavailable',
]);

function visibleError(error) {
  const message = error instanceof Error && error.message
    ? error.message
    : 'An unexpected extension error occurred.';
  const asksAboutApp = RUNNING_APP_ERROR_CODES.has(error?.code) || error?.status === 504;

  if (asksAboutApp && !/is Resume Designer running\?/i.test(message)) {
    return `${message} Is Resume Designer running?`;
  }
  return message;
}

function connectedState(data) {
  const resumes = Array.isArray(data?.resumes) ? data.resumes : [];
  return data?.connected
    ? { kind: 'connected', resumes }
    : { kind: 'pairing', resumes: [] };
}

function WarningList({ items, heading }) {
  if (!items.length) return null;
  const headingId = `warning-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section className="result-block warning-block" aria-labelledby={headingId}>
      <h3 id={headingId}>{heading}</h3>
      <ul>
        {items.map((item) => (
          <li key={`${item.field_id}-${item.reason}`}>{item.label ? `${item.label}: ` : ''}{item.reason}</li>
        ))}
      </ul>
    </section>
  );
}

export default function App({ client = runtimeClient }) {
  const [connection, setConnection] = useState({ kind: 'loading', resumes: [] });
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [fillBusy, setFillBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [reviewItems, setReviewItems] = useState([]);
  const [localWarnings, setLocalWarnings] = useState([]);
  const [fillResult, setFillResult] = useState(null);
  const [retrySnapshot, setRetrySnapshot] = useState(null);
  const [savingAnswers, setSavingAnswers] = useState(() => new Set());
  const [savedAnswers, setSavedAnswers] = useState(() => new Set());
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [hasFilled, setHasFilled] = useState(false);
  const [logState, setLogState] = useState('idle');
  const logPending = useRef(false);

  useEffect(() => {
    let active = true;
    client.checkConnection().then(
      (data) => {
        if (!active) return;
        const next = connectedState(data);
        setConnection(next);
        setSelectedResumeId(next.resumes[0]?.id ?? '');
      },
      (error) => {
        if (!active) return;
        setRuntimeError(error);
        setConnection({ kind: 'pairing', resumes: [] });
      },
    );

    return () => {
      active = false;
    };
  }, [client]);

  function resetPostScanState() {
    setReviewItems([]);
    setLocalWarnings([]);
    setFillResult(null);
    setRetrySnapshot(null);
    setSavingAnswers(new Set());
    setSavedAnswers(new Set());
    setHasFilled(false);
    setLogState('idle');
    logPending.current = false;
  }

  async function handlePair(token) {
    setPairingBusy(true);
    setRuntimeError(null);
    try {
      const data = await client.savePairing(token);
      const next = connectedState(data);
      setConnection(next);
      setSelectedResumeId(next.resumes[0]?.id ?? '');
    } catch (error) {
      setRuntimeError(error);
    } finally {
      setPairingBusy(false);
    }
  }

  function handleResumeChange(event) {
    setSelectedResumeId(event.target.value);
    resetPostScanState();
  }

  async function handleScan() {
    setScanBusy(true);
    setRuntimeError(null);
    setScanResult(null);
    resetPostScanState();
    try {
      const result = await client.scanPage();
      setScanResult(result);
      setCompany(String(result?.page?.company ?? ''));
      setTitle(String(result?.page?.title ?? ''));
    } catch (error) {
      setRuntimeError(error);
    } finally {
      setScanBusy(false);
    }
  }

  async function handleCreateReview() {
    if (!scanResult || !selectedResumeId) return;
    setMappingBusy(true);
    setRuntimeError(null);
    setReviewItems([]);
    setSavingAnswers(new Set());
    setSavedAnswers(new Set());
    try {
      const mapping = await client.createMapping(selectedResumeId, scanResult.descriptors);
      setReviewItems(buildReviewItems(scanResult.descriptors, mapping));
      setLocalWarnings([]);
      setFillResult(null);
      setRetrySnapshot(null);
      setHasFilled(false);
      setLogState('idle');
    } catch (error) {
      setRuntimeError(error);
    } finally {
      setMappingBusy(false);
    }
  }

  function handleReviewChange(fieldId, value) {
    setReviewItems((current) => current.map((item) => (
      item.field_id === fieldId ? { ...item, value } : item
    )));
    setSavedAnswers((current) => {
      if (!current.has(fieldId)) return current;
      const next = new Set(current);
      next.delete(fieldId);
      return next;
    });
  }

  async function handleSaveAnswer(item) {
    const answer = item.value.trim();
    if (!answer || !item.question || item.manualFile) return;

    setRuntimeError(null);
    setSavingAnswers((current) => new Set(current).add(item.field_id));
    try {
      await client.saveAnswer(item.question, answer);
      setSavedAnswers((current) => new Set(current).add(item.field_id));
    } catch (error) {
      setRuntimeError(error);
    } finally {
      setSavingAnswers((current) => {
        const next = new Set(current);
        next.delete(item.field_id);
        return next;
      });
    }
  }

  async function performFill(snapshot) {
    setFillBusy(true);
    setRuntimeError(null);
    try {
      const result = await client.fillPage(snapshot.resumeId, snapshot.fields);
      setFillResult(result);
      setRetrySnapshot(null);
      setHasFilled(true);
    } catch (error) {
      setRuntimeError(error);
      setRetrySnapshot(error?.code === 'pdf_busy' ? snapshot : null);
    } finally {
      setFillBusy(false);
    }
  }

  function handleFill() {
    const { fields, warnings } = buildFillPayload(reviewItems);
    const snapshot = {
      resumeId: selectedResumeId,
      fields: fields.map((field) => ({ ...field })),
    };
    setLocalWarnings(warnings);
    void performFill(snapshot);
  }

  function handleRetryFill() {
    if (retrySnapshot) void performFill(retrySnapshot);
  }

  async function handleLogApplication() {
    if (logPending.current || logState === 'logged') return;
    logPending.current = true;
    setLogState('pending');
    setRuntimeError(null);

    try {
      await client.logApplication({
        variantId: selectedResumeId,
        company,
        title,
      });
      setLogState('logged');
    } catch (error) {
      setRuntimeError(error);
      setLogState('idle');
    } finally {
      logPending.current = false;
    }
  }

  const contentWarnings = (fillResult?.unfilled ?? []).map((item) => ({
    field_id: item.field_id,
    reason: item.reason,
  }));

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <h1>Resume Designer</h1>
        {connection.kind === 'connected' ? (
          <p className="connection-status connection-status--connected" role="status">Connected</p>
        ) : null}
      </header>

      {runtimeError ? <p className="error-message" role="alert">{visibleError(runtimeError)}</p> : null}

      {connection.kind === 'loading' ? (
        <p className="connection-status" role="status">Checking the local connection…</p>
      ) : null}

      {connection.kind === 'pairing' ? (
        <PairingView busy={pairingBusy} onPair={handlePair} />
      ) : null}

      {connection.kind === 'connected' ? (
        <>
          <section className="panel-section controls-section" aria-labelledby="resume-heading">
            <h2 id="resume-heading">Choose a résumé</h2>
            <label htmlFor="resume-picker">Résumé</label>
            <select
              id="resume-picker"
              value={selectedResumeId}
              onChange={handleResumeChange}
              disabled={scanBusy || mappingBusy || fillBusy}
            >
              {connection.resumes.map((resume) => (
                <option key={resume.id} value={resume.id}>{resume.name}</option>
              ))}
            </select>
            <div className="button-row">
              <button
                type="button"
                className="primary-button"
                disabled={!selectedResumeId || scanBusy}
                onClick={handleScan}
              >
                {scanBusy ? 'Scanning…' : 'Scan page'}
              </button>
              {scanResult ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!selectedResumeId || mappingBusy}
                  onClick={handleCreateReview}
                >
                  {mappingBusy ? 'Creating review…' : 'Create review'}
                </button>
              ) : null}
            </div>
          </section>

          {reviewItems.length ? (
            <>
              <ReviewList
                items={reviewItems}
                onChange={handleReviewChange}
                onSaveAnswer={handleSaveAnswer}
                savedAnswers={savedAnswers}
                savingAnswers={savingAnswers}
              />
              <button
                type="button"
                className="primary-button fill-button"
                disabled={fillBusy}
                onClick={handleFill}
              >
                {fillBusy ? 'Filling…' : 'Fill reviewed fields'}
              </button>
            </>
          ) : null}

          {retrySnapshot ? (
            <button
              type="button"
              className="secondary-button"
              disabled={fillBusy}
              onClick={handleRetryFill}
            >
              Retry fill
            </button>
          ) : null}

          <WarningList items={localWarnings} heading="Complete manually" />
          <WarningList items={contentWarnings} heading="Could not fill" />

          {hasFilled ? (
            <section className="panel-section log-section" aria-labelledby="log-heading">
              <h2 id="log-heading">Log application</h2>
              <label htmlFor="application-company">Company</label>
              <input
                id="application-company"
                type="text"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                disabled={logState !== 'idle'}
              />
              <label htmlFor="application-title">Role title</label>
              <input
                id="application-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={logState !== 'idle'}
              />
              <button
                type="button"
                className="primary-button"
                disabled={logState !== 'idle'}
                onClick={handleLogApplication}
              >
                {logState === 'pending'
                  ? 'Logging…'
                  : logState === 'logged'
                    ? 'Application logged'
                    : 'Log application'}
              </button>
              {logState === 'logged' ? <p className="success-message" role="status">Application logged.</p> : null}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
