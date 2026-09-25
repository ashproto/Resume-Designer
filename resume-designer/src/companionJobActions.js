import { experienceScalarWrite } from './changeApply.js';

export const MAX_JOB_DESCRIPTION_BYTES = 64 * 1024;

const MAX_JOB_TITLE_CHARS = 300;
const MAX_JOB_COMPANY_CHARS = 300;
const MAX_JOB_URL_CHARS = 2_048;
const MAX_AI_STRING_CHARS = 8_000;
const MAX_AI_ARRAY_ITEMS = 100;
const MAX_AI_OBJECT_KEYS = 100;
const MAX_CHANGE_COUNT = 200;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CHANGE_ROOTS = new Set([
  'contact',
  'education',
  'experience',
  'name',
  'sections',
  'summary',
  'tagline',
  'tools',
]);
const CONTACT_FIELDS = new Set([
  'email',
  'github',
  'instagram',
  'linkedin',
  'location',
  'phone',
  'portfolio',
  'twitter',
  'website',
]);
const EXPERIENCE_TEXT_FIELDS = new Set([
  'company',
  'dates',
  'endDate',
  'location',
  'startDate',
  'title',
]);
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function actionError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function profileChangedError() {
  return actionError(503, 'profile_changed', 'a data import is in progress; retry after the app reloads');
}

function ownVariant(variants, id) {
  return variants && Object.hasOwn(variants, id) ? variants[id] : null;
}

function normalizeText(value, maxChars, field) {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (normalized.length > maxChars) {
    throw actionError(400, 'invalid_job', `${field} is too long`);
  }
  return normalized;
}

function normalizeJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    throw actionError(400, 'invalid_job', 'job details are required');
  }

  const title = normalizeText(job.title, MAX_JOB_TITLE_CHARS, 'job title');
  const company = normalizeText(job.company, MAX_JOB_COMPANY_CHARS, 'company');
  const description = typeof job.description === 'string'
    ? job.description.replace(/\s+/g, ' ').trim()
    : '';
  if (!description) throw actionError(400, 'invalid_job', 'job description is required');
  if (new TextEncoder().encode(description).byteLength > MAX_JOB_DESCRIPTION_BYTES) {
    throw actionError(400, 'invalid_job', 'job description is too long');
  }

  const url = normalizeText(job.url, MAX_JOB_URL_CHARS, 'job URL');
  if (url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw actionError(400, 'invalid_job', 'job URL must use HTTP or HTTPS');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw actionError(400, 'invalid_job', 'job URL must use HTTP or HTTPS');
    }
  }

  return { title, company, description, url };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateBoundedAiValue(value, depth = 0) {
  if (depth > 8) throw actionError(502, 'invalid_ai_response', 'AI response is too deeply nested');
  if (typeof value === 'string') {
    if (value.length > MAX_AI_STRING_CHARS) {
      throw actionError(502, 'invalid_ai_response', 'AI response contains oversized text');
    }
    return;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return;
  if (Array.isArray(value)) {
    if (value.length > MAX_AI_ARRAY_ITEMS) {
      throw actionError(502, 'invalid_ai_response', 'AI response contains too many items');
    }
    value.forEach((item) => validateBoundedAiValue(item, depth + 1));
    return;
  }
  if (!isPlainObject(value)) {
    throw actionError(502, 'invalid_ai_response', 'AI response has an invalid shape');
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_AI_OBJECT_KEYS) {
    throw actionError(502, 'invalid_ai_response', 'AI response contains too many fields');
  }
  for (const [key, child] of entries) {
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) {
      throw actionError(502, 'invalid_ai_response', 'AI response contains an unsafe field');
    }
    validateBoundedAiValue(child, depth + 1);
  }
}

function validateAnalysis(value) {
  validateBoundedAiValue(value);
  if (!isPlainObject(value) || !Number.isFinite(value.matchScore)) {
    throw actionError(502, 'invalid_ai_response', 'AI returned invalid analysis');
  }
  if (value.matchScore < 0 || value.matchScore > 100) {
    throw actionError(502, 'invalid_ai_response', 'AI returned invalid analysis');
  }
  for (const field of [
    'keywordMatches',
    'missingKeywords',
    'strengths',
    'gaps',
    'recommendations',
  ]) {
    if (!Array.isArray(value[field])) {
      throw actionError(502, 'invalid_ai_response', 'AI returned invalid analysis');
    }
  }
  if (value.evidence !== undefined && !Array.isArray(value.evidence)) {
    throw actionError(502, 'invalid_ai_response', 'AI returned invalid analysis');
  }
  return value;
}

