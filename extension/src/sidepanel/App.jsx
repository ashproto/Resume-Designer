import { useCallback, useEffect, useRef, useState } from 'react';

import PairingView from './PairingView.jsx';
import ReviewList from './ReviewList.jsx';
import FitAnalysis from './FitAnalysis.jsx';
import JobContext from './JobContext.jsx';
import ProcessingView from './ProcessingView.jsx';
import ModelPicker from './ModelPicker.jsx';
import GeneratedResume from './GeneratedResume.jsx';
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
const APPLICATION_REQUEST_KEY_PREFIX = 'pendingApplicationRequest:';
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (error?.code === 'untrusted_pairing_client') kind = 'unsupported_extension';
  else if (error?.code === 'profile_changed') kind = 'reconnecting';
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

function jobFromPage(page) {
  return {
    company: String(page?.company ?? ''),
    title: String(page?.title ?? ''),
    description: String(page?.description ?? '').trim(),
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
  applicationRequestStorage = globalThis.chrome?.storage?.session,
  windowApi = globalThis.chrome?.windows,
  onDisconnected,
}) {
  const [connection, setConnection] = useState({
    kind: 'checking', profileId: '', profileContextId: '', resumes: [],
  });
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [tailoringSourceId, setTailoringSourceId] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [modelCatalog, setModelCatalog] = useState({ state: 'loading', models: [], defaults: {}, autoFallback: false, error: '' });
  const [modelLoadAttempt, setModelLoadAttempt] = useState(0);
  const [workflow, setWorkflow] = useState('autofill');
  const [settingsExpanded, setSettingsExpanded] = useState({ autofill: false, tailor: false });
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
  const [applicationRequestKey, setApplicationRequestKey] = useState(null);
  const [applicationStorageError, setApplicationStorageError] = useState('');
  const [reviewNeedsRefresh, setReviewNeedsRefresh] = useState(false);
  const [fillAnnouncement, setFillAnnouncement] = useState('');
  const [jobDraft, setJobDraft] = useState(null);
  const [manualJobDescription, setManualJobDescription] = useState('');
  const [tailorJobSource, setTailorJobSource] = useState({ kind: 'idle', page: null });
  const [showJobSourceChoices, setShowJobSourceChoices] = useState(false);
  const manualJobEntry = tailorJobSource.kind === 'manual';
  const manualSourceBeforeEdit = useRef(null);
  const [generatedResume, setGeneratedResume] = useState(null);
  const [resumePreview, setResumePreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [openingResume, setOpeningResume] = useState(false);
  const [resumeOpenError, setResumeOpenError] = useState(null);
  const [jobAction, setJobAction] = useState('idle');
  const [jobActionStatus, setJobActionStatus] = useState('');
  const [fitAnalysis, setFitAnalysis] = useState(null);
  const [progress, setProgress] = useState(null);
  const [progressNotes, setProgressNotes] = useState('');
  const [discoveredFields, setDiscoveredFields] = useState([]);
  const [revealedFields, setRevealedFields] = useState([]);
  const knownFieldIds = useRef(new Set());
  const fitResultRef = useRef(null);
  const operationPending = useRef(null);
  const answerPending = useRef(new Set());
  const logPending = useRef(false);
  const heartbeatPending = useRef(false);
  const tailoringRequest = useRef(null);
  const applicationRequest = useRef(null);
  const applicationDraft = useRef(null);
  const freshApplicationIntent = useRef(false);
  const applicationStorageQueue = useRef(Promise.resolve());
  const pairingGeneration = useRef(0);
  const pairingAttempt = useRef(null);
  const resumeActionGeneration = useRef(0);
  const activeProfileContext = useRef(connection.profileContextId);
  activeProfileContext.current = connection.profileContextId;

  useEffect(() => () => { resumeActionGeneration.current += 1; }, []);

  useEffect(() => {
    if (!fitAnalysis || jobAction !== 'idle') return;
    fitResultRef.current?.scrollIntoView?.({
      block: 'start',
      behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }, [fitAnalysis, jobAction]);

  useEffect(() => {
    if (connection.kind !== 'connected' || !tailoringSourceId
      || connection.resumes.some((resume) => resume.id === tailoringSourceId)) return;
    setTailoringSourceId('');
    setFitAnalysis(null);
    tailoringRequest.current = null;
  }, [connection.kind, connection.resumes, tailoringSourceId]);

  useEffect(() => {
    let active = true;
    // Resolve in the panel: a service worker's current window can instead be
    // whichever window was last active. Never fall back to a shared key.
    Promise.resolve().then(() => windowApi?.getCurrent()).then((window) => {
      if (!Number.isInteger(window?.id) || window.id < 0) throw new Error('Missing containing window');
      if (active) setApplicationRequestKey(`${APPLICATION_REQUEST_KEY_PREFIX}${window.id}`);
    }).catch(() => {
      if (active) setApplicationStorageError('Application logging is unavailable. Close and reopen this panel to retry.');
    });
    return () => { active = false; };
  }, [windowApi]);

  const withApplicationStorage = useCallback((operation) => {
    if (!applicationRequestKey) return Promise.reject(new Error('Application logging is unavailable. Close and reopen this panel to retry.'));
    const result = applicationStorageQueue.current.then(() => operation(applicationRequestStorage));
    applicationStorageQueue.current = result.catch(() => {});
    return result;
  }, [applicationRequestStorage, applicationRequestKey]);

  const clearApplicationRequest = useCallback(async () => {
    await withApplicationStorage(async (storage) => {
      await storage?.remove(applicationRequestKey);
      applicationRequest.current = null;
      applicationDraft.current = null;
      freshApplicationIntent.current = true;
    });
  }, [withApplicationStorage, applicationRequestKey]);

  useEffect(() => {
    if (connection.kind !== 'connected') {
      if (connection.kind === 'needs_pairing') applicationDraft.current = null;
      return undefined;
    }
    if (!applicationRequestKey) return undefined;
    let active = true;
    void withApplicationStorage(async (storage) => {
      const pending = applicationRequest.current
        ?? (await storage?.get(applicationRequestKey))?.[applicationRequestKey];
      if (!active || !pending || pending.profileId === connection.profileId) return;
      await storage?.remove(applicationRequestKey);
      if (!active || applicationRequest.current?.profileId === connection.profileId) return;
      applicationRequest.current = null;
      applicationDraft.current = null;
      freshApplicationIntent.current = true;
    }).catch((error) => { if (active) setRuntimeError(error); });
    return () => { active = false; };
  }, [connection.kind, connection.profileId, withApplicationStorage, applicationRequestKey]);

  const resetPostScanState = useCallback(() => {
    // A lost response or nonce-only desktop restart invalidates the review,
    // but the same application may already be durable. Keep its request ID.
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
    setRevealedFields([]);
  }, []);

  const resetProfileScopedState = useCallback(() => {
    setCompany('');
    setTitle('');
    setJobDraft(null);
    setManualJobDescription('');
    setTailorJobSource({ kind: 'idle', page: null });
    setShowJobSourceChoices(false);
    manualSourceBeforeEdit.current = null;
    resumeActionGeneration.current += 1;
    setGeneratedResume(null);
    setResumePreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setResumeOpenError(null);
    setFitAnalysis(null);
    setTailoringSourceId('');
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
      // Revocation can race a durable save. Forget the draft, but retain its
      // opaque identity so re-pairing cannot silently log the same action twice.
      applicationDraft.current = null;
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
    setProgress(null);
    setProgressNotes('');
    setDiscoveredFields([]);
    return true;
  }

  function handleProgress(update) {
    if (!operationPending.current) return;
    if (update?.kind === 'reasoning') {
      setProgressNotes((current) => String(update.message || `${current}${update.delta || ''}`).slice(-2000));
    } else if (update?.message) {
      setProgress({ stage: update.stage, message: String(update.message) });
    }
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

  async function handleResumeChange(event) {
    if (!beginOperation('resume-change')) return;
    const nextResumeId = event.target.value;
    try {
      // Re-pairing or reopening can select the first resume. Let the user
      // restore the pending action's resume without discarding its identity.
      setSelectedResumeId(nextResumeId);
      setFitAnalysis(null);
      setJobActionStatus('');
      tailoringRequest.current = null;
      resetPostScanState();
    } catch (error) {
      setRuntimeError(error);
    } finally {
      finishOperation('resume-change');
    }
  }

  function handleSourceChange(event) {
    if (!beginOperation('source-change')) return;
    setTailoringSourceId(event.target.value);
    setFitAnalysis(null);
    setJobActionStatus('');
    tailoringRequest.current = null;
    finishOperation('source-change');
  }

  function handleModelChange(event) {
    if (!beginOperation('model-change')) return;
    setSelectedModel(typeof event === 'string' ? event : event?.target?.value ?? '');
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
    onlyNewFields = false,
  }) {
    let snapshot = forceFresh ? null : pendingReview;

    setRuntimeError(null);
    setProgress(null);
    setProgressNotes('');
    if (snapshot) {
      setScanBusy(false);
      setMappingBusy(true);
      setDiscoveredFields(snapshot.descriptors);
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
        const page = result?.page && typeof result.page === 'object' ? result.page : {};
        if (onlyNewFields && (page.url !== reviewContext?.page?.url
          || (reviewContext?.page?.tabId != null && page.tabId !== reviewContext.page.tabId))) {
          setReviewStatus('The application page changed. Prepare a fresh autofill review.');
          return false;
        }
        const allDescriptors = Array.isArray(result?.descriptors) ? result.descriptors : [];
        const descriptors = onlyNewFields
          ? allDescriptors.filter((field) => !knownFieldIds.current.has(field.field_id))
          : allDescriptors;
        if (!onlyNewFields) knownFieldIds.current = new Set();
        for (const field of allDescriptors) knownFieldIds.current.add(field.field_id);
        setDiscoveredFields(descriptors);
        const pendingLog = applicationDraft.current;
        const samePendingApplication = pendingLog
          && pendingLog.profileId === activeConnection.profileId
          && pendingLog.variantId === activeResumeId
          && pendingLog.url === String(page.url ?? '')
          && pendingLog.pageCompany === String(page.company ?? '')
          && pendingLog.pageTitle === String(page.title ?? '');
        setCompany(samePendingApplication ? pendingLog.company : String(page.company ?? ''));
        setTitle(samePendingApplication ? pendingLog.title : String(page.title ?? ''));
        const job = jobFromPage(page);
        setJobDraft(page);
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
        { job: snapshot.job, ...(selectedModel ? { model: selectedModel } : {}), onProgress: handleProgress },
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

  async function handleReviewRevealedFields() {
    if (!selectedResumeId || !beginOperation('revealed-fields')) return;
    try {
      const ready = await connectionForAction();
      if (!ready || ready.contextChanged) return;
      await prepareReview({ activeConnection: ready.connection, activeResumeId: selectedResumeId, forceFresh: true, onlyNewFields: true });
    } finally {
      finishOperation('revealed-fields');
    }
  }

  async function handleStartOver() {
    if (!beginOperation('start-over')) return;
    setRuntimeError(null);
    try {
      await clearApplicationRequest();
      setCompany('');
      setTitle('');
      resetPostScanState();
    } catch (error) {
      setRuntimeError(error);
    } finally {
      finishOperation('start-over');
    }
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
    setDiscoveredFields(reviewItems.filter((item) => snapshot.fields.some((field) => field.field_id === item.field_id)));
    setRevealedFields([]);
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
      if (filledCount > 0) {
        setProgress({ stage: 'checking-fields', message: 'Checking for fields revealed by your answers…' });
        // Conditional sections often appear after selecting a degree or country.
        // A read-only rescan never fills these new fields without another review.
        try {
          const after = await client.scanPage();
          const originalPage = snapshot.reviewContext?.page;
          if (originalPage?.url && after?.page?.url === originalPage.url
            && (originalPage.tabId == null || after.page.tabId === originalPage.tabId)) {
            const nextFields = (Array.isArray(after.descriptors) ? after.descriptors : [])
              .filter((field) => !knownFieldIds.current.has(field.field_id));
            setRevealedFields(nextFields);
          }
        } catch {
          // The fill was acknowledged. A later scan failure must not invite
          // retrying an already completed write.
          setFillAnnouncement((message) => `${message} If another section appeared, prepare a new review.`);
        }
      }
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
    if (!applicationRequestKey || hasPendingInteraction() || logState === 'logged') return;
    logPending.current = true;
    setLogState('pending');
    setRuntimeError(null);

    try {
      const ready = await connectionForAction();
      if (!ready || ready.contextChanged) {
        setLogState('idle');
        return;
      }
      const payload = {
        profileContextId: ready.connection.profileContextId,
        variantId: selectedResumeId,
        company,
        title,
      };
      // Keep only opaque identity metadata in browser-session storage. The
      // desktop nonce and mutable form fingerprint must not change a retry.
      const identityBytes = new TextEncoder().encode(JSON.stringify([
        ready.connection.profileId, payload.variantId, payload.company,
        payload.title, payload.notes ?? '', reviewContext?.page?.url ?? '',
      ]));
      const digest = await globalThis.crypto.subtle.digest('SHA-256', identityBytes);
      const fingerprint = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
      let pending = applicationRequest.current;
      if (!pending && !freshApplicationIntent.current && applicationRequestStorage) {
        pending = (await withApplicationStorage((storage) => storage.get(applicationRequestKey)))[applicationRequestKey];
      }
      // An interrupted log may already be durable. Any changed details need
      // an explicit Start over before replacing that unresolved identity.
      if (pending?.profileId === ready.connection.profileId && pending.fingerprint !== fingerprint) {
        throw new Error('An earlier application log may have completed. Check On Paper, then choose Start over before logging another application.');
      }
      if (pending?.fingerprint !== fingerprint || pending?.profileId !== ready.connection.profileId
        || !REQUEST_ID_PATTERN.test(pending?.requestId ?? '')) {
        pending = { profileId: ready.connection.profileId, fingerprint, requestId: createRequestId() };
      }
      applicationRequest.current = pending;
      applicationDraft.current = {
        profileId: ready.connection.profileId, variantId: payload.variantId,
        company: payload.company, title: payload.title, url: String(reviewContext?.page?.url ?? ''),
        pageCompany: String(reviewContext?.page?.company ?? ''),
        pageTitle: String(reviewContext?.page?.title ?? ''),
      };
      // Fail before dispatch if identity cannot survive a panel close/reopen.
      await withApplicationStorage((storage) => storage?.set({ [applicationRequestKey]: pending }));
      freshApplicationIntent.current = false;
      await client.logApplication({ ...payload, requestId: pending.requestId });
      setLogState('logged');
      applicationRequest.current = null;
      applicationDraft.current = null;
      // A cleanup failure cannot turn an acknowledged write into a failed log.
      // Retaining the old ID is safe: a reopened panel receives the same record.
      await withApplicationStorage((storage) => storage?.remove(applicationRequestKey)).catch(() => {});
    } catch (error) {
      await handleWorkflowError(error);
      setLogState('idle');
    } finally {
      logPending.current = false;
    }
  }

  async function scanJobForAction({ forcePage = false } = {}) {
    if (manualJobEntry && !forcePage) {
      const description = manualJobDescription.trim();
      if (!description) {
        setJobActionStatus('Enter a job description to continue.');
        return { page: {}, job: null };
      }
      return { page: {}, job: jobFromPage({ description }) };
    }
    if (tailorJobSource.kind === 'captured' && !forcePage) {
      return { page: tailorJobSource.page, job: jobFromPage(tailorJobSource.page) };
    }
    setScanBusy(true);
    setShowJobSourceChoices(false);
    try {
      const result = await client.scanPage();
      const page = result?.page && typeof result.page === 'object' ? result.page : {};
      setManualJobDescription('');
      manualSourceBeforeEdit.current = null;
      if (!String(page.description ?? '').trim()) {
        setTailorJobSource({ kind: 'missing', page: null });
        setJobActionStatus('No job description found. Open the job posting and check again, or enter it manually.');
        return { page, job: null };
      }
      setTailorJobSource({ kind: 'captured', page });
      return { page, job: jobFromPage(page) };
    } catch (error) {
      setTailorJobSource({ kind: 'failed', page: null });
      throw error;
    } finally {
      setScanBusy(false);
    }
  }

  function clearTailoringResults() {
    setFitAnalysis(null);
    tailoringRequest.current = null;
    resumeActionGeneration.current += 1;
    setGeneratedResume(null);
    setResumePreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setResumeOpenError(null);
  }

  async function handleCheckJobPage() {
    if (!beginOperation('check-job-page')) return;
    clearTailoringResults();
    setRuntimeError(null);
    try {
      const scanned = await scanJobForAction({ forcePage: true });
      if (scanned.job) setJobActionStatus('Job description captured. Review it below, then choose your next step.');
    } catch (error) {
      setJobActionStatus('');
      await handleWorkflowError(error);
    } finally {
      finishOperation('check-job-page');
    }
  }

  function handleManualJobEntry() {
    if (hasPendingInteraction()) return;
    manualSourceBeforeEdit.current = tailorJobSource;
    setTailorJobSource({ kind: 'manual', page: null });
    setManualJobDescription('');
    setShowJobSourceChoices(false);
    setRuntimeError(null);
    clearTailoringResults();
    setJobActionStatus('Enter the job description, then choose Analyze fit or Create tailored resume.');
  }

  function handleCancelManualEntry() {
    if (hasPendingInteraction()) return;
    setTailorJobSource(manualSourceBeforeEdit.current || { kind: 'idle', page: null });
    manualSourceBeforeEdit.current = null;
    setManualJobDescription('');
    setJobActionStatus('');
    setRuntimeError(null);
    setShowJobSourceChoices(false);
    clearTailoringResults();
  }

  async function loadResumePreview(saved, generation) {
    setResumePreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    const current = () => generation === resumeActionGeneration.current
      && activeProfileContext.current === saved.profileContextId;
    try {
      if (!client.getResumePreview) throw Object.assign(new Error('Update On Paper to see previews.'), { code: 'app_update_required' });
      const preview = await client.getResumePreview(saved.profileContextId, saved.resume.id);
      if (current()) setResumePreview(preview);
    } catch (error) {
      if (!current()) return;
      if (error?.code === 'profile_changed' || PAIRING_ERROR_CODES.has(error?.code)) await handleWorkflowError(error);
      else setPreviewError(error);
    } finally {
      if (current()) setPreviewLoading(false);
    }
  }

  async function handleOpenGeneratedResume() {
    if (!generatedResume || !beginOperation('open-resume')) return;
    const saved = generatedResume;
    const generation = resumeActionGeneration.current;
    setOpeningResume(true);
    setResumeOpenError(null);
    try {
      const ready = await connectionForAction();
      if (!ready || ready.connection.profileContextId !== saved.profileContextId) return;
      if (!client.openResume) throw Object.assign(new Error('Update On Paper to open this resume.'), { code: 'app_update_required' });
      await client.openResume(saved.profileContextId, saved.resume.id);
    } catch (error) {
      if (generation !== resumeActionGeneration.current) return;
      if (error?.code === 'profile_changed' || PAIRING_ERROR_CODES.has(error?.code)) await handleWorkflowError(error);
      else setResumeOpenError(error);
    } finally {
      setOpeningResume(false);
      finishOperation('open-resume');
    }
  }

  function handleUseGeneratedResume() {
    if (!generatedResume || !beginOperation('use-generated-resume')) return;
    if (generatedResume.profileContextId === connection.profileContextId) {
      setSelectedResumeId(generatedResume.resume.id);
      resetPostScanState();
      setReviewStatus('Open the application page, then prepare an autofill review from your new resume.');
      setWorkflow('autofill');
    }
    finishOperation('use-generated-resume');
  }

  async function handleAnalyzeFit() {
    if (!beginOperation('analyze-fit')) return;
    setJobAction('analyzing');
    setJobActionStatus(tailoringSourceId ? 'Comparing this role with your resume…' : 'Comparing this role with your full profile…');
    setRuntimeError(null);
    setFitAnalysis(null);
    try {
      const ready = await connectionForAction();
      if (!ready) return;
      if (ready.contextChanged) {
        setJobActionStatus('Your profile changed. Review the current settings, then choose your next step.');
        return;
      }
      const resumeId = ready.connection.resumes.some((resume) => resume.id === tailoringSourceId) ? tailoringSourceId : '';
      const scanned = await scanJobForAction();
      if (!scanned.job) return;
      const result = await client.analyzeJobFit({
        profileContextId: ready.connection.profileContextId,
        ...(resumeId ? { resumeId } : {}),
        job: scanned.job,
        onProgress: handleProgress,
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
    if (!beginOperation('tailor')) return;
    setJobAction('tailoring');
    setJobActionStatus('Creating a tailored resume in On Paper…');
    setRuntimeError(null);
    try {
      const ready = await connectionForAction();
      if (!ready) return;
      if (ready.contextChanged) {
        setJobActionStatus('Your profile changed. Review the current settings, then choose your next step.');
        return;
      }
      const baseResumeId = ready.connection.resumes.some((resume) => resume.id === tailoringSourceId) ? tailoringSourceId : '';
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
        ...(baseResumeId ? { resumeId: baseResumeId } : {}),
        job: scanned.job,
        onProgress: handleProgress,
        requestId: tailoringRequest.current.id,
        ...(selectedModel ? { model: selectedModel } : {}),
      });
      const tailored = result?.resume;
      if (!tailored?.id) throw new Error('On Paper returned an invalid tailored resume');

      // Record the acknowledged save before any ancillary list/preview request.
      // If the connection drops now, the user still has the saved resume and
      // cannot mistake a refresh failure for a failed generation.
      const saved = { resume: tailored, profileContextId: ready.connection.profileContextId };
      const generation = ++resumeActionGeneration.current;
      setGeneratedResume(saved);
      setResumeOpenError(null);
      setSelectedResumeId(tailored.id);
      setConnection({ ...ready.connection, resumes: [...ready.connection.resumes.filter((resume) => resume.id !== tailored.id), tailored] });
      resetPostScanState();
      setJobActionStatus('');
      tailoringRequest.current = null;
      try {
        const refreshedData = await client.checkConnection();
        let refreshed = connectedState(refreshedData);
        if (refreshed.kind !== 'connected') {
          setConnection({ ...refreshed, ...ready.connection, kind: refreshed.kind, resumes: [...ready.connection.resumes.filter((resume) => resume.id !== tailored.id), tailored] });
        } else if (refreshed.profileContextId !== ready.connection.profileContextId) {
          resetProfileScopedState();
          setConnection(refreshed);
          setSelectedResumeId(refreshed.resumes[0]?.id ?? '');
          setJobActionStatus('On Paper reloaded or switched profiles. Review the refreshed resume list before continuing.');
          return;
        } else {
          if (!refreshed.resumes.some((resume) => resume.id === tailored.id)) {
            refreshed = { ...refreshed, resumes: [...refreshed.resumes, tailored] };
          }
          setConnection(refreshed);
        }
      } catch (refreshError) {
        await handleWorkflowError(refreshError);
      }
      // Preview failures never undo the saved result. Profile resets invalidate
      // this generation before any private thumbnail can be displayed.
      if (generation === resumeActionGeneration.current) void loadResumePreview(saved, generation);
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
    || pairingBusy
    || openingResume;
  const hasWorkspace = connection.resumes.length > 0 || connection.kind === 'connected';
  const processing = scanBusy || mappingBusy || fillBusy || jobAction !== 'idle';
  const processingHeading = fillBusy ? 'Filling your application' : mappingBusy ? 'Preparing your answers' : jobAction === 'analyzing' ? 'Reviewing your fit' : jobAction === 'tailoring' ? 'Creating your resume' : workflow === 'tailor' ? 'Reading the job page' : 'Reading the application';
  const processingMessage = scanBusy ? workflow === 'tailor' ? 'Capturing the job description and role details…' : 'Capturing the role and application fields…'
    : progress?.message || (fillBusy ? 'Filling the fields you reviewed…' : mappingBusy ? 'Matching your details to each field…' : jobActionStatus);
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
    'needs_pairing', 'unreachable', 'launch_failed', 'incompatible', 'unsupported_extension', 'opening', 'checking', 'reconnecting',
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
  const needsJobSource = ['missing', 'failed'].includes(tailorJobSource.kind);
  const settingsOpen = settingsExpanded[workflow];
  const selectedSource = connection.resumes.find((resume) => resume.id === (workflow === 'tailor' ? tailoringSourceId : selectedResumeId));
  const sourceSummary = selectedSource?.name || (workflow === 'tailor' ? 'My full profile' : 'Choose a resume');
  const modelSummary = selectedModel
    ? modelCatalog.models.find((model) => model.id === selectedModel)?.name || selectedModel
    : workflow === 'tailor' && modelCatalog.defaults.analysis !== modelCatalog.defaults.tailoring
      ? 'App defaults for each task'
      : `App default${defaultModelName(workflow === 'autofill' ? 'mapping' : 'tailoring') ? ` · ${defaultModelName(workflow === 'autofill' ? 'mapping' : 'tailoring')}` : ''}`;

  const workflowControls = (
    <section className="panel-section controls-section" aria-label={workflow === 'tailor' ? 'Tailoring settings' : 'Autofill settings'}>
      <button
        type="button"
        className="settings-toggle"
        aria-label={workflow === 'tailor' ? 'Tailoring settings' : 'Autofill settings'}
        aria-expanded={settingsOpen}
        aria-controls={`${workflow}-settings-fields`}
        aria-describedby={`${workflow}-settings-summary`}
        disabled={workflowBusy}
        onClick={() => setSettingsExpanded((current) => ({ ...current, [workflow]: !current[workflow] }))}
      >
        <span className="settings-summary" id={`${workflow}-settings-summary`}>
          <strong>Resume and model</strong>
          <span className="settings-choice">{sourceSummary}</span>
          <span className="settings-choice">{modelSummary}</span>
          {modelCatalog.state === 'unavailable' ? <span className="settings-notice">Models unavailable · expand to retry</span> : null}
          {modelCatalog.state === 'loading' ? <span className="settings-notice">Loading models…</span> : null}
        </span>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="m5 7 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div id={`${workflow}-settings-fields`} className="settings-fields" hidden={!settingsOpen}>
      <div className="picker-field">
        <label htmlFor="resume-picker">{workflow === 'tailor' ? 'Source' : 'Resume to fill from'}</label>
        <select
          id="resume-picker"
          value={workflow === 'tailor' ? tailoringSourceId : selectedResumeId}
          onChange={workflow === 'tailor' ? handleSourceChange : handleResumeChange}
          disabled={workflowBusy}
        >
          {workflow === 'tailor' ? <option value="">My full profile</option> : !connection.resumes.length ? <option value="">Create a resume to autofill</option> : null}
          {connection.resumes.map((resume) => (
            <option key={resume.id} value={resume.id}>{resume.name}</option>
          ))}
        </select>
        {workflow === 'tailor' ? <p className="supporting-copy">{tailoringSourceId ? 'Creates a new copy. Your base resume stays unchanged.' : 'Uses your complete career details in On Paper. No existing resume needed.'}</p> : null}
      </div>
      <div className="picker-field">
        <label htmlFor="model-picker">AI model</label>
        <ModelPicker
          id="model-picker"
          models={modelCatalog.models}
          value={selectedModel}
          defaultModelId={modelCatalog.defaults[workflow === 'autofill' ? 'mapping' : 'tailoring'] || ''}
          defaultModelName={defaultModelName(workflow === 'autofill' ? 'mapping' : 'tailoring')}
          onChange={handleModelChange}
          disabled={workflowBusy || modelCatalog.state === 'loading' || (!selectedModel && (modelCatalog.state !== 'ready' || modelCatalog.models.length === 0))}
          loading={modelCatalog.state === 'loading'}
          error={modelCatalog.error}
        />
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
        {modelCatalog.error ? (
          <div className="model-load-error">
            <p id="model-error" role="alert">Could not load models: {modelCatalog.error}</p>
            <button type="button" className="text-button" disabled={workflowBusy || connection.kind !== 'connected'} onClick={handleRetryModels}>Retry loading models</button>
          </div>
        ) : null}
      </div>
      </div>
    </section>
  );

  return (
    <>
    {processing ? <ProcessingView heading={processingHeading} message={processingMessage} reasoning={progressNotes} fields={discoveredFields} job={scanBusy ? null : workflow === 'tailor' ? tailorJobSource.page : jobDraft} step={scanBusy ? 'scanning' : progress?.stage} /> : null}
    <main className="panel-shell" hidden={processing}>
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

      {connection.kind === 'connected' && !connection.resumes.length && workflow === 'autofill' ? (
        <section className="panel-section" aria-labelledby="empty-resumes-heading">
          <h2 id="empty-resumes-heading">Create your first resume</h2>
          <p className="supporting-copy">Choose Tailor resume to build one from your full profile, or add a resume in On Paper.</p>
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
              {generatedResume ? <GeneratedResume
                key={generatedResume.resume.id}
                resume={generatedResume.resume}
                preview={resumePreview}
                previewLoading={previewLoading}
                previewError={previewError}
                onRetryPreview={() => void loadResumePreview(generatedResume, ++resumeActionGeneration.current)}
                onOpenInApp={handleOpenGeneratedResume}
                opening={openingResume}
                openError={resumeOpenError}
                onPrepareAutofill={handleUseGeneratedResume}
                disabled={workflowBusy}
              /> : null}
              {workflowControls}
              <section className="panel-section job-actions-section" aria-labelledby="job-actions-heading">
                <h2 id="job-actions-heading">{needsJobSource ? 'Job description needed' : 'Prepare for this role'}</h2>
                <p className="supporting-copy">
                  {needsJobSource
                    ? tailorJobSource.kind === 'missing'
                      ? 'No job description was found. Open the job posting and check again, or enter it manually.'
                      : 'The job page couldn’t be read. Check it again, or enter the description manually.'
                    : manualJobEntry
                      ? 'Use the description you enter below to analyze your fit or create a focused resume.'
                      : tailorJobSource.kind === 'captured'
                        ? 'Use the captured job description below to analyze your fit or create a focused resume.'
                        : 'Read the job description on this page to analyze your fit or create a focused resume.'}
                </p>
                {tailorJobSource.kind === 'captured' ? <button
                  type="button"
                  className="text-button job-source-toggle"
                  disabled={workflowBusy}
                  aria-expanded={showJobSourceChoices}
                  aria-controls="job-source-choices"
                  onClick={() => setShowJobSourceChoices((current) => !current)}
                >{showJobSourceChoices ? 'Keep current job' : 'Change job description'}</button> : null}
                {needsJobSource || showJobSourceChoices ? <div id="job-source-choices" className="button-row job-source-actions">
                  <button type="button" className="secondary-button" disabled={workflowBusy} onClick={handleCheckJobPage}>Check web page again</button>
                  <button type="button" className="secondary-button" disabled={workflowBusy} onClick={handleManualJobEntry}>Manually enter job description</button>
                </div> : null}
                {manualJobEntry ? (
                  <div className="manual-job-entry">
                    <label htmlFor="manual-job-description">Job description</label>
                    <textarea
                      id="manual-job-description"
                      value={manualJobDescription}
                      placeholder="Paste the job description"
                      autoFocus
                      disabled={workflowBusy}
                      onChange={(event) => {
                        setManualJobDescription(event.target.value);
                        clearTailoringResults();
                        setJobActionStatus('');
                        setRuntimeError(null);
                      }}
                    />
                    <div className="button-row manual-source-actions">
                      <button type="button" className="text-button" disabled={workflowBusy} onClick={handleCancelManualEntry}>Cancel manual entry</button>
                      <button type="button" className="text-button" disabled={workflowBusy} onClick={handleCheckJobPage}>Check web page again</button>
                    </div>
                  </div>
                ) : null}
                {!needsJobSource && !showJobSourceChoices ? <div className="button-row">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={workflowBusy || (manualJobEntry && !manualJobDescription.trim())}
                    onClick={handleAnalyzeFit}
                  >
                    {jobAction === 'analyzing' ? 'Analyzing fit…' : 'Analyze fit'}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={workflowBusy || (manualJobEntry && !manualJobDescription.trim())}
                    onClick={handleCreateTailoredResume}
                  >
                    {jobAction === 'tailoring' ? 'Creating tailored resume…' : 'Create tailored resume'}
                  </button>
                </div> : null}
                {jobActionStatus && !needsJobSource ? (
                  <p className="supporting-copy job-action-status" role="status" aria-live="polite">
                    {jobActionStatus}
                  </p>
                ) : null}
              </section>

              {tailorJobSource.kind === 'captured' || (manualJobEntry && manualJobDescription.trim()) || fitAnalysis ? <div className="job-results" ref={fitResultRef}>
                <JobContext job={tailorJobSource.page || {}} description={manualJobDescription} manual={manualJobEntry} />
                <FitAnalysis analysis={fitAnalysis} />
              </div> : null}
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

              {revealedFields.length ? (
                <section className="panel-section revealed-fields" aria-label="Newly revealed fields">
                  <h3>{revealedFields.length} more {revealedFields.length === 1 ? 'field appeared' : 'fields appeared'}</h3>
                  <p className="supporting-copy">The form revealed more questions after your answers.</p>
                  <ul className="keyword-list">{revealedFields.map((field) => <li key={field.field_id}>{field.label || 'Application field'}</li>)}</ul>
                  <button type="button" className="primary-button" disabled={workflowBusy} onClick={handleReviewRevealedFields}>Review newly revealed fields</button>
                </section>
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
                    disabled={!applicationRequestKey || workflowBusy || logState !== 'idle'}
                    onClick={handleLogApplication}
                  >
                    {logState === 'pending'
                      ? 'Logging…'
                      : logState === 'logged'
                        ? 'Application logged'
                        : 'Log application'}
                  </button>
                  {applicationStorageError ? <p className="error-message" role="alert">{applicationStorageError}</p> : null}
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
    </>
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
