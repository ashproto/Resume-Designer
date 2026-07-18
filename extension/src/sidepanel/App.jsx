import { useCallback, useEffect, useRef, useState } from 'react';

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

async function createReviewItems(client, profileContextId, resumeId, descriptors) {
  const supportedDescriptors = descriptors.filter((descriptor) => descriptor?.type !== 'custom');
  const mapping = supportedDescriptors.length > 0
    ? await client.createMapping(profileContextId, resumeId, supportedDescriptors)
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
  const manualCount = items.filter((item) => item.manualFile || item.manualCustom).length;
  const fields = `${fieldCount} ${fieldCount === 1 ? 'field' : 'fields'}`;

  if (manualCount === 0) return `Review ready — ${fields}.`;
  const manual = `${manualCount} ${manualCount === 1 ? 'requires' : 'require'} manual entry`;
  return `Review ready — ${fields}; ${manual}.`;
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

export default function App({
  client = runtimeClient,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  createRequestId = defaultRequestId,
}) {
  const [connection, setConnection] = useState({
    kind: 'checking', profileId: '', profileContextId: '', resumes: [],
  });
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [fillBusy, setFillBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState(null);
  const [reviewStatus, setReviewStatus] = useState('');
  const [pendingReview, setPendingReview] = useState(null);
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

  const resetPostScanState = useCallback(() => {
    setReviewStatus('');
    setPendingReview(null);
    setReviewItems([]);
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
        setConnection(stateForError(error));
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
        if (!active) return;
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
        if (!active) return;
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
        if (!active) return;
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

  async function openAndReconnect() {
    const previous = connection;
    setRuntimeError(null);
    setPairingBusy(true);
    setConnection({ ...previous, kind: 'opening' });
    try {
      const opened = await client.openApp();
      setConnection({ ...previous, kind: 'reconnecting' });
      const data = opened?.connected ? opened : await client.checkConnection();
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
      setRuntimeError(error);
      setConnection(stateForError(error, previous));
      return null;
    } finally {
      setPairingBusy(false);
    }
  }

  async function connectionForAction() {
    if (connection.kind === 'connected') {
      return { connection, contextChanged: false };
    }
    return openAndReconnect();
  }

  async function handlePair(token) {
    setPairingBusy(true);
    setRuntimeError(null);
    try {
      const data = await client.savePairing(token);
      const next = connectedState(data);
      setConnection(next);
      setSelectedResumeId(next.resumes[0]?.id ?? '');
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(error);
    } finally {
      setPairingBusy(false);
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
        setJobDraft(page);
        if (page.description) setManualJobDescription('');
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
      );
      setPendingReview(null);
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
    setReviewItems((current) => current.map((item) => (
      item.field_id === fieldId ? { ...item, value } : item
    )));
  }

  async function handleSaveAnswer(item) {
    const answer = item.value.trim();
    if (!answer || !item.question || item.manualFile || item.manualCustom) return;
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
          successPrefix: 'Connection restored — review refreshed. ',
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
    setJobActionStatus('Analyzing this role against your selected résumé…');
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
    setJobActionStatus('Creating a tailored résumé in Resume Designer…');
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
      ].join('\n');
      if (tailoringRequest.current?.key !== requestKey) {
        tailoringRequest.current = { key: requestKey, id: createRequestId() };
      }
      const result = await client.createTailoredResume({
        profileContextId: ready.connection.profileContextId,
        resumeId: baseResumeId,
        job: scanned.job,
        requestId: tailoringRequest.current.id,
      });
      const tailored = result?.resume;
      if (!tailored?.id) throw new Error('Resume Designer returned an invalid tailored résumé');

      const refreshedData = await client.checkConnection();
      let refreshed = connectedState(refreshedData);
      if (refreshed.kind !== 'connected') {
        setConnection(refreshed);
        return;
      }
      if (!refreshed.resumes.some((resume) => resume.id === tailored.id)) {
        refreshed = { ...refreshed, resumes: [...refreshed.resumes, tailored] };
      }
      setConnection(refreshed);
      setSelectedResumeId(tailored.id);
      resetPostScanState();
      setJobActionStatus(`Tailored résumé created and selected: ${tailored.name}.`);

      const after = await client.scanPage();
      const afterPage = after?.page && typeof after.page === 'object' ? after.page : {};
      const descriptors = Array.isArray(after?.descriptors) ? after.descriptors : [];
      if (!samePage(scanned.page, afterPage)) {
        setReviewStatus('Tailored résumé created. The application page changed; prepare a new autofill review.');
        tailoringRequest.current = null;
        return;
      }
      if (descriptors.length === 0) {
        setReviewStatus('Tailored résumé created. No supported application fields were found on this page.');
        tailoringRequest.current = null;
        return;
      }

      setMappingBusy(true);
      const items = await createReviewItems(
        client,
        refreshed.profileContextId,
        tailored.id,
        descriptors,
      );
      setReviewItems(items);
      setJobDraft(afterPage);
      setCompany(String(afterPage.company ?? ''));
      setTitle(String(afterPage.title ?? ''));
      setReviewNeedsRefresh(false);
      setReviewStatus(`Tailored résumé created — ${readyReviewStatus(items)}`);
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
        ? 'Opening Resume Designer…'
        : connection.kind === 'reconnecting'
          ? 'Reconnecting…'
          : 'Not connected';
  const pairingState = [
    'needs_pairing', 'unreachable', 'launch_failed', 'incompatible',
  ].includes(connection.kind)
    ? connection.kind
    : null;
  const hasFillableReviewItems = reviewItems.some((item) => !item.manualFile && !item.manualCustom);
  const reviewActionLabel = scanBusy
    ? 'Scanning application form…'
    : mappingBusy
      ? 'Preparing field suggestions…'
      : pendingReview
        ? 'Retry preparing review'
        : 'Prepare autofill review';

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <h1>Resume Designer</h1>
        <p
          className={`connection-status ${connection.kind === 'connected' ? 'connection-status--connected' : ''}`}
          role="status"
        >
          {connectionLabel}
        </p>
      </header>

      {runtimeError ? <p className="error-message" role="alert">{visibleError(runtimeError)}</p> : null}

      {connection.kind === 'reconnecting' ? (
        <p className="supporting-copy">Reconnecting after Resume Designer reloads…</p>
      ) : null}

      {pairingState ? (
        <PairingView
          state={pairingState}
          busy={pairingBusy}
          onOpen={openAndReconnect}
          onRetry={openAndReconnect}
          onPair={handlePair}
        />
      ) : null}

      {hasWorkspace ? (
        <>
          <section
            className="panel-section controls-section"
            aria-labelledby="resume-heading"
            aria-busy={scanBusy || mappingBusy}
          >
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
              {reviewItems.length > 0 ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={workflowBusy}
                  onClick={handleStartOver}
                >
                  Start over
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!selectedResumeId || workflowBusy}
                    onClick={handleCreateReview}
                  >
                    {reviewActionLabel}
                  </button>
                  {pendingReview ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={workflowBusy}
                      onClick={handleStartOver}
                    >
                      Start over
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </section>

          <section className="panel-section job-actions-section" aria-labelledby="job-actions-heading">
            <div className="section-heading">
              <h2 id="job-actions-heading">Use this job</h2>
              <span>Runs in Resume Designer</span>
            </div>
            <p className="supporting-copy">
              Compare this role with the selected résumé or create a new tailored version.
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
                {jobAction === 'tailoring' ? 'Creating tailored résumé…' : 'Create tailored résumé'}
              </button>
            </div>
            {jobActionStatus ? (
              <p className="supporting-copy job-action-status" role="status" aria-live="polite">
                {jobActionStatus}
              </p>
            ) : null}
          </section>

          <FitAnalysis analysis={fitAnalysis} />

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
                    : connection.kind !== 'connected' || reviewNeedsRefresh
                      ? 'Reconnect and refresh review'
                      : 'Fill reviewed fields'}
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
        </>
      ) : null}
    </main>
  );
}