function parseChangePath(path) {
  if (typeof path !== 'string' || !path || path.length > 300) return null;
  const segments = [];
  const pattern = /([A-Za-z][A-Za-z0-9_-]*)|\[(\d+)\]/g;
  let cursor = 0;
  for (const match of path.matchAll(pattern)) {
    if (match.index !== cursor) {
      if (path[cursor] !== '.' || match.index !== cursor + 1) return null;
    }
    const segment = match[1] ?? Number(match[2]);
    if (typeof segment === 'string' && FORBIDDEN_PATH_SEGMENTS.has(segment)) return null;
    if (typeof segment === 'number' && segment >= MAX_AI_ARRAY_ITEMS) return null;
    segments.push(segment);
    cursor = match.index + match[0].length;
  }
  if (cursor !== path.length || segments.length === 0 || !SAFE_CHANGE_ROOTS.has(segments[0])) {
    return null;
  }
  return segments;
}

function isStringArray(value) {
  return Array.isArray(value)
    && value.length <= MAX_AI_ARRAY_ITEMS
    && value.every((item) => typeof item === 'string' && item.length <= MAX_AI_STRING_CHARS);
}

function isWritableChange(target, segments, value) {
  const [root, index, field, childIndex] = segments;
  if (segments.length === 1) {
    return ['name', 'summary', 'tagline', 'tools'].includes(root) && typeof value === 'string';
  }

  if (root === 'contact') {
    return segments.length === 2 && CONTACT_FIELDS.has(index) && typeof value === 'string';
  }

  if (root === 'education') {
    return segments.length === 2
      && Number.isInteger(index)
      && Array.isArray(target.education)
      && index <= target.education.length
      && typeof value === 'string';
  }

  if (root === 'experience') {
    if (!Number.isInteger(index) || !Array.isArray(target.experience)) return false;
    const experience = target.experience[index];
    if (!isPlainObject(experience)) return false;
    if (segments.length === 3 && EXPERIENCE_TEXT_FIELDS.has(field)) {
      return typeof value === 'string';
    }
    if (segments.length === 3 && field === 'bullets') {
      return isStringArray(value);
    }
    return segments.length === 4
      && field === 'bullets'
      && Number.isInteger(childIndex)
      && Array.isArray(experience.bullets)
      && childIndex <= experience.bullets.length
      && typeof value === 'string';
  }

  if (root === 'sections') {
    if (!Number.isInteger(index) || !Array.isArray(target.sections)) return false;
    const section = target.sections[index];
    if (!isPlainObject(section)) return false;
    if (segments.length === 3 && field === 'title') return typeof value === 'string';
    if (segments.length === 3 && field === 'content') {
      if (Array.isArray(section.content)) return isStringArray(value);
      if (typeof section.content === 'string') return typeof value === 'string';
      return false;
    }
    return segments.length === 4
      && field === 'content'
      && Number.isInteger(childIndex)
      && Array.isArray(section.content)
      && childIndex <= section.content.length
      && typeof value === 'string';
  }

  return false;
}

function applyChange(target, path, value) {
  const segments = parseChangePath(path);
  if (!segments || !isWritableChange(target, segments, value)) return false;
  validateBoundedAiValue(value);

  // Keep companion tailoring aligned with the editor and AI review surfaces:
  // date display edits clear structured dates, and grouped company edits fan out.
  const rewrittenExperience = experienceScalarWrite(target.experience, path, value);
  if (rewrittenExperience) {
    target.experience = rewrittenExperience;
    return true;
  }

  let owner = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (owner === null || typeof owner !== 'object' || !Object.hasOwn(owner, segment)) return false;
    owner = owner[segment];
  }

  const last = segments.at(-1);
  if (Array.isArray(owner)) {
    if (typeof last !== 'number' || last > owner.length) return false;
  } else if (!isPlainObject(owner) || typeof last !== 'string') {
    return false;
  }
  owner[last] = structuredClone(value);
  return true;
}

function tailoredData(baseData, generated) {
  if (!isPlainObject(generated) || !isPlainObject(generated.changes)) {
    throw actionError(502, 'invalid_ai_response', 'AI returned invalid resume changes');
  }
  const entries = Object.entries(generated.changes);
  if (entries.length === 0 || entries.length > MAX_CHANGE_COUNT) {
    throw actionError(502, 'invalid_ai_response', 'AI returned invalid resume changes');
  }

  const next = structuredClone(baseData);
  for (const [path, value] of entries) {
    if (!applyChange(next, path, value)) {
      throw actionError(502, 'invalid_ai_response', 'AI returned an unsafe resume change');
    }
  }
  return next;
}

function modelFor(settings, preferredKey, fallback) {
  return settings?.[preferredKey] || settings?.defaultModel || fallback;
}

function resumeSummary(variant) {
  return { id: variant.id, name: variant.name, updatedAt: variant.updatedAt };
}

