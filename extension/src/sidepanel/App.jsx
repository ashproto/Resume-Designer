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

const PAIRING_ERROR_CODES = new Set(['not_paired', 'unauthorized']);
const RECONNECT_DELAY_MS = 500;

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
    ? {
      kind: 'connected',
      profileId: String(data?.profileId ?? ''),
      profileContextId: String(data?.profileContextId ?? ''),
      resumes,
    }
    : {
      kind: 'pairing', profileId: '', profileContextId: '', resumes: [],
    };
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
  const [connection, setConnection] = useState({
    kind: 'loading', profileId: '', profileContextId: '', resumes: [],
  });
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
  const [savedAnswers, setSavedAnswers] = useState(() => new Map());
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [hasFilled, setHasFilled] = useState(false);
  const [logState, setLogState] = useState('idle');
  const operationPending = useRef(null);
  const answerPending = useRef(new Set());
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
        setConnection({
          kind: error?.code === 'profile_changed' ? 'reconnecting' : 'pairing',
          profileId: '',
          profileContextId: '',
          resumes: [],
        });
      },
    );

    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    if (connection.kind !== 'reconnecting') return undefined;

    let active = true;
    let retryTimer;
    const retry = async () => {
      try {
        const data = await client.checkConnection();
        if (!active) return;
        const next = connectedState(data);
        setConnection(next);
        setSelectedResumeId(next.resumes[0]?.id ?? '');
      } catch (error) {
        if (!active) return;
        if (PAIRING_ERROR_CODES.has(error?.code) || error?.retryable === false) {
          setRuntimeError(error);
          setConnection({
            kind: 'pairing', profileId: '', profileContextId: '', resumes: [],
          });
          setSelectedResumeId('');
          return;
        }
        retryTimer = setTimeout(retry, RECONNECT_DELAY_MS);
      }
    };

    retryTimer = setTimeout(retry, RECONNECT_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(retryTimer);
    };
  }, [client, connection.kind]);

  function resetPostScanState() {
    setReviewItems([]);
    setLocalWarnings([]);
    setFillResult(null);
    setRetrySnapshot(null);
    setSavingAnswers(new Set());
    setSavedAnswers(new Map());
    setHasFilled(false);
    setLogState('idle');
  }

  function resetProfileScopedState() {
    setScanResult(null);
    setCompany('');
    setTitle('');
    resetPostScanState();
  }

  async function handleWorkflowError(error) {
    setRuntimeError(error);
    if (PAIRING_ERROR_CODES.has(error?.code)) {
      resetProfileScopedState();
      setConnection({
        kind: 'pairing', profileId: '', profileContextId: '', resumes: [],
      });
      setSelectedResumeId('');
      return;
    }
    if (error?.code !== 'profile_changed') return;

    resetProfileScopedState();
    try {
      const data = await client.checkConnection();
      const next = connectedState(data);
      setConnection(next);
      setSelectedResumeId(next.resumes[0]?.id ?? '');
    } catch (refreshError) {
      if (PAIRING_ERROR_CODES.has(refreshError?.code) || refreshError?.retryable === false) {
        setRuntimeError(refreshError);
        setConnection({
          kind: 'pairing', profileId: '', profileContextId: '', resumes: [],
        });
      } else {
        setConnection({
          kind: 'reconnecting', profileId: '', profileContextId: '', resumes: [],
        });
      }
      setSelectedResumeId('');
    }
  }

  function hasPendingInteraction() {
    return operationPending.current !== null
      || answerPending.current.size > 0
      || logPending.current;
  }

  function beginOperation(name) {
    if (hasPendingInteraction()) return false;
    operationPending.current = name;
    return true;
  }

  function finishOperation(name) {
    if (operationPending.current === name) operationPending.current = null;
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
    if (!beginOperation('resume-change')) return;
    setSelectedResumeId(event.target.value);
    resetPostScanState();
    queueMicrotask(() => finishOperation('resume-change'));
  }

  async function handleScan() {
    if (!beginOperation('scan')) return;
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
      finishOperation('scan');
    }
  }

  async function handleCreateReview() {
    if (!scanResult || !selectedResumeId) return;
    if (!beginOperation('mapping')) return;
    setMappingBusy(true);
    setRuntimeError(null);
    setReviewItems([]);
    setSavingAnswers(new Set());
    setSavedAnswers(new Map());
    try {
      const mapping = await client.createMapping(
        connection.profileContextId,
        selectedResumeId,
        scanResult.descriptors,
      );
      setReviewItems(buildReviewItems(scanResult.descriptors, mapping));
      setLocalWarnings([]);
      setFillResult(null);
      setRetrySnapshot(null);
      setHasFilled(false);
      setLogState('idle');
    } catch (error) {
      await handleWorkflowError(error);
    } finally {
      setMappingBusy(false);
      finishOperation('mapping');
    }
  }

  function handleReviewChange(fieldId, value) {
    if (hasPendingInteraction()) return;
    setReviewItems((current) => current.map((item) => (
      item.field_id === fieldId ? { ...item, value } : item
    )));
  }

  async function handleSaveAnswer(item) {
    const answer = item.value.trim();
    if (!answer || !item.question || item.manualFile) return;
    if (hasPendingInteraction()) return;

    answerPending.current.add(item.field_id);
    setRuntimeError(null);
    setSavingAnswers((current) => new Set(current).add(item.field_id));
    try {
      await client.saveAnswer(connection.profileContextId, item.question, answer);
      setSavedAnswers((current) => {
        const next = new Map(current);
        next.set(item.field_id, answer);
        return next;
      });
    } catch (error) {
      await handleWorkflowError(error);
    } finally {
      setSavingAnswers((current) => {
        const next = new Set(current);
        next.delete(item.field_id);
        return next;
      });
      answerPending.current.delete(item.field_id);
    }
  }

  async function performFill(snapshot) {
    if (!beginOperation('fill')) return;
    setFillBusy(true);
    setRuntimeError(null);
    try {
      const result = await client.fillPage(
        snapshot.profileContextId,
        snapshot.resumeId,
        snapshot.fields,
      );
      setFillResult(result);
      setRetrySnapshot(null);
      setHasFilled(true);
    } catch (error) {
      await handleWorkflowError(error);
      setRetrySnapshot(error?.code === 'pdf_busy' ? snapshot : null);
    } finally {
      setFillBusy(false);
      finishOperation('fill');
    }
  }

  function handleFill() {
    const { fields, warnings } = buildFillPayload(reviewItems);
    const snapshot = {
      profileContextId: connection.profileContextId,
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
    if (hasPendingInteraction() || logState === 'logged') return;
    logPending.current = true;
    setLogState('pending');
    setRuntimeError(null);

    try {
      await client.logApplication({
        profileContextId: connection.profileContextId,
        variantId: selectedResumeId,
        company,
        title,
      });
      setLogState('logged');
    } catch (error) {
      await handleWorkflowError(error);
      setLogState('idle');
    } finally {
      logPending.current = false;
    }
  }

  const contentWarnings = (fillResult?.unfilled ?? []).map((item) => ({
    field_id: item.field_id,
    label: reviewItems.find((reviewItem) => reviewItem.field_id === item.field_id)?.label,
    reason: item.reason,
  }));
  const workflowBusy = scanBusy
    || mappingBusy
    || fillBusy
    || logState === 'pending'
    || savingAnswers.size > 0;

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

      {connection.kind === 'reconnecting' ? (
        <p className="connection-status" role="status">Reconnecting after Resume Designer reloads…</p>
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
              disabled={workflowBusy}
            >
              {connection.resumes.map((resume) => (
                <option key={resume.id} value={resume.id}>{resume.name}</option>
              ))}
            </select>
            <div className="button-row">
              <button
                type="button"
                className="primary-button"
                disabled={!selectedResumeId || workflowBusy}
                onClick={handleScan}
              >
                {scanBusy ? 'Scanning…' : 'Scan page'}
              </button>
              {scanResult ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!selectedResumeId || workflowBusy}
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
                disabled={workflowBusy}
              />
              <button
                type="button"
                className="primary-button fill-button"
                disabled={workflowBusy}
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
              disabled={workflowBusy}
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
                onChange={(event) => {
                  if (!hasPendingInteraction()) setCompany(event.target.value);
                }}
                disabled={workflowBusy || logState !== 'idle'}
              />
              <label htmlFor="application-title">Role title</label>
              <input
                id="application-title"
                type="text"
                value={title}
                onChange={(event) => {
                  if (!hasPendingInteraction()) setTitle(event.target.value);
                }}
                disabled={workflowBusy || logState !== 'idle'}
              />
              <button
                type="button"
                className="primary-button"
                disabled={workflowBusy || logState !== 'idle'}
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
