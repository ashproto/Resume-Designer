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
    && ['/ai/complete', '/applications', '/profile/answers'].includes(path)
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
  return async function handleBridgeRequest({ method, path, authorization, body }) {
    if (method === 'GET' && path === '/health') {
      return json(200, { ok: true, app: 'resume-designer', version: deps.version });
    }

    const token = deps.getToken();
    if (!token || authorization !== `Bearer ${token}`) {
      return json(401, { error: 'invalid or missing bearer token' });
    }

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
      // A destructive import updates appStorage before the success-modal reload,
      // while several module caches still describe the previous profile. Treat
      // the whole window as an invalid context: even reads could otherwise mix
      // restored data with stale learned answers or let an old review fill.
      if (deps.writesSuspended?.() && isProfileSensitiveRequest(method, path)) {
        return importInProgress();
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
        return json(200, {
          profileId: deps.profileId,
          profileContextId: deps.profileContextId,
          filename: pdfFilename(variant.name),
          pdfBase64,
        });
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
            systemPrompt: parsed.systemPrompt,
            reasoningEffort: parsed.reasoningEffort,
          });
          return json(200, { text });
        } catch (err) {
          return json(502, { error: err?.message || 'AI request failed' });
        }
      }

      if (method === 'POST' && path === '/applications') {
        if (!matchesProfileContext(parsed.profileContextId, deps.profileContextId)) {
          return profileChanged();
        }
        const variantId = typeof parsed.variantId === 'string' ? parsed.variantId.trim() : '';
        if (!variantId) return json(400, { error: 'variantId is required' });
        const variant = findVariant(deps.getVariants(), variantId);
        if (!variant) return json(404, { error: `no resume with id ${variantId}` });
        const application = deps.addApplication({
          variantId,
          variantName: variant.name,
          jobSnapshot: {
            title: typeof parsed.title === 'string' ? parsed.title : '',
            company: typeof parsed.company === 'string' ? parsed.company : '',
          },
          status: 'applied',
          notes: typeof parsed.notes === 'string' ? parsed.notes : '',
        });
        return json(201, { application });
      }

      if (method === 'POST' && path === '/profile/answers') {
        if (!matchesProfileContext(parsed.profileContextId, deps.profileContextId)) {
          return profileChanged();
        }
        const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
        const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
        if (!question || !answer) return json(400, { error: 'question and answer are required' });
        const saved = deps.saveLearnedAnswer(question, answer);
        return json(201, { answer: saved });
      }

      return json(404, { error: `no route: ${method} ${path}` });
    } catch (err) {
      return json(500, { error: err?.message || 'internal error' });
    }
  };
}
