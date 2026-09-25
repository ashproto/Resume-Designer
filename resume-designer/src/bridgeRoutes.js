/**
 * Bridge Router
 *
 * Pure request routing for the companion-extension bridge: auth check +
 * endpoint logic, with every capability injected (see bridge.js for the real
 * deps). Pure so vitest can drive the full HTTP surface without Tauri.
 *
 * Contract with bridge.js / bridge.rs: input is {method, path, authorization,
 * body:string}; output is {status, body:object} — bridge.js stringifies body.
 */

const json = (status, body) => ({ status, body });

export const COMPANION_PROTOCOL_VERSION = 2;
export const COMPANION_CAPABILITIES = Object.freeze([
  'app.launch',
  'pairing.challenge',
  'pairing.request',
  'pairing.revoke',
  'profile.context',
  'resume.pdf',
  'ai.complete',
  'ai.models',
  'ai.job-fit',
  'ai.tailored-resume',
  'profile.answers',
  'applications.log',
]);

const profileChanged = () => json(409, {
  error: 'profile context changed; refresh the companion extension',
  code: 'profile_changed',
});

const importInProgress = () => json(503, {
  error: 'a data import is in progress; retry after the app reloads',
  code: 'profile_changed',
});

const isProfileSensitiveRequest = (method, path) => (
  (method === 'GET' && /^\/resumes(?:\/|$)/.test(path))
  || (
    method === 'POST'
    && [
      '/ai/complete',
      '/ai/job-fit',
      '/ai/tailored-resume',
      '/applications',
      '/profile/answers',
    ].includes(path)
  )
);

const matchesProfileContext = (expected, actual) => (
  typeof expected === 'string'
  && expected.length > 0
  && typeof actual === 'string'
  && actual.length > 0
  && expected === actual
);

/** Own-key variant lookup — inherited keys (__proto__, constructor) must 404, not resolve. */
const findVariant = (variants, id) => (Object.hasOwn(variants, id) ? variants[id] : undefined);

/** "Backend Resume" -> "Backend-Resume.pdf" (safe cross-platform filename). */
function pdfFilename(name) {
  const base = String(name || 'Resume').trim().replace(/[^\p{L}\p{N} _.-]+/gu, '').replace(/\s+/g, '-');
  return `${base || 'Resume'}.pdf`;
}

