import { useCallback, useEffect, useRef, useState } from 'react';

import PairingView from './PairingView.jsx';
import ReviewList from './ReviewList.jsx';
import { buildFillPayload, buildReviewItems } from './reviewModel.js';
import { runtimeClient } from './runtimeClient.js';
import { isSensitiveDescriptor } from '../sensitivity.js';

const RUNNING_APP_ERROR_CODES = new Set([
  'app_timeout',
  'network_error',
  'app_unavailable',
  'runtime_unavailable',
]);

const PAIRING_ERROR_CODES = new Set(['not_paired', 'unauthorized']);
const INCOMPATIBLE_ERROR_CODES = new Set([
  'app_update_required',
  'incompatible_protocol',
  'incompatible_app',
]);
const LAUNCH_ERROR_CODES = new Set(['launch_failed', 'port_conflict']);
const RECONNECT_DELAY_MS = 500;
const DEFAULT_HEARTBEAT_MS = 5_000;

function visibleError(error) {
  const message = error instanceof Error && error.message
    ? error.message
    : 'An unexpected extension error occurred.';
  const asksAboutApp = RUNNING_APP_ERROR_CODES.has(error?.code) || error?.status === 504;

  if (asksAboutApp && !/is On Paper running\?/i.test(message)) {
    return `${message} Is On Paper running?`;
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
      kind: 'needs_pairing', profileId: '', profileContextId: '', resumes: [],
    };
}

function stateForError(error, previous = {}) {
  let kind = 'launch_failed';
  if (error?.code === 'profile_changed') kind = 'reconnecting';
  else if (PAIRING_ERROR_CODES.has(error?.code)) kind = 'needs_pairing';
  else if (INCOMPATIBLE_ERROR_CODES.has(error?.code)) kind = 'incompatible';
  else if (RUNNING_APP_ERROR_CODES.has(error?.code) || error?.status === 504) kind = 'unreachable';
  else if (LAUNCH_ERROR_CODES.has(error?.code)) kind = 'launch_failed';

  return {
    kind,
    profileId: String(previous.profileId ?? ''),
    profileContextId: String(previous.profileContextId ?? ''),
    resumes: Array.isArray(previous.resumes) ? previous.resumes : [],
  };
}

function samePage(left, right) {
  return Boolean(left?.url)
    && left.url === right?.url
    && Boolean(left?.fingerprint)
    && left.fingerprint === right?.fingerprint;
}

function jobFromPage(page, manualDescription = '') {
  return {
    company: String(page?.company ?? ''),
    title: String(page?.title ?? ''),
    description: String(page?.description || manualDescription).trim(),
  };
}

async function createReviewItems(client, profileContextId, resumeId, descriptors, options) {
  const supportedDescriptors = descriptors.filter((descriptor) => descriptor?.type !== 'custom' && !isSensitiveDescriptor(descriptor));
  const mapping = supportedDescriptors.length > 0
    ? await client.createMapping(profileContextId, resumeId, supportedDescriptors, options)
    : { fields: [], needs_human: [] };
  const needsHuman = Array.isArray(mapping?.needs_human) ? mapping.needs_human : [];
  const manualCustomFields = descriptors
    .filter((descriptor) => descriptor?.type === 'custom')
    .map((descriptor) => ({
      field_id: descriptor.field_id,
      question: 'Complete this field on the application page.',
    }));

  return buildReviewItems(descriptors, {
    fields: Array.isArray(mapping?.fields) ? mapping.fields : [],
    needs_human: [...needsHuman, ...manualCustomFields],
  });
}

function defaultRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function analysisItemText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return String(item ?? '');
  return [
    item.area,
    item.issue,
    item.suggestion,
    item.section,
    item.suggested,
    item.reason,
  ].map((value) => String(value ?? '').trim()).filter(Boolean).join(' — ');
}

function AnalysisList({ heading, items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <>
      <p className="field-label">{heading}</p>
      <ul>
        {items.map((item, index) => {
          const text = analysisItemText(item);
          return <li key={`${heading}-${index}-${text}`}>{text}</li>;
        })}
      </ul>
    </>
  );
}

function FitAnalysis({ analysis }) {
  if (!analysis) return null;
  return (
    <section className="result-block fit-result" aria-labelledby="fit-result-heading">
      <h3 id="fit-result-heading">{Number(analysis.matchScore)}% match</h3>
      <AnalysisList heading="Strengths" items={analysis.strengths} />
      <AnalysisList heading="Gaps" items={analysis.gaps} />
      <AnalysisList heading="Missing keywords" items={analysis.missingKeywords} />
      <AnalysisList heading="Recommendations" items={analysis.recommendations} />
    </section>
  );
}