async function requestFingerprint(resumeId, job, model) {
  const bytes = new TextEncoder().encode(JSON.stringify({ resumeId, job, ...(model ? { model } : {}) }));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createCompanionJobActions(deps) {
  const inFlight = new Map();

  function ensureAvailable() {
    if (deps.writesSuspended?.()) throw profileChangedError();
  }

  async function ensureDurable() {
    const durable = deps.flush ? await deps.flush() : true;
    if (durable !== true) {
      throw actionError(507, 'storage_full', 'Could not save the tailored resume');
    }
  }

  function selectedVariant(resumeId) {
    const variant = ownVariant(deps.getVariants(), resumeId);
    if (!variant) throw actionError(404, 'resume_not_found', `no resume with id ${resumeId}`);
    return variant;
  }

  async function analyzeJobFit({ resumeId, job, model: selectedModel }) {
    ensureAvailable();
    const variant = selectedVariant(resumeId);
    const normalizedJob = normalizeJob(job);
    const settings = deps.getSettings();
    const model = selectedModel || modelFor(settings, 'analysisModel', deps.getDefaultModelId());
    let result;
    try {
      result = await deps.analyzeResumeDataAgainstJobs(
        model,
        structuredClone(variant.data),
        [normalizedJob],
        { reasoningEffort: settings?.analysisReasoning || 'medium' },
      );
    } catch (error) {
      if (error?.code) throw error;
      throw actionError(502, 'ai_failed', error?.message || 'Job-fit analysis failed');
    }
    ensureAvailable();
    return { resumeId: variant.id, analysis: validateAnalysis(result) };
  }

  async function createTailoredResume({ resumeId, requestId, job, model: selectedModel }) {
    if (!REQUEST_ID_PATTERN.test(requestId ?? '')) {
      throw actionError(400, 'invalid_request_id', 'requestId must be a UUID');
    }

    ensureAvailable();
    const normalizedJob = normalizeJob(job);
    const fingerprint = await requestFingerprint(resumeId, normalizedJob, selectedModel);
    const variantId = `companion-${requestId}`;
    const existing = ownVariant(deps.getVariants(), variantId);
    if (existing) {
      if (
        existing.companionRequest?.requestId !== requestId
        || existing.companionRequest?.fingerprint !== fingerprint
      ) {
        throw actionError(409, 'idempotency_conflict', 'requestId was already used for different tailoring input');
      }
      ensureAvailable();
      if (!deps.loadVariant(variantId)) {
        throw actionError(507, 'storage_full', 'Could not load the tailored resume');
      }
      await ensureDurable();
      ensureAvailable();
      return { created: false, resume: resumeSummary(existing) };
    }
    const active = inFlight.get(requestId);
    if (active) {
      if (active.fingerprint !== fingerprint) {
        throw actionError(409, 'idempotency_conflict', 'requestId was already used for different tailoring input');
      }
      return active.operation;
    }

    const operation = (async () => {
      const base = selectedVariant(resumeId);
      const settings = deps.getSettings();
      const model = selectedModel || modelFor(settings, 'tailorModel', deps.getDefaultModelId());
      let generated;
      try {
        generated = await deps.generateResumeChangesForData(
          model,
          structuredClone(base.data),
          'Tailor this resume for the target job while keeping every claim truthful.',
          null,
          { jobDescriptions: [normalizedJob] },
          'tailor',
          { reasoningEffort: settings?.tailorReasoning || 'medium' },
        );
      } catch (error) {
        if (error?.code) throw error;
        throw actionError(502, 'ai_failed', error?.message || 'Resume tailoring failed');
      }

      const data = tailoredData(base.data, generated);
      ensureAvailable();
      const baseName = [normalizedJob.title, normalizedJob.company].filter(Boolean).join(' — ')
        || `${base.name} — Tailored`;
      const name = deps.generateUniqueVariantName(baseName, deps.getVariants());
      if (!deps.saveVariant(variantId, name, data, {
        companionRequest: { requestId, fingerprint },
      })) {
        throw actionError(507, 'storage_full', 'Could not save the tailored resume');
      }
      const saved = ownVariant(deps.getVariants(), variantId);
      if (!saved || !deps.loadVariant(variantId)) {
        throw actionError(507, 'storage_full', 'Could not load the tailored resume');
      }
      await ensureDurable();
      ensureAvailable();
      return { created: true, resume: resumeSummary(saved) };
    })();

    inFlight.set(requestId, { fingerprint, operation });
    void operation.then(() => {
      if (inFlight.get(requestId)?.operation === operation) inFlight.delete(requestId);
    }, () => {
      if (inFlight.get(requestId)?.operation === operation) inFlight.delete(requestId);
    });
    return operation;
  }

  return { analyzeJobFit, createTailoredResume };
}