export function createBridgeRouter(deps) {
  let authorizationGeneration = 0;
  let pendingRevocations = 0;
  let saveTail;

  async function persistMutation(write, message) {
    let rollback;
    try {
      if (typeof deps.flush !== 'function') throw new Error('Storage is unavailable');
      // Keep this response bound to the write being flushed, even if a later
      // edit changes a mutable application before storage settles.
      const result = structuredClone(write((undo) => { rollback = undo; }));
      if (await deps.flush() !== true) throw new Error('Storage write did not reach disk');
      return result;
    } catch (cause) {
      try {
        // Replace the queued collection as well as its owner cache. If the
        // corrective write also fails, appStorage retains it for recovery.
        if (rollback?.()) await deps.flush();
      } catch { /* Preserve the original storage failure; never acknowledge it. */ }
      throw Object.assign(new Error(message, { cause }), { status: 507, code: 'storage_full' });
    }
  }

  async function executeBridgeRequest({ method, path, authorization, body }, authorizationState = {
    generation: authorizationGeneration, revoking: pendingRevocations > 0,
  }) {
    if (method === 'GET' && path === '/health') {
      return json(200, {
        ok: true,
        app: 'resume-designer',
        version: deps.version,
        protocolVersion: COMPANION_PROTOCOL_VERSION,
        capabilities: [...COMPANION_CAPABILITIES],
      });
    }

    if (method === 'POST' && ['/pairing/claim', '/pairing/request'].includes(path)) {
      let claim;
      try {
        claim = body ? JSON.parse(body) : {};
      } catch {
        return json(400, { error: 'invalid JSON body' });
      }
      if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
        return json(400, { error: 'JSON body must be an object' });
      }
      try {
        if (path === '/pairing/request') {
          if (deps.writesSuspended?.()) return importInProgress();
          return await deps.requestPairing(claim);
        }
        return await deps.claimPairing(claim);
      } catch (error) {
        return json(500, { error: error?.message || 'pairing failed' });
      }
    }

    const token = deps.getToken();
    if (!token || authorization !== `Bearer ${token}`) {
      return json(401, { error: 'invalid or missing bearer token' });
    }

    const assertAuthorized = () => {
      if (authorizationState.generation !== authorizationGeneration
        || authorizationState.revoking || pendingRevocations > 0
        || deps.getToken() !== token) {
        throw Object.assign(new Error('pairing was revoked; connect again to continue'), {
          status: 401, code: 'unauthorized',
        });
      }
    };

    let parsed = null;
    if (method === 'POST') {
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        return json(400, { error: 'invalid JSON body' });
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return json(400, { error: 'JSON body must be an object' });
      }
    }

    try {
      if (method === 'POST' && path === '/pairing/revoke') {
        // Invalidate pending operations even if durable rotation fails and the
        // old token is restored. Only a new request can use that restored token.
        authorizationGeneration += 1;
        pendingRevocations += 1;
        try {
          await deps.revokePairing();
          return json(200, { ok: true });
        } finally {
          pendingRevocations -= 1;
        }
      }

      // A destructive import updates appStorage before the success-modal reload,
      // while several module caches still describe the previous profile. Treat
      // the whole window as an invalid context: even reads could otherwise mix
      // restored data with stale learned answers or let an old review fill.
      if (deps.writesSuspended?.() && isProfileSensitiveRequest(method, path)) {
        return importInProgress();
      }

      if (method === 'GET' && path === '/ai/models') {
        return json(200, deps.getAiModels());
      }

      if (method === 'GET' && path === '/resumes') {
        const resumes = Object.values(deps.getVariants())
          .map((v) => ({ id: v.id, name: v.name, updatedAt: v.updatedAt }))
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        return json(200, {
          profileId: deps.profileId,
          profileContextId: deps.profileContextId,
          resumes,
        });
      }

      const detail = method === 'GET' && path.match(/^\/resumes\/([^/]+)$/);
      if (detail) {
        const variant = findVariant(deps.getVariants(), detail[1]);
        if (!variant) return json(404, { error: `no resume with id ${detail[1]}` });
        return json(200, {
          profileId: deps.profileId,
          profileContextId: deps.profileContextId,
          id: variant.id,
          name: variant.name,
          updatedAt: variant.updatedAt,
          data: variant.data,
          profile: deps.getUserProfile(),
          learnedAnswers: deps.getLearnedAnswers(),
        });
      }

      const pdf = method === 'GET' && path.match(/^\/resumes\/([^/]+)\/pdf$/);
      if (pdf) {
        const variant = findVariant(deps.getVariants(), pdf[1]);
        if (!variant) return json(404, { error: `no resume with id ${pdf[1]}` });
        const pdfBase64 = await deps.exportVariantPdf(variant.id);
        if (deps.writesSuspended?.()) return importInProgress();
        return json(200, {
          profileId: deps.profileId,
          profileContextId: deps.profileContextId,
          filename: pdfFilename(variant.name),
          pdfBase64,
        });
      }

      let modelOptions = {};
      if (method === 'POST' && ['/ai/complete', '/ai/job-fit', '/ai/tailored-resume'].includes(path)) {
        if (!matchesProfileContext(parsed.profileContextId, deps.profileContextId)) {
          return profileChanged();
        }
        if (parsed.model !== undefined) {
          if (typeof parsed.model !== 'string' || !parsed.model || parsed.model.length > 256
            || !deps.getAiModels().models.some((model) => model.id === parsed.model)) {
            return json(400, { error: 'Choose an available AI model', code: 'invalid_model' });
          }
          modelOptions = { model: parsed.model };
        }
      }

      if (method === 'POST' && path === '/ai/complete') {
        if (!matchesProfileContext(parsed.profileContextId, deps.profileContextId)) {
          return profileChanged();
        }
        const messages = parsed.messages;
        const valid = Array.isArray(messages) && messages.length > 0
          && messages.every((m) => m && typeof m.role === 'string' && typeof m.content === 'string');
        if (!valid) return json(400, { error: 'messages must be a non-empty array of {role, content}' });
        try {
          const text = await deps.complete(messages, {
            ...modelOptions,
            systemPrompt: parsed.systemPrompt,
            reasoningEffort: parsed.reasoningEffort,
          });
          if (deps.writesSuspended?.()) return importInProgress();
          return json(200, { text });
        } catch (err) {
          return json(502, { error: err?.message || 'AI request failed' });
        }
      }

      if (method === 'POST' && path === '/ai/job-fit') {
        if (!matchesProfileContext(parsed.profileContextId, deps.profileContextId)) {
          return profileChanged();
        }
        const result = await deps.analyzeJobFit({
          ...modelOptions,
          resumeId: parsed.resumeId,
          job: parsed.job,
        });
        if (deps.writesSuspended?.()) return importInProgress();
        return json(200, {
          profileId: deps.profileId,
          profileContextId: deps.profileContextId,
          resumeId: result.resumeId,
          analysis: result.analysis,
        });
      }

      if (method === 'POST' && path === '/ai/tailored-resume') {
        if (!matchesProfileContext(parsed.profileContextId, deps.profileContextId)) {
          return profileChanged();
        }
        const result = await deps.createTailoredResume({
          ...modelOptions,
          resumeId: parsed.resumeId,
          requestId: parsed.requestId,
          job: parsed.job,
        }, { assertAuthorized });
        if (deps.writesSuspended?.()) return importInProgress();
        return json(result.created ? 201 : 200, {
          profileId: deps.profileId,
          profileContextId: deps.profileContextId,
          created: result.created,
          resume: result.resume,
        });
      }

      if (method === 'POST' && path === '/applications') {
        if (!matchesProfileContext(parsed.profileContextId, deps.profileContextId)) {
          return profileChanged();
        }
        const variantId = typeof parsed.variantId === 'string' ? parsed.variantId.trim() : '';
        if (!variantId) return json(400, { error: 'variantId is required' });
        const variant = findVariant(deps.getVariants(), variantId);
        if (!variant) return json(404, { error: `no resume with id ${variantId}` });
        assertAuthorized();
        const application = await persistMutation((registerRollback) => deps.addApplication({
          variantId,
          variantName: variant.name,
          jobSnapshot: {
            title: typeof parsed.title === 'string' ? parsed.title : '',
            company: typeof parsed.company === 'string' ? parsed.company : '',
          },
          status: 'applied',
          notes: typeof parsed.notes === 'string' ? parsed.notes : '',
        }, { throwOnFailure: true, registerRollback }), 'Could not save the application');
        assertAuthorized();
        if (deps.writesSuspended?.()) return importInProgress();
        return json(201, { application });
      }

      if (method === 'POST' && path === '/profile/answers') {
        if (!matchesProfileContext(parsed.profileContextId, deps.profileContextId)) {
          return profileChanged();
        }
        const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
        const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
        if (!question || !answer) return json(400, { error: 'question and answer are required' });
        assertAuthorized();
        const saved = await persistMutation(
          (registerRollback) => deps.saveLearnedAnswer(question, answer, { throwOnFailure: true, registerRollback }),
          'Could not save the reusable answer',
        );
        assertAuthorized();
        if (deps.writesSuspended?.()) return importInProgress();
        return json(201, { answer: saved });
      }

      return json(404, { error: `no route: ${method} ${path}` });
    } catch (err) {
      const status = Number.isInteger(err?.status) ? err.status : 500;
      const response = { error: err?.message || 'internal error' };
      if (typeof err?.code === 'string' && err.code) response.code = err.code;
      return json(status, response);
    }
  }

  return function handleBridgeRequest(request) {
    if (request.method !== 'POST' || !['/applications', '/profile/answers'].includes(request.path)) {
      return executeBridgeRequest(request);
    }
    // appStorage reads the current cached value when a queued write runs. Keep
    // each bridge save and its durability check together so another save cannot
    // replace that value before it reaches disk. All request checks run again
    // when its turn starts; reads and revocation never wait behind this queue.
    const authorizationState = {
      generation: authorizationGeneration, revoking: pendingRevocations > 0,
    };
    const execute = () => executeBridgeRequest(request, authorizationState);
    const response = saveTail ? saveTail.then(execute) : execute();
    const settled = response.then(() => undefined, () => undefined);
    saveTail = settled;
    void settled.then(() => {
      if (saveTail === settled) saveTail = undefined;
    });
    return response;
  };
}