function readyReviewStatus(items) {
  const fieldCount = items.length;
  const manualOnly = (item) => item.manualFile || item.manualCustom || item.manualSensitive;
  const manualCount = items.filter(manualOnly).length;
  const unansweredCount = items.filter((item) => !manualOnly(item) && item.needsHuman && !item.value.trim()).length;
  const fields = `${fieldCount} ${fieldCount === 1 ? 'field' : 'fields'}`;

  const details = [];
  if (manualCount) details.push(`${manualCount} ${manualCount === 1 ? 'requires' : 'require'} manual entry`);
  if (unansweredCount) details.push(`${unansweredCount} ${unansweredCount === 1 ? 'needs' : 'need'} your answer`);
  return `Review ready — ${fields}${details.length ? `; ${details.join('; ')}` : ''}.`;
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

function Workspace({
  client = runtimeClient,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  createRequestId = defaultRequestId,
  onDisconnected,
}) {
  const [connection, setConnection] = useState({
    kind: 'checking', profileId: '', profileContextId: '', resumes: [],
  });
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [modelCatalog, setModelCatalog] = useState({ state: 'loading', models: [], defaults: {}, autoFallback: false, error: '' });
  const [modelLoadAttempt, setModelLoadAttempt] = useState(0);
  const [workflow, setWorkflow] = useState('autofill');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingAction, setPairingAction] = useState('idle');
  const [scanBusy, setScanBusy] = useState(false);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [fillBusy, setFillBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState(null);
  const [reviewStatus, setReviewStatus] = useState('');
  const [pendingReview, setPendingReview] = useState(null);
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewContext, setReviewContext] = useState(null);
  const [localWarnings, setLocalWarnings] = useState([]);
  const [fillResult, setFillResult] = useState(null);
  const [retrySnapshot, setRetrySnapshot] = useState(null);
  const [savingAnswers, setSavingAnswers] = useState(() => new Set());
  const [savedAnswers, setSavedAnswers] = useState(() => new Map());
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [hasFilled, setHasFilled] = useState(false);
  const [logState, setLogState] = useState('idle');
  const [reviewNeedsRefresh, setReviewNeedsRefresh] = useState(false);
  const [fillAnnouncement, setFillAnnouncement] = useState('');
  const [jobDraft, setJobDraft] = useState(null);
  const [manualJobDescription, setManualJobDescription] = useState('');
  const [jobAction, setJobAction] = useState('idle');
  const [jobActionStatus, setJobActionStatus] = useState('');
  const [fitAnalysis, setFitAnalysis] = useState(null);
  const operationPending = useRef(null);
  const answerPending = useRef(new Set());
  const logPending = useRef(false);
  const heartbeatPending = useRef(false);
  const tailoringRequest = useRef(null);
  const pairingGeneration = useRef(0);
  const pairingAttempt = useRef(null);

  const resetPostScanState = useCallback(() => {
    setReviewStatus('');
    setPendingReview(null);
    setReviewItems([]);
    setReviewContext(null);
    setLocalWarnings([]);
    setFillResult(null);
    setRetrySnapshot(null);
    setSavingAnswers(new Set());
    setSavedAnswers(new Map());
    setHasFilled(false);
    setLogState('idle');
    setReviewNeedsRefresh(false);
    setFillAnnouncement('');
  }, []);

  const resetProfileScopedState = useCallback(() => {
    setCompany('');
    setTitle('');
    setJobDraft(null);
    setManualJobDescription('');
    setFitAnalysis(null);
    setJobActionStatus('');
    tailoringRequest.current = null;
    resetPostScanState();
  }, [resetPostScanState]);

  useEffect(() => {
    let active = true;
    const generation = ++pairingGeneration.current;
    client.checkConnection().then(
      (data) => {
        if (!active || generation !== pairingGeneration.current) return;
        const next = connectedState(data);
        setConnection(next);
        setSelectedResumeId(next.resumes[0]?.id ?? '');
      },
      (error) => {
        if (!active || generation !== pairingGeneration.current) return;
        setRuntimeError(error);
        setConnection(stateForError(error));
      },
    );

    return () => {
      active = false;
      pairingGeneration.current += 1;
    };
  }, [client]);

  useEffect(() => {
    if (connection.kind !== 'connected') return undefined;
    let active = true;
    Promise.resolve().then(() => client.getAIModels()).then(
      (catalog) => {
        if (!active) return;
        setModelCatalog({
          state: 'ready',
          models: Array.isArray(catalog?.models) ? catalog.models : [],
          defaults: catalog?.defaults ?? {},
          autoFallback: catalog?.autoFallback === true,
          error: '',
        });
      },
      (error) => {
        if (!active) return;
        setModelCatalog((current) => ({
          ...current,
          state: error?.status === 404 || typeof client.getAIModels !== 'function' ? 'legacy' : 'unavailable',
          error: visibleError(error),
        }));
      },
    );
    return () => { active = false; };
  }, [client, connection.kind, connection.profileContextId, modelLoadAttempt]);

  useEffect(() => {
    if (connection.kind !== 'reconnecting') return undefined;

    let active = true;
    const generation = pairingGeneration.current;
    let retryTimer;
    const retry = async () => {
      try {
        const data = await client.checkConnection();
        if (!active || generation !== pairingGeneration.current) return;
        const next = connectedState(data);
        if (
          connection.profileContextId
          && next.profileContextId
          && connection.profileContextId !== next.profileContextId
        ) {
          resetProfileScopedState();
        }
        setConnection(next);
        setSelectedResumeId(next.resumes[0]?.id ?? '');
        setRuntimeError(null);
      } catch (error) {
        if (!active || generation !== pairingGeneration.current) return;
        if (PAIRING_ERROR_CODES.has(error?.code) || error?.retryable === false) {
          setRuntimeError(error);
          setConnection(stateForError(error, connection));
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
  }, [client, connection, resetProfileScopedState]);

  useEffect(() => {
    if (connection.kind !== 'connected' || heartbeatMs <= 0) return undefined;
    let active = true;
    const generation = pairingGeneration.current;
    const contextAtStart = connection.profileContextId;
    const timer = setInterval(async () => {
      if (
        heartbeatPending.current
        || operationPending.current !== null
        || answerPending.current.size > 0
        || logPending.current
      ) return;
      heartbeatPending.current = true;
      try {
        const data = await client.checkConnection();
        if (!active || generation !== pairingGeneration.current) return;
        const next = connectedState(data);
        if (next.kind !== 'connected') {
          setReviewNeedsRefresh(true);
          setConnection(next);
          return;
        }
        if (
          contextAtStart
          && next.profileContextId
          && contextAtStart !== next.profileContextId
        ) {
          resetProfileScopedState();
          setSelectedResumeId(next.resumes[0]?.id ?? '');
        } else {
          setSelectedResumeId((current) => (
            next.resumes.some((resume) => resume.id === current)
              ? current
              : next.resumes[0]?.id ?? ''
          ));
        }
        setConnection(next);
        setRuntimeError(null);
      } catch (error) {
        if (!active || generation !== pairingGeneration.current) return;
        setRuntimeError(error);
        setReviewNeedsRefresh(true);
        setConnection((current) => stateForError(error, current));
      } finally {
        heartbeatPending.current = false;
      }
    }, heartbeatMs);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client, connection.kind, connection.profileContextId, heartbeatMs, resetProfileScopedState]);

  async function handleWorkflowError(error) {
    setRuntimeError(error);
    if (error?.code === 'stale_review') {
      setReviewNeedsRefresh(true);
      return;
    }
    if (PAIRING_ERROR_CODES.has(error?.code)) {
      resetProfileScopedState();
      setConnection({
        kind: 'needs_pairing', profileId: '', profileContextId: '', resumes: [],
      });
      setSelectedResumeId('');
      return;
    }
    if (
      RUNNING_APP_ERROR_CODES.has(error?.code)
      || INCOMPATIBLE_ERROR_CODES.has(error?.code)
      || LAUNCH_ERROR_CODES.has(error?.code)
      || error?.status === 504
    ) {
      setReviewNeedsRefresh(true);
      setConnection((current) => stateForError(error, current));
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
        setConnection(stateForError(refreshError));
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

  async function connect({ launch = false } = {}) {
    if (pairingAttempt.current) return null;
    const previous = connection;
    const generation = ++pairingGeneration.current;
    const isCurrent = () => generation === pairingGeneration.current;
    pairingAttempt.current = { generation, previous };
    setRuntimeError(null);
    setPairingBusy(true);
    setPairingAction(launch ? 'opening' : 'checking');
    setConnection({ ...previous, kind: launch ? 'opening' : 'checking' });
    try {
      const opened = launch ? await client.openApp() : null;
      if (!isCurrent()) return null;
      const data = opened?.connected ? opened : await client.checkConnection();
      if (!isCurrent()) return null;
      const next = connectedState(data);
      if (next.kind !== 'connected') {
        setConnection(next);
        return null;
      }
      const contextChanged = Boolean(
        previous.profileContextId
        && next.profileContextId
        && previous.profileContextId !== next.profileContextId
      );
      if (contextChanged) resetProfileScopedState();
      setConnection(next);
      setSelectedResumeId((current) => (
        !contextChanged && next.resumes.some((resume) => resume.id === current)
          ? current
          : next.resumes[0]?.id ?? ''
      ));
      return { connection: next, contextChanged };
    } catch (error) {
      if (!isCurrent()) return null;
      setRuntimeError(error);
      setConnection(stateForError(error, previous));
      return null;
    } finally {
      if (isCurrent()) {
        pairingAttempt.current = null;
        setPairingBusy(false);
        setPairingAction('idle');
      }
    }
  }

  function openAndReconnect() {
    return connect({ launch: true });
  }

  function checkConnectionAgain() {
    return connect();
  }

  async function handleCancelPairing() {
    const active = pairingAttempt.current;
    if (!active || pairingAction === 'cancelling') return false;
    const generation = ++pairingGeneration.current;
    pairingAttempt.current = { ...active, generation };
    setPairingAction('cancelling');
    try {
      await client.cancelPairing();
      if (generation !== pairingGeneration.current) return false;
      setRuntimeError(null);
      setConnection({ ...active.previous, kind: 'needs_pairing' });
      return true;
    } catch (error) {
      if (generation !== pairingGeneration.current) return false;
      setRuntimeError(error);
      setConnection({ ...active.previous, kind: 'launch_failed' });
      return false;
    } finally {
      if (generation === pairingGeneration.current) {
        pairingAttempt.current = null;
        setPairingBusy(false);
        setPairingAction('idle');
      }
    }
  }

  async function connectionForAction() {
    if (connection.kind === 'connected') {
      return { connection, contextChanged: false };
    }
    return openAndReconnect();
  }

  async function handleDisconnect() {
    if (!beginOperation('disconnect')) return;
    setPairingBusy(true);
    setRuntimeError(null);
    try {
      const result = await client.disconnect();
      onDisconnected(result);
    } catch (error) {
      setRuntimeError(error);
    } finally {
      setPairingBusy(false);
      finishOperation('disconnect');
    }
  }

  async function handlePair(token) {
    if (pairingAttempt.current) return;
    const generation = ++pairingGeneration.current;
    pairingAttempt.current = { generation, previous: connection };
    setPairingBusy(true);
    setPairingAction('pairing');
    setConnection((current) => ({ ...current, kind: 'needs_pairing' }));
    setRuntimeError(null);
    try {
      const data = await client.savePairing(token);
      if (generation !== pairingGeneration.current) return;
      const next = connectedState(data);
      if (connection.profileContextId !== next.profileContextId) resetProfileScopedState();
      setConnection(next);
      setSelectedResumeId(next.resumes[0]?.id ?? '');
      setRuntimeError(null);
    } catch (error) {
      if (generation === pairingGeneration.current) setRuntimeError(error);
    } finally {
      if (generation === pairingGeneration.current) {
        pairingAttempt.current = null;
        setPairingBusy(false);
        setPairingAction('idle');
      }
    }
  }

  function handleResumeChange(event) {
    if (!beginOperation('resume-change')) return;
    setSelectedResumeId(event.target.value);
    setFitAnalysis(null);
    setJobActionStatus('');
    tailoringRequest.current = null;
    resetPostScanState();
    queueMicrotask(() => finishOperation('resume-change'));
  }

  function handleModelChange(event) {
    if (!beginOperation('model-change')) return;
    setSelectedModel(event?.target?.value ?? '');
    setModelSearch('');
    setFitAnalysis(null);
    setJobActionStatus('');
    tailoringRequest.current = null;
    resetPostScanState();
    queueMicrotask(() => finishOperation('model-change'));
  }

  function handleRetryModels() {
    if (modelCatalog.state === 'loading') return;
    setModelCatalog((current) => ({ ...current, state: 'loading', error: '' }));
    setModelLoadAttempt((current) => current + 1);
  }

  async function prepareReview({
    activeConnection,
    activeResumeId,
    forceFresh = false,
    successPrefix = '',
  }) {
    let snapshot = forceFresh ? null : pendingReview;

    setRuntimeError(null);
    if (snapshot) {
      setScanBusy(false);
      setMappingBusy(true);
      setReviewStatus('Preparing field suggestions from your saved details…');
    } else {
      setScanBusy(true);
      setMappingBusy(false);
      setCompany('');
      setTitle('');
      resetPostScanState();
      setReviewStatus('Scanning the current application form…');
    }

    try {
      if (!snapshot) {
        const result = await client.scanPage();
        const descriptors = Array.isArray(result?.descriptors) ? result.descriptors : [];
        const page = result?.page && typeof result.page === 'object' ? result.page : {};
        setCompany(String(page.company ?? ''));
        setTitle(String(page.title ?? ''));
        const matchesJobDraft = samePage(page, jobDraft);
        const job = jobFromPage(page, matchesJobDraft ? manualJobDescription : '');
        setJobDraft(page);
        if (page.description || !matchesJobDraft) setManualJobDescription('');
        setScanBusy(false);

        if (descriptors.length === 0) {
          setReviewStatus('No supported application fields were found on this page.');
          return false;
        }

        snapshot = {
          profileContextId: activeConnection.profileContextId,
          resumeId: activeResumeId,
          descriptors,
          page,
          job,
        };
        setPendingReview(snapshot);
      }

      setMappingBusy(true);
      setReviewStatus('Preparing field suggestions from your saved details…');
      const items = await createReviewItems(
        client,
        snapshot.profileContextId,
        snapshot.resumeId,
        snapshot.descriptors,
        { job: snapshot.job, ...(selectedModel ? { model: selectedModel } : {}) },
      );
      setPendingReview(null);
      setReviewContext(structuredClone({ page: snapshot.page, descriptors: snapshot.descriptors }));
      setReviewItems(items);
      setReviewNeedsRefresh(false);
      setReviewStatus(`${successPrefix}${readyReviewStatus(items)}`);
      return true;
    } catch (error) {
      setReviewStatus('');
      await handleWorkflowError(error);
      if (
        snapshot
        && !PAIRING_ERROR_CODES.has(error?.code)
        && error?.code !== 'profile_changed'
        && !RUNNING_APP_ERROR_CODES.has(error?.code)
      ) {
        setPendingReview(snapshot);
        setReviewStatus('Application fields scanned. Retry preparing the review.');
      }
      return false;
    } finally {
      setScanBusy(false);
      setMappingBusy(false);
    }
  }

  async function handleCreateReview() {
    if (!selectedResumeId || !beginOperation('review')) return;
    try {
      const ready = await connectionForAction();
      if (!ready) return;
      const resumeId = ready.connection.resumes.some((resume) => resume.id === selectedResumeId)
        ? selectedResumeId
        : ready.connection.resumes[0]?.id ?? '';
      if (!resumeId) return;
      await prepareReview({
        activeConnection: ready.connection,
        activeResumeId: resumeId,
        forceFresh: reviewNeedsRefresh || ready.contextChanged,
      });
    } finally {
      finishOperation('review');
    }
  }

  function handleStartOver() {
    if (!beginOperation('start-over')) return;
    setRuntimeError(null);
    setCompany('');
    setTitle('');
    resetPostScanState();
    queueMicrotask(() => finishOperation('start-over'));
  }

  function handleReviewChange(fieldId, value) {
    if (hasPendingInteraction()) return;
    const next = reviewItems.map((item) => (
      item.field_id === fieldId ? { ...item, value } : item
    ));
    setReviewItems(next);
    setReviewStatus(readyReviewStatus(next));
  }

  async function handleSaveAnswer(item) {
    const answer = item.value.trim();
    if (!answer || !item.question || item.manualFile || item.manualCustom || item.manualSensitive) return;
    if (hasPendingInteraction()) return;

    answerPending.current.add(item.field_id);
    setRuntimeError(null);
    setSavingAnswers((current) => new Set(current).add(item.field_id));
    try {
      const ready = await connectionForAction();
      if (!ready || ready.contextChanged) return;
      await client.saveAnswer(ready.connection.profileContextId, item.question, answer);
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
        snapshot.reviewContext,
      );
      setFillResult(result);
      setRetrySnapshot(null);
      setHasFilled(true);
      const filledCount = Array.isArray(result?.filled) ? result.filled.length : 0;
      const filenames = (Array.isArray(result?.attachments) ? result.attachments : [])
        .map((attachment) => String(attachment?.filename ?? '').trim())
        .filter(Boolean);
      const filledLabel = `${filledCount} ${filledCount === 1 ? 'field' : 'fields'}`;
      setFillAnnouncement(
        filenames.length
          ? `Attached ${filenames.join(', ')}. Filled ${filledLabel}.`
          : `Filled ${filledLabel}.`,
      );
    } catch (error) {
      await handleWorkflowError(error);
      setRetrySnapshot(error?.code === 'pdf_busy' ? snapshot : null);
    } finally {
      setFillBusy(false);
      finishOperation('fill');
    }
  }

  async function handleFill() {
    if (connection.kind !== 'connected' || reviewNeedsRefresh) {
      if (!selectedResumeId || !beginOperation('refresh-review')) return;
      try {
        const ready = await connectionForAction();
        if (!ready) return;
        const resumeId = ready.connection.resumes.some((resume) => resume.id === selectedResumeId)
          ? selectedResumeId
          : ready.connection.resumes[0]?.id ?? '';
        if (!resumeId) return;
        await prepareReview({
          activeConnection: ready.connection,
          activeResumeId: resumeId,
          forceFresh: true,
          successPrefix: 'Review refreshed. ',
        });
      } finally {
        finishOperation('refresh-review');
      }
      return;
    }
    const { fields, warnings } = buildFillPayload(reviewItems);
    setLocalWarnings(warnings);
    if (fields.length === 0) {
      setReviewStatus('No reviewed fields can be autofilled. Complete the listed fields manually.');
      return;
    }
    const snapshot = {
      profileContextId: connection.profileContextId,
      resumeId: selectedResumeId,
      fields: fields.map((field) => ({ ...field })),
      reviewContext,
    };
    await performFill(snapshot);
  }

  function handleRetryFill() {
    if (!retrySnapshot) return;
    if (connection.kind !== 'connected' || reviewNeedsRefresh) {
      void handleFill();
      return;
    }
    void performFill(retrySnapshot);
  }

  async function handleLogApplication() {
    if (hasPendingInteraction() || logState === 'logged') return;
    logPending.current = true;
    setLogState('pending');
    setRuntimeError(null);

    try {
      const ready = await connectionForAction();
      if (!ready || ready.contextChanged) {
        setLogState('idle');
        return;
      }
      await client.logApplication({
        profileContextId: ready.connection.profileContextId,
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

  async function scanJobForAction() {
    setScanBusy(true);
    try {
      const result = await client.scanPage();
      const page = result?.page && typeof result.page === 'object' ? result.page : {};
      const sameDraft = samePage(page, jobDraft);
      const description = String(page.description ?? '').trim()
        || (sameDraft ? manualJobDescription.trim() : '');
      setJobDraft(page);
      if (!sameDraft) setManualJobDescription('');
      setCompany(String(page.company ?? ''));
      setTitle(String(page.title ?? ''));
      if (!description) {
        setJobActionStatus('Paste the job description to continue.');
        return { page, descriptors: result?.descriptors ?? [], job: null };
      }
      return {
        page,
        descriptors: Array.isArray(result?.descriptors) ? result.descriptors : [],
        job: jobFromPage(page, description),
      };
    } finally {
      setScanBusy(false);
    }
  }

  async function handleAnalyzeFit() {
    if (!selectedResumeId || !beginOperation('analyze-fit')) return;
    setJobAction('analyzing');
    setJobActionStatus('Analyzing this role against your selected resume…');
    setRuntimeError(null);
    setFitAnalysis(null);
    try {
      const ready = await connectionForAction();
      if (!ready) return;
      const resumeId = ready.connection.resumes.some((resume) => resume.id === selectedResumeId)
        ? selectedResumeId
        : ready.connection.resumes[0]?.id ?? '';
      if (!resumeId) return;
      const scanned = await scanJobForAction();
      if (!scanned.job) return;
      const result = await client.analyzeJobFit({
        profileContextId: ready.connection.profileContextId,
        resumeId,
        job: scanned.job,
        ...(selectedModel ? { model: selectedModel } : {}),
      });
      setFitAnalysis(result?.analysis ?? null);
      setJobActionStatus('Fit analysis ready.');
    } catch (error) {
      setJobActionStatus('');
      await handleWorkflowError(error);
    } finally {
      setJobAction('idle');
      finishOperation('analyze-fit');
    }
  }

  async function handleCreateTailoredResume() {
    if (!selectedResumeId || !beginOperation('tailor')) return;
    setJobAction('tailoring');
    setJobActionStatus('Creating a tailored resume in On Paper…');
    setRuntimeError(null);
    try {
      const ready = await connectionForAction();
      if (!ready) return;
      const baseResumeId = ready.connection.resumes.some((resume) => resume.id === selectedResumeId)
        ? selectedResumeId
        : ready.connection.resumes[0]?.id ?? '';
      if (!baseResumeId) return;
      const scanned = await scanJobForAction();
      if (!scanned.job) return;
      const requestKey = [
        baseResumeId,
        scanned.page.url,
        scanned.page.fingerprint,
        scanned.job.description,
        selectedModel,
      ].join('\n');
      if (tailoringRequest.current?.key !== requestKey) {
        tailoringRequest.current = { key: requestKey, id: createRequestId() };
      }
      const result = await client.createTailoredResume({
        profileContextId: ready.connection.profileContextId,
        resumeId: baseResumeId,
        job: scanned.job,
        requestId: tailoringRequest.current.id,
        ...(selectedModel ? { model: selectedModel } : {}),
      });
      const tailored = result?.resume;
      if (!tailored?.id) throw new Error('On Paper returned an invalid tailored resume');

      const refreshedData = await client.checkConnection();
      let refreshed = connectedState(refreshedData);
      if (refreshed.kind !== 'connected') {
        setConnection(refreshed);
        return;
      }
      if (refreshed.profileContextId !== ready.connection.profileContextId) {
        resetProfileScopedState();
        setConnection(refreshed);
        setSelectedResumeId(refreshed.resumes[0]?.id ?? '');
        setJobActionStatus('On Paper reloaded or switched profiles. Review the refreshed resume list before continuing.');
        return;
      }
      if (!refreshed.resumes.some((resume) => resume.id === tailored.id)) {
        refreshed = { ...refreshed, resumes: [...refreshed.resumes, tailored] };
      }
      setConnection(refreshed);
      setSelectedResumeId(tailored.id);
      setWorkflow('autofill');
      resetPostScanState();
      setJobActionStatus(`Tailored resume created and selected: ${tailored.name}.`);

      const after = await client.scanPage();
      const afterPage = after?.page && typeof after.page === 'object' ? after.page : {};
      const descriptors = Array.isArray(after?.descriptors) ? after.descriptors : [];
      if (!samePage(scanned.page, afterPage)) {
        setReviewStatus('Tailored resume created. The application page changed; prepare a new autofill review.');
        tailoringRequest.current = null;
        return;
      }
      if (descriptors.length === 0) {
        setReviewStatus('Tailored resume created. No supported application fields were found on this page.');
        tailoringRequest.current = null;
        return;
      }

      setMappingBusy(true);
      const items = await createReviewItems(
        client,
        refreshed.profileContextId,
        tailored.id,
        descriptors,
        { job: jobFromPage(afterPage, scanned.job.description), ...(selectedModel ? { model: selectedModel } : {}) },
      );
      setReviewContext(structuredClone({ page: afterPage, descriptors }));
      setReviewItems(items);
      setJobDraft(afterPage);
      setCompany(String(afterPage.company ?? ''));
      setTitle(String(afterPage.title ?? ''));
      setReviewNeedsRefresh(false);
      setReviewStatus(`Tailored resume created — ${readyReviewStatus(items)}`);
      tailoringRequest.current = null;
    } catch (error) {
      setJobActionStatus('');
      await handleWorkflowError(error);
    } finally {
      setMappingBusy(false);
      setJobAction('idle');
      finishOperation('tailor');
    }
  }

  function defaultModelName(task) {
    const id = modelCatalog.defaults[task];
    return modelCatalog.models.find((model) => model.id === id)?.name || id || '';
  }

  const mappingModelName = defaultModelName('mapping');
  const analysisModelName = defaultModelName('analysis');
  const tailoringModelName = defaultModelName('tailoring');
  const defaultModelCaption = workflow === 'autofill'
    ? mappingModelName ? `Autofill uses ${mappingModelName}.` : 'Uses your app’s model for each task.'
    : analysisModelName && tailoringModelName
      ? analysisModelName === tailoringModelName
        ? `Fit and tailoring use ${analysisModelName}.`
        : `Fit: ${analysisModelName}. Tailoring: ${tailoringModelName}.`
      : 'Uses your app’s model for each task.';

  const activeModelId = selectedModel || modelCatalog.defaults[workflow === 'autofill' ? 'mapping' : 'tailoring'] || '';

  const matchingModels = modelCatalog.models.filter((model) => (
    `${model.name} ${model.id}`.toLowerCase().includes(modelSearch.trim().toLowerCase())
  ));
  const selectedCatalogModel = modelCatalog.models.find((model) => model.id === activeModelId);

  const contentWarnings = (fillResult?.unfilled ?? []).map((item) => ({
    field_id: item.field_id,
    label: reviewItems.find((reviewItem) => reviewItem.field_id === item.field_id)?.label,
    reason: item.reason,
  }));
  const workflowBusy = scanBusy
    || mappingBusy
    || fillBusy
    || logState === 'pending'
    || savingAnswers.size > 0
    || jobAction !== 'idle'
    || pairingBusy;
  const hasWorkspace = connection.resumes.length > 0;
  const connectionLabel = connection.kind === 'connected'
    ? 'Connected'
    : connection.kind === 'checking'
      ? 'Checking connection…'
      : connection.kind === 'opening'
        ? 'Opening On Paper…'
        : connection.kind === 'reconnecting'
          ? 'Reconnecting…'
          : 'Not connected';
  const pairingState = [
    'needs_pairing', 'unreachable', 'launch_failed', 'incompatible', 'opening', 'checking', 'reconnecting',
  ].includes(connection.kind)
    ? connection.kind
    : null;
  const hasFillableReviewItems = buildFillPayload(reviewItems).fields.length > 0;
  const reviewActionLabel = scanBusy
    ? 'Scanning application form…'
    : mappingBusy
      ? 'Preparing field suggestions…'
      : pendingReview
        ? 'Retry preparing review'
        : 'Prepare autofill review';

  const workflowControls = (
    <section className="panel-section controls-section" aria-label={workflow === 'tailor' ? 'Tailoring settings' : 'Autofill settings'}>
      <div className="picker-field">
        <label htmlFor="resume-picker">{workflow === 'tailor' ? 'Base resume' : 'Resume to fill from'}</label>
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
        {workflow === 'tailor' ? <p className="supporting-copy">Creates a new copy. Your base resume stays unchanged.</p> : null}
      </div>
      <div className="picker-field">
        <label htmlFor="model-picker">AI model</label>
        {modelCatalog.models.length > 20 ? (
          <input
            type="search"
            aria-label="Search AI models"
            aria-controls="model-picker"
            placeholder="Search by model name or provider"
            value={modelSearch}
            disabled={workflowBusy || modelCatalog.state !== 'ready'}
            onChange={(event) => setModelSearch(event.target.value)}
          />
        ) : null}
        <select
          id="model-picker"
          value={activeModelId}
          onChange={handleModelChange}
          disabled={workflowBusy || modelCatalog.state !== 'ready' || modelCatalog.models.length === 0}
          aria-describedby={modelCatalog.error ? 'model-caption model-error' : 'model-caption'}
        >
          {modelCatalog.state !== 'ready' && !activeModelId ? <option value="">{modelCatalog.state === 'loading' ? 'Loading models…' : 'Models unavailable'}</option> : null}
          {activeModelId && !matchingModels.some((model) => model.id === activeModelId) ? (
            <optgroup label="Selected model"><option value={activeModelId}>{selectedCatalogModel?.name ?? activeModelId}</option></optgroup>
          ) : null}
          {matchingModels.map((model) => (
            <option key={model.id} value={model.id}>{model.name}</option>
          ))}
        </select>
        {modelSearch.trim() ? (
          <p className="supporting-copy model-search-status" role="status">
            {matchingModels.length ? `${matchingModels.length} matching ${matchingModels.length === 1 ? 'model' : 'models'}.` : 'No models match. Your selected model is unchanged.'}
          </p>
        ) : null}
        <p id="model-caption" className="supporting-copy model-caption">
          {modelCatalog.state === 'loading'
            ? 'Loading models from On Paper…'
            : modelCatalog.state === 'legacy'
              ? 'Uses your AI settings in On Paper. Update the app to choose a model here.'
              : modelCatalog.state === 'unavailable'
                ? selectedModel ? `Selected model: ${selectedModel}.` : 'Uses your AI settings in On Paper until models load.'
                : selectedModel
                  ? 'Applies to this companion session. Your app defaults stay the same.'
                  : defaultModelCaption}
          {modelCatalog.autoFallback ? ' Automatic fallback is on in On Paper.' : ''}
        </p>
        {selectedModel ? <button type="button" className="text-button model-reset" disabled={workflowBusy} onClick={() => handleModelChange()}>Reset to app defaults</button> : null}
        {modelCatalog.error ? (
          <div className="model-load-error">
            <p id="model-error" role="alert">Could not load models: {modelCatalog.error}</p>
            <button type="button" className="text-button" disabled={workflowBusy || connection.kind !== 'connected'} onClick={handleRetryModels}>Retry loading models</button>
          </div>
        ) : null}
      </div>
    </section>
  );

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <div className="brand-lockup">
          <h1>On Paper <span>Companion</span></h1>
          <p
            className={`connection-status ${connection.kind === 'connected' ? 'connection-status--connected' : ''}`}
            role="status"
          >
            {connectionLabel}
          </p>
        </div>
        <details className="panel-settings">
          <summary>Settings</summary>
          <div className="settings-menu">
            <p className="supporting-copy">Your API key and AI settings stay in On Paper.</p>
            <button type="button" className="text-button" disabled={workflowBusy} onClick={handleDisconnect}>Disconnect</button>
          </div>
        </details>
      </header>

      {runtimeError ? <p className="error-message" role="alert">{visibleError(runtimeError)}</p> : null}

      {connection.kind === 'reconnecting' ? (
        <p className="supporting-copy">Reconnecting after On Paper reloads…</p>
      ) : null}

      {pairingState ? (
        <PairingView
          state={pairingState}
          busy={pairingBusy || connection.kind === 'checking'}
          operation={pairingAction}
          onOpen={openAndReconnect}
          onRetry={checkConnectionAgain}
          onCancel={handleCancelPairing}
          onPair={handlePair}
        />
      ) : null}

      {connection.kind === 'connected' && !hasWorkspace ? (
        <section className="panel-section" aria-labelledby="empty-resumes-heading">
          <h2 id="empty-resumes-heading">Add a resume in On Paper</h2>
          <p className="supporting-copy">Create or import a resume in your current profile, then refresh this connection.</p>
          <button type="button" className="secondary-button" onClick={checkConnectionAgain}>Check connection again</button>
        </section>
      ) : null}

      {hasWorkspace ? (
        <>
          <nav className="workflow-switcher" aria-label="Application workflow">
            <button
              type="button"
              className={workflow === 'autofill' ? 'workflow-button is-active' : 'workflow-button'}
              aria-pressed={workflow === 'autofill'}
              aria-controls={workflow === 'autofill' ? 'autofill-workflow' : undefined}
              disabled={workflowBusy}
              onClick={() => setWorkflow('autofill')}
            >Autofill</button>
            <button
              type="button"
              className={workflow === 'tailor' ? 'workflow-button is-active' : 'workflow-button'}
              aria-pressed={workflow === 'tailor'}
              aria-controls={workflow === 'tailor' ? 'tailor-workflow' : undefined}
              disabled={workflowBusy}
              onClick={() => setWorkflow('tailor')}
            >Tailor resume</button>
          </nav>

          {workflow === 'tailor' ? (
            <div id="tailor-workflow" className="workflow-content">
              {workflowControls}
              <section className="panel-section job-actions-section" aria-labelledby="job-actions-heading">
                <h2 id="job-actions-heading">Prepare for this role</h2>
                <p className="supporting-copy">
                  Compare this role with the selected resume or create a new tailored version.
                </p>
                {jobDraft && !String(jobDraft.description ?? '').trim() ? (
                  <>
                    <label htmlFor="manual-job-description">Job description</label>
                    <textarea
                      id="manual-job-description"
                      value={manualJobDescription}
                      placeholder="Paste the job description"
                      disabled={workflowBusy}
                      onChange={(event) => setManualJobDescription(event.target.value)}
                    />
                  </>
                ) : null}
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!selectedResumeId || workflowBusy}
                    onClick={handleAnalyzeFit}
                  >
                    {jobAction === 'analyzing' ? 'Analyzing fit…' : 'Analyze fit'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!selectedResumeId || workflowBusy}
                    onClick={handleCreateTailoredResume}
                  >
                    {jobAction === 'tailoring' ? 'Creating tailored resume…' : 'Create tailored resume'}
                  </button>
                </div>
                {jobActionStatus ? (
                  <p className="supporting-copy job-action-status" role="status" aria-live="polite">
                    {jobActionStatus}
                  </p>
                ) : null}
              </section>

              <FitAnalysis analysis={fitAnalysis} />
            </div>
          ) : (
            <div id="autofill-workflow" className="workflow-content">
              <div className="autofill-heading">
                <div>
                  <h2>{reviewItems.length > 0 ? 'Review your application' : 'Fill this application'}</h2>
                  <p className="supporting-copy">Review suggested answers before filling. You submit the application yourself.</p>
                </div>
                {reviewItems.length > 0 ? (
                  <button type="button" className="text-button" disabled={workflowBusy} onClick={handleStartOver}>Start over</button>
                ) : null}
              </div>
              {workflowControls}
              {reviewItems.length === 0 ? (
                <div className="review-actions">
                  <button type="button" className="primary-button" disabled={!selectedResumeId || workflowBusy} onClick={handleCreateReview}>{reviewActionLabel}</button>
                  {pendingReview ? <button type="button" className="secondary-button" disabled={workflowBusy} onClick={handleStartOver}>Start over</button> : null}
                </div>
              ) : null}

              <p
                className={`workflow-status ${reviewItems.length > 0 ? 'success-message' : 'supporting-copy'}`}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {reviewStatus}
              </p>

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
                  {hasFillableReviewItems ? (
                    <button
                      type="button"
                      className="primary-button fill-button"
                      disabled={workflowBusy}
                      onClick={handleFill}
                    >
                      {fillBusy
                        ? 'Filling…'
                        : connection.kind !== 'connected'
                          ? 'Reconnect and refresh review'
                          : reviewNeedsRefresh ? 'Refresh review' : 'Fill reviewed fields'}
                    </button>
                  ) : null}
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
              {fillAnnouncement ? (
                <p className="success-message fill-announcement" role="status" aria-live="polite">
                  {fillAnnouncement}
                </p>
              ) : null}

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
            </div>
          )}
        </>
      ) : null}
      <footer className="panel-footer">
        <span>AI runs through On Paper</span>
        <a href={privacyUrl()} target="_blank" rel="noreferrer">Privacy</a>
      </footer>
    </main>
  );
}


function privacyUrl() {
  return globalThis.chrome?.runtime?.getURL?.('privacy.html') ?? './privacy.html';
}

export default function App({ client = runtimeClient, ...props }) {
  const [consent, setConsent] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    client.getPrivacyConsent().then(
      ({ accepted }) => { if (active) setConsent(accepted ? 'accepted' : 'required'); },
      (failure) => { if (active) { setError(failure.message); setConsent('required'); } },
    );
    return () => { active = false; };
  }, [client]);

  async function accept() {
    setConsent('saving');
    setError('');
    try {
      await client.acceptPrivacyConsent();
      setConsent('accepted');
    } catch (failure) {
      setError(failure.message);
      setConsent('required');
    }
  }

  if (consent === 'accepted') {
    return <Workspace {...props} client={client} onDisconnected={({ revoked }) => {
      setConsent('required');
      setNotice(revoked
        ? 'Disconnected. App access revoked and this browser’s session cleared.'
        : 'Disconnected in this browser. On Paper could not revoke other sessions. Reconnect and disconnect while the app is running to revoke them.');
    }} />;
  }

  return (
    <main className="panel-shell">
      <header className="panel-header"><h1>On Paper Companion</h1></header>
      {notice ? <p className="supporting-copy" role="status">{notice}</p> : null}
      <section className="panel-section" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">Before you connect</h2>
        <p>On Paper helps you review and fill applications. You stay in control.</p>
        <ul>
          <li>When you ask, the extension reads this application’s address, job details and form labels/options. Raw page HTML and passwords are excluded.</li>
          <li>Your selected resume, profile, saved answers and supported form fields are sent through On Paper to OpenRouter and your selected AI provider.</li>
          <li>Filling sends the values you reviewed and, when selected, your resume PDF to the application site. The site may save or upload them immediately. You submit the application yourself.</li>
          <li>The connection token stays in this browser session. Answers and application records you choose to save stay in On Paper and may sync through your iCloud account.</li>
        </ul>
        <p>Sensitive questions stay manual. Disconnect clears this browser’s access and asks the running app to revoke existing companion connections.</p>
        <p><a href={privacyUrl()} target="_blank" rel="noreferrer">Read the privacy notice</a></p>
        {error ? <p className="error-message" role="alert">{error}</p> : null}
        <button type="button" className="primary-button" disabled={consent === 'loading' || consent === 'saving'} onClick={accept}>
          {consent === 'loading' ? 'Loading…' : consent === 'saving' ? 'Saving…' : 'Agree and continue'}
        </button>
      </section>
    </main>
  );
}
