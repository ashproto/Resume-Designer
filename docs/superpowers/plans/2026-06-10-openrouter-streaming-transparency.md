# OpenRouter Streaming + Run Transparency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream the model's reasoning + answer live across chat and the structured (JSON) AI flows, surface real run metadata (model, reasoning tokens, cost, web-search citations), and fix the result-handling bugs from the audit.

**Architecture:** A single pure SSE accumulator (`createStreamAccumulator`) drives one streaming I/O wrapper (`streamOpenRouter`); `callOpenRouter` becomes a buffer-to-completion wrapper so every flow shares one tested path. Chat consumes live hooks; the modal JSON flows stream reasoning while buffering the answer for end-of-stream JSON parsing. New presentational components (`LiveReasoning`, `Citations`, `RunMeta`) render the transparency.

**Tech Stack:** Vanilla ES modules (`aiService.js`), React + shadcn/Tailwind (chat + dialogs), Vitest + jsdom, OpenRouter chat-completions SSE.

**Spec:** `docs/superpowers/specs/2026-06-10-openrouter-streaming-transparency-design.md`

**Standing constraints:** No commit/push without the user's explicit go-ahead in the current turn. Commit footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Never use the real OpenRouter key or real résumé data when testing. Don't run a preview server on :3000 while `tauri:dev` runs. Conventional Commits (body lines ≤100 chars).

---

## File Structure

| File | Responsibility | Fate |
|---|---|---|
| `src/aiStream.js` | `createStreamAccumulator()` — pure SSE framing + accumulation | **new** |
| `test/aiStream.test.js` | Unit tests for the accumulator (tests live in `test/` per `vitest.config.js` `include: ['test/**/*.test.js']`) | **new** |
| `src/aiService.js` | `streamOpenRouter`, `callOpenRouter` rewrite, fixes, delete `tailorForJob` | modify |
| `src/tokenTrackingService.js` | `reasoningTokens` on events + summary | modify |
| `src/chatThreads.js` | `sanitizeForPersist()` (drop `reasoningDetails`, cap `reasoning`) | modify |
| `src/persistence.js` | `chatReasoningEffort` / `chatWebSearch` defaults + owned-keys | modify |
| `src/components/chat/LiveReasoning.jsx` | Live/collapsible reasoning panel (chat + modals) | **new** |
| `src/components/chat/Citations.jsx` | `url_citation` sources list | **new** |
| `src/components/chat/RunMeta.jsx` | Run-metadata line (chat: with cost; modals: tokens only) | **new** |
| `src/components/chat/useChat.js` | Streaming engine: `streamingMessage`, hooks, Stop, persisted prefs, continuity | modify |
| `src/components/chat/MessageList.jsx` | Render streaming msg, collapsible reasoning, citations, run footer | modify |
| `src/components/chat/ChatComposer.jsx` | Stop button while streaming | modify |
| `src/components/chat/ChatPanel.jsx` | Pass `stop`/streaming through | modify |
| `src/components/jobs/JobsDialog.jsx` | Live reasoning + Tailor reasoning Select + RunMeta; thread reasoning/hooks | modify |
| `src/components/jobs/AnalysisResults.jsx` | `RunMeta` footer | modify |
| `src/components/onboarding/OnboardingWizard.jsx` | Live reasoning during generation + RunMeta | modify |

**Why `src/aiStream.js` is separate from `aiService.js`:** the accumulator is pure and unit-tested in isolation; keeping it out of the 1368-line `aiService.js` follows the project's "extract the pure core, test it" pattern (PR1's `markdownMessage.js`, `htmlEscape.js`).

---

## Task 1: Pure SSE accumulator (`aiStream.js`) — TDD

**Files:**
- Create: `resume-designer/src/aiStream.js`
- Test: `resume-designer/test/aiStream.test.js` (tests live in `test/`, not `src/`, per the Vitest config)

- [ ] **Step 1: Write the failing tests**

Create `resume-designer/test/aiStream.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createStreamAccumulator } from '../src/aiStream.js';

// Build an SSE frame for one delta object.
const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

describe('createStreamAccumulator', () => {
  it('accumulates content deltas and emits content events', () => {
    const acc = createStreamAccumulator();
    const e1 = acc.push(frame({ choices: [{ delta: { content: 'Hel' } }] }));
    const e2 = acc.push(frame({ choices: [{ delta: { content: 'lo' } }] }));
    expect(e1).toEqual([{ type: 'content', delta: 'Hel', full: 'Hel' }]);
    expect(e2).toEqual([{ type: 'content', delta: 'lo', full: 'Hello' }]);
    expect(acc.result().text).toBe('Hello');
  });

  it('accumulates reasoning separately from content', () => {
    const acc = createStreamAccumulator();
    acc.push(frame({ choices: [{ delta: { reasoning: 'think ' } }] }));
    acc.push(frame({ choices: [{ delta: { reasoning: 'more' } }] }));
    acc.push(frame({ choices: [{ delta: { content: 'answer' } }] }));
    const r = acc.result();
    expect(r.reasoning).toBe('think more');
    expect(r.text).toBe('answer');
  });

  it('merges reasoning_details text by index', () => {
    const acc = createStreamAccumulator();
    acc.push(frame({ choices: [{ delta: { reasoning_details: [{ index: 0, type: 'reasoning.text', text: 'a' }] } }] }));
    acc.push(frame({ choices: [{ delta: { reasoning_details: [{ index: 0, type: 'reasoning.text', text: 'b' }] } }] }));
    expect(acc.result().reasoningDetails[0].text).toBe('ab');
  });

  it('keeps encrypted reasoning_details data without readable text', () => {
    const acc = createStreamAccumulator();
    acc.push(frame({ choices: [{ delta: { reasoning_details: [{ index: 0, type: 'reasoning.encrypted', data: 'XYZ' }] } }] }));
    const d = acc.result().reasoningDetails[0];
    expect(d.type).toBe('reasoning.encrypted');
    expect(d.data).toBe('XYZ');
    expect(acc.result().reasoning).toBe('');
  });

  it('collects url_citation annotations', () => {
    const acc = createStreamAccumulator();
    const events = acc.push(frame({ choices: [{ delta: { annotations: [{ type: 'url_citation', url: 'https://x.com', title: 'X' }] } }] }));
    expect(events.find((e) => e.type === 'annotations').annotations).toHaveLength(1);
    expect(acc.result().annotations[0].url).toBe('https://x.com');
  });

  it('captures usage, model and finish_reason from the final chunk', () => {
    const acc = createStreamAccumulator();
    acc.push(frame({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }], model: 'anthropic/claude-sonnet-4.6', usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0.001, completion_tokens_details: { reasoning_tokens: 10 } } }));
    const r = acc.result();
    expect(r.model).toBe('anthropic/claude-sonnet-4.6');
    expect(r.finishReason).toBe('stop');
    expect(r.usage.completion_tokens_details.reasoning_tokens).toBe(10);
  });

  it('buffers a payload split across two chunks (partial line)', () => {
    const acc = createStreamAccumulator();
    const e1 = acc.push('data: {"choices":[{"delta":{"con');
    const e2 = acc.push('tent":"split"}}]}\n\n');
    expect(e1).toEqual([]);
    expect(e2).toEqual([{ type: 'content', delta: 'split', full: 'split' }]);
  });

  it('ignores keep-alive comment lines', () => {
    const acc = createStreamAccumulator();
    const events = acc.push(': OPENROUTER PROCESSING\n\n');
    expect(events).toEqual([]);
  });

  it('marks done on the [DONE] sentinel', () => {
    const acc = createStreamAccumulator();
    acc.push('data: [DONE]\n\n');
    expect(acc.result().done).toBe(true);
  });

  it('throws on a mid-stream error payload', () => {
    const acc = createStreamAccumulator();
    expect(() => acc.push(frame({ error: { message: 'rate limited', code: 429 } }))).toThrow('rate limited');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd resume-designer && npx vitest run test/aiStream.test.js`
Expected: FAIL — "Failed to resolve import '../src/aiStream.js'".

- [ ] **Step 3: Implement the accumulator**

Create `resume-designer/src/aiStream.js`:

```js
/**
 * Pure SSE accumulator for OpenRouter streaming chat-completions.
 *
 * No I/O: feed decoded text chunks to push() and it returns the events that
 * fired (content / reasoning / annotations); result() returns the accumulated
 * state. Extracted from aiService so the framing logic is unit-testable without
 * the network. SSE framing per the OpenRouter stream: `data: {json}` lines,
 * `: keep-alive` comments, and a final `data: [DONE]`.
 */
export function createStreamAccumulator() {
  let buffer = '';
  let content = '';
  let reasoning = '';
  const reasoningDetails = [];
  let annotations = [];
  let usage = null;
  let model = null;
  let finishReason = null;
  let done = false;

  function mergeReasoningDetails(arr) {
    for (const d of arr) {
      if (!d || typeof d.index !== 'number') { reasoningDetails.push(d); continue; }
      const cur = reasoningDetails[d.index] || {};
      reasoningDetails[d.index] = {
        ...cur,
        ...d,
        text: (cur.text || '') + (d.text || ''),
        summary: (cur.summary || '') + (d.summary || ''),
        data: d.data != null ? d.data : cur.data,
      };
    }
  }

  function handlePayload(payload, events) {
    if (payload === '[DONE]') { done = true; return; }
    let json;
    try { json = JSON.parse(payload); } catch { return; } // ignore unparseable fragments
    if (json.error) {
      throw new Error(json.error.message || `OpenRouter stream error ${json.error.code || ''}`.trim());
    }
    if (json.model) model = json.model;
    if (json.usage) usage = json.usage;
    const choice = json.choices && json.choices[0];
    if (!choice) return;
    const delta = choice.delta || {};
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      events.push({ type: 'content', delta: delta.content, full: content });
    }
    if (typeof delta.reasoning === 'string' && delta.reasoning) {
      reasoning += delta.reasoning;
      events.push({ type: 'reasoning', delta: delta.reasoning, full: reasoning });
    }
    if (Array.isArray(delta.reasoning_details) && delta.reasoning_details.length) {
      mergeReasoningDetails(delta.reasoning_details);
    }
    if (Array.isArray(delta.annotations) && delta.annotations.length) {
      annotations = annotations.concat(delta.annotations);
      events.push({ type: 'annotations', annotations: annotations.slice() });
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  return {
    push(chunk) {
      buffer += chunk;
      const events = [];
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep any partial trailing line for next push
      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('data:')) handlePayload(line.slice(5).trim(), events);
      }
      return events;
    },
    result() {
      return {
        text: content,
        reasoning,
        reasoningDetails: reasoningDetails.filter(Boolean),
        annotations,
        usage,
        model,
        finishReason,
        done,
      };
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd resume-designer && npx vitest run test/aiStream.test.js`
Expected: PASS — 10 passing.

- [ ] **Step 5: Lint**

Run: `cd resume-designer && npx eslint src/aiStream.js test/aiStream.test.js`
Expected: clean (0 errors).

---

## Task 2: Streaming I/O wrapper + unify `callOpenRouter` (`aiService.js`)

**Files:**
- Modify: `resume-designer/src/aiService.js` (imports; replace `callOpenRouter` at lines 865-978; delete `tailorForJob` at 1201-1209)
- Modify: `resume-designer/src/tokenTrackingService.js` (`trackUsage`, lines 69-138)

- [ ] **Step 1: Add `reasoningTokens` to `trackUsage`**

In `resume-designer/src/tokenTrackingService.js`, change the `trackUsage` signature (line 69) and event/summary writes:

```js
export function trackUsage({ provider, model, feature, inputTokens, outputTokens, cacheRead = 0, cacheCreation = 0, reasoningTokens = 0, cost: reportedCost }) {
```

In the `event` object (after line 88 `cacheCreation: cacheCreation || 0,`) add:

```js
    reasoningTokens: reasoningTokens || 0,
```

After `data.summary.totalOutputTokens += event.outputTokens;` (line 97) add:

```js
  data.summary.totalReasoningTokens = (data.summary.totalReasoningTokens || 0) + event.reasoningTokens;
```

In the `byModel[modelKey]` init object (lines 104-111) add `reasoningTokens: 0,` and after line 114 add
`data.summary.byModel[modelKey].reasoningTokens += event.reasoningTokens;`. Do the same for `byFeature`
(init + accumulate). Add `totalReasoningTokens: 0` to `DEFAULT_STORAGE.summary` (line 18).

- [ ] **Step 2: Import the accumulator + add `streamOpenRouter`**

In `resume-designer/src/aiService.js`, add to the imports at the top (after line 9):

```js
import { createStreamAccumulator } from './aiStream.js';
```

Replace the entire `callOpenRouter` function (lines 865-978) with `streamOpenRouter` + a thin `callOpenRouter`:

```js
// Streaming OpenRouter call path. Drives the pure accumulator and invokes live
// hooks (onReasoning / onContent / onAnnotations) as deltas arrive. Returns the
// final structured result. Side effects (addCustomModel, trackUsage) fire once.
async function streamOpenRouter(modelId, messages, options = {}, hooks = {}) {
  const { systemPrompt = SYSTEM_PROMPT, reasoningEffort, webSearch, feature, signal } = options;

  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No OpenRouter API key configured. Please add your key in settings.');

  const cfg = MODELS[modelId];
  const reasoningOn = reasoningEffort && reasoningEffort !== 'none' && modelSupportsReasoning(modelId);

  const apiMessages = [];
  if (systemPrompt) apiMessages.push({ role: 'system', content: systemPrompt });
  for (const m of messages) {
    const msg = { role: m.role === 'user' ? 'user' : 'assistant', content: m.content };
    // Anthropic thinking continuity: replay prior reasoning_details unmodified.
    if (msg.role === 'assistant' && Array.isArray(m.reasoningDetails) && m.reasoningDetails.length) {
      msg.reasoning_details = m.reasoningDetails;
    }
    apiMessages.push(msg);
  }

  const requestBody = {
    model: modelId,
    messages: apiMessages,
    // Reasoning competes with the completion budget; give the answer headroom
    // when thinking is on (OpenRouter clamps to the model's real max).
    max_tokens: reasoningOn ? Math.max(cfg?.maxTokens || 8192, 16000) : (cfg?.maxTokens || 8192),
    stream: true,
    usage: { include: true },
  };
  if (getSettings().autoFallback) {
    const fallbacks = getFallbackModels(modelId);
    if (fallbacks.length) requestBody.models = [modelId, ...fallbacks];
  }
  if (reasoningOn) requestBody.reasoning = { effort: reasoningEffort };
  if (webSearch) requestBody.tools = [{ type: 'openrouter:web_search' }];

  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': OPENROUTER_REFERER,
      'X-Title': OPENROUTER_TITLE,
    },
    body: JSON.stringify(requestBody),
    signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `OpenRouter API error: ${response.status}`);
  }

  const acc = createStreamAccumulator();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let stopped = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const events = acc.push(decoder.decode(value, { stream: true }));
      for (const ev of events) {
        if (ev.type === 'reasoning') hooks.onReasoning?.(ev.delta, ev.full);
        else if (ev.type === 'content') hooks.onContent?.(ev.delta, ev.full);
        else if (ev.type === 'annotations') hooks.onAnnotations?.(ev.annotations);
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') stopped = true;
    else throw e;
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  const r = acc.result();
  const usage = r.usage || {};
  const usedModel = r.model || modelId;
  const run = {
    model: usedModel,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens || 0,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    cost: typeof usage.cost === 'number' ? usage.cost : 0,
    webSearch: Array.isArray(r.annotations) && r.annotations.length > 0,
    finishReason: r.finishReason,
  };

  // A custom slug that produced a response "works" — remember it (no-op for curated).
  addCustomModel(modelId);
  if (r.usage) {
    trackUsage({
      provider: String(usedModel).split('/')[0] || 'openrouter',
      model: usedModel,
      feature: feature || 'chat',
      inputTokens: run.promptTokens,
      outputTokens: run.completionTokens,
      reasoningTokens: run.reasoningTokens,
      cost: run.cost,
    });
  }

  // Empty-content handling — never dump raw JSON (the old `text || JSON.stringify`).
  if (!r.text && !stopped) {
    if (r.finishReason === 'length') {
      throw new Error('The response hit the token cap before finishing — lower the reasoning effort or choose a model with a higher limit, then try again.');
    }
    throw new Error('The model returned an empty response. Please try again.');
  }

  return {
    text: r.text,
    reasoning: r.reasoning || null,
    reasoningDetails: r.reasoningDetails,
    annotations: r.annotations,
    run,
    stopped,
  };
}

// Buffer-to-completion wrapper: every non-live caller routes here, so reasoning
// capture, citations, token/cost tracking and the empty-content fix apply
// uniformly. Returns a plain string by default; the structured object (used by
// the chat UI) when options.structured. options.hooks/options.signal flow through
// to streamOpenRouter for the live JSON flows.
async function callOpenRouter(modelId, messages, options = {}) {
  const res = await streamOpenRouter(modelId, messages, options, options.hooks || {});
  if (options.structured) {
    return {
      text: res.text,
      thinking: res.reasoning, // back-compat name retained for existing callers
      reasoning: res.reasoning,
      reasoningDetails: res.reasoningDetails,
      annotations: res.annotations,
      usedWebSearch: res.run.webSearch,
      run: res.run,
      stopped: res.stopped,
    };
  }
  return res.text;
}
```

- [ ] **Step 3: Export `streamOpenRouter` for the chat engine**

`streamOpenRouter` is module-private; the chat engine calls it through `chat()`. Update `chat()`
(lines 990-1015) to forward live hooks + signal and return the structured object:

```js
export async function chat(modelId, messages, includeContext = true, options = {}) {
  const validModelId = validateModelId(modelId);
  if (!getApiKey()) throw new Error('No OpenRouter API key configured. Please add your key in settings.');

  let processedMessages = [...messages];
  if (includeContext && processedMessages.length > 0) {
    const context = getResumeContext();
    const lastUserIndex = processedMessages.map((m) => m.role).lastIndexOf('user');
    if (lastUserIndex >= 0) {
      processedMessages[lastUserIndex] = {
        ...processedMessages[lastUserIndex],
        content: `${context}\n\n---\n\nUser request: ${processedMessages[lastUserIndex].content}`,
      };
    }
  }

  const { hooks, ...rest } = options;
  const res = await streamOpenRouter(validModelId, processedMessages, rest, hooks || {});
  if (options.structured) {
    return {
      text: res.text, thinking: res.reasoning, reasoning: res.reasoning,
      reasoningDetails: res.reasoningDetails, annotations: res.annotations,
      usedWebSearch: res.run.webSearch, run: res.run, stopped: res.stopped,
    };
  }
  return res.text;
}
```

- [ ] **Step 4: Thread reasoning + hooks into the JSON flows**

`generateResumeChanges` (line 1067): add a trailing `options = {}` param and pass it through:

```js
export async function generateResumeChanges(modelId, instruction, targetPath = null, additionalContext = null, featureName = 'generate', options = {}) {
```
and at its `callOpenRouter` call (lines 1110-1113):
```js
  const response = await callOpenRouter(validModelId, messages, {
    feature: featureName,
    systemPrompt: CHANGE_GENERATION_PROMPT,
    reasoningEffort: options.reasoningEffort,
    hooks: options.hooks,
    signal: options.signal,
  });
```

`analyzeAgainstJobs` (line 1175-1179) — add hooks/signal alongside the existing reasoningEffort:
```js
  const response = await callOpenRouter(validModelId, messages, {
    feature: 'analyze',
    reasoningEffort: options.reasoningEffort,
    systemPrompt: JOB_ANALYSIS_PROMPT,
    hooks: options.hooks,
    signal: options.signal,
  });
```

`generateResumeFromProfileForJob` (line 618-621) — add hooks/signal:
```js
  const response = await callOpenRouter(validModelId, messages, {
    feature: 'generate-from-profile',
    reasoningEffort: options.reasoningEffort,
    hooks: options.hooks,
    signal: options.signal,
  });
```

- [ ] **Step 5: Delete dead `tailorForJob`**

Remove the entire `tailorForJob` function (lines 1201-1209) and its doc comment (1194-1200). Confirm no
imports reference it: `cd resume-designer && rg -n "tailorForJob" src/` → only its definition (now gone).

- [ ] **Step 6: Verify the existing suite still passes (buffered behavior identical)**

Run: `cd resume-designer && npx vitest run && npx eslint src/aiService.js src/tokenTrackingService.js && npm run build`
Expected: all tests PASS, lint clean, build succeeds. (jsdom has `fetch`/`ReadableStream`/`TextDecoder`;
the existing tests don't hit the network, so they exercise the wrappers' shapes only.)

---

## Task 3: Persistence — sanitize messages + persist prefs

**Files:**
- Modify: `resume-designer/src/chatThreads.js`
- Modify: `resume-designer/src/persistence.js`

- [ ] **Step 1: Add `sanitizeForPersist` (drop reasoningDetails, cap reasoning)**

In `resume-designer/src/chatThreads.js`, add a constant near line 13 (`const MAX_PERSISTED = 50;`):

```js
const MAX_PERSISTED_REASONING = 8000; // chars; full reasoning stays in-memory only
```

Add a function and fold it into `trimMessages` (line 87-89):

```js
// Strip heavy/in-memory-only fields before persisting to quota-bound localStorage:
// drop reasoning_details (can carry large encrypted blobs) and cap the reasoning
// string. annotations + run are small and kept as-is.
export function sanitizeForPersist(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => {
    if (!m || typeof m !== 'object') return m;
    const { reasoningDetails, ...rest } = m;
    void reasoningDetails;
    if (typeof rest.reasoning === 'string' && rest.reasoning.length > MAX_PERSISTED_REASONING) {
      rest.reasoning = `${rest.reasoning.slice(0, MAX_PERSISTED_REASONING)}…`;
    }
    return rest;
  });
}

export function trimMessages(messages) {
  return sanitizeForPersist(Array.isArray(messages) ? messages.slice(-MAX_PERSISTED) : []);
}
```

- [ ] **Step 2: Add the two settings keys**

In `resume-designer/src/persistence.js`, find the settings defaults object and owned-keys list (search:
`cd resume-designer && rg -n "defaultModel|autoFallback|customModels" src/persistence.js`). In the settings
**defaults**, add `chatReasoningEffort: 'medium',` and `chatWebSearch: false,` next to `defaultModel`. Ensure
both keys survive `getSettings()`/`saveSettings()` merge (they will if defaults include them; if there's an
explicit allow-list of setting keys, add both there too).

- [ ] **Step 3: Verify**

Run: `cd resume-designer && npx vitest run src/persistence.test.js 2>/dev/null; npx eslint src/chatThreads.js src/persistence.js && npm run build`
Expected: lint clean, build succeeds (existing persistence/backup tests stay green — owned-keys additions are additive).

---

## Task 4: Presentational components (`LiveReasoning`, `Citations`, `RunMeta`)

**Files:**
- Create: `resume-designer/src/components/chat/LiveReasoning.jsx`
- Create: `resume-designer/src/components/chat/Citations.jsx`
- Create: `resume-designer/src/components/chat/RunMeta.jsx`

- [ ] **Step 1: `RunMeta.jsx`**

```jsx
import { Brain, DollarSign, Globe, Cpu } from 'lucide-react';
import { formatTokenCount, formatCost } from '../../tokenTrackingService.js';
import { getModelLabel } from './useChat.js';

/**
 * Compact run-metadata line. `showCost` is true in chat, false in the JSON-flow
 * modals (per spec: token counts there, cost only in chat).
 */
export function RunMeta({ run, showCost = false, className = '' }) {
  if (!run) return null;
  const parts = [];
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}>
      <span className="inline-flex items-center gap-1"><Cpu className="size-3" />{getModelLabel(run.model)}</span>
      {run.reasoningTokens > 0 && (
        <span className="inline-flex items-center gap-1"><Brain className="size-3" />{formatTokenCount(run.reasoningTokens)} reasoning</span>
      )}
      <span>{formatTokenCount((run.promptTokens || 0) + (run.completionTokens || 0))} tokens</span>
      {showCost && run.cost > 0 && (
        <span className="inline-flex items-center gap-1"><DollarSign className="size-3" />{formatCost(run.cost)}</span>
      )}
      {run.webSearch && <span className="inline-flex items-center gap-1"><Globe className="size-3" />web</span>}
      {parts}
    </div>
  );
}
```

- [ ] **Step 2: `Citations.jsx`**

```jsx
import { ExternalLink } from 'lucide-react';
import { isLikelySafeUrl } from '../../htmlEscape.js'; // see Step 2a

/**
 * Sources list from OpenRouter url_citation annotations. Only http(s) URLs are
 * linked; anything else renders as inert text.
 */
export function Citations({ annotations }) {
  const cites = (annotations || []).filter((a) => a && a.type === 'url_citation' && a.url);
  if (cites.length === 0) return null;
  return (
    <div className="mt-2.5 border-t pt-2.5">
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Sources</div>
      <ol className="space-y-1">
        {cites.map((c, i) => {
          const safe = isLikelySafeUrl(c.url);
          const label = c.title || c.url;
          return (
            <li key={i} className="flex gap-1.5 text-[11.5px] text-muted-foreground">
              <span className="shrink-0 tabular-nums">{i + 1}.</span>
              {safe ? (
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-primary hover:underline">
                  <span className="truncate">{label}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <span className="truncate">{label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2a: Ensure `isLikelySafeUrl` exists in `htmlEscape.js`**

Run: `cd resume-designer && rg -n "isLikelySafeUrl|http" src/htmlEscape.js`. If a safe-URL helper already
exists, import that name instead. Otherwise add to `resume-designer/src/htmlEscape.js`:

```js
// True only for http(s) URLs — used to gate rendered links from model output.
export function isLikelySafeUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: `LiveReasoning.jsx`**

```jsx
import { useState } from 'react';
import { Brain, ChevronRight, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTokenCount } from '../../tokenTrackingService.js';

/**
 * Reasoning panel used by chat AND the JSON-flow modals. While `streaming`, shows
 * a spinner + the live reasoning text. When done, collapses to a "Reasoning"
 * disclosure (full text, no 300-char clip). Encrypted/empty reasoning degrades to
 * a token-count line with no body.
 */
export function LiveReasoning({ reasoning, reasoningTokens = 0, streaming = false, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasText = typeof reasoning === 'string' && reasoning.trim().length > 0;

  if (streaming) {
    return (
      <div className="rounded-lg border bg-accent/40 px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          <Loader2 className="size-3.5 animate-spin text-primary" />
          <span>Thinking{reasoningTokens > 0 ? ` · ${formatTokenCount(reasoningTokens)} tokens` : '…'}</span>
        </div>
        {hasText && (
          <div className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted-foreground">
            {reasoning}
          </div>
        )}
      </div>
    );
  }

  if (!hasText) {
    if (reasoningTokens <= 0) return null;
    return (
      <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-[11px] text-muted-foreground">
        <Brain className="size-3" /> Reasoning hidden by provider · {formatTokenCount(reasoningTokens)} tokens
      </div>
    );
  }

  return (
    <div className="mb-2 overflow-hidden rounded-md border-l-[3px] border-primary bg-accent">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] font-semibold text-foreground"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        <Brain className="size-3" /> Reasoning
        {reasoningTokens > 0 && <span className="font-normal text-muted-foreground">· {formatTokenCount(reasoningTokens)} tokens</span>}
        {!open && <Check className="ml-auto size-3 text-success" />}
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap px-2 pb-2 text-[11.5px] leading-relaxed text-muted-foreground">
          {reasoning}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `cd resume-designer && npx eslint src/components/chat/LiveReasoning.jsx src/components/chat/Citations.jsx src/components/chat/RunMeta.jsx src/htmlEscape.js && npm run build`
Expected: lint clean, build succeeds. (`getModelLabel` is already exported from `useChat.js:39`.)

---

## Task 5: Chat streaming engine + render

**Files:**
- Modify: `resume-designer/src/components/chat/useChat.js`
- Modify: `resume-designer/src/components/chat/MessageList.jsx`
- Modify: `resume-designer/src/components/chat/ChatComposer.jsx`
- Modify: `resume-designer/src/components/chat/ChatPanel.jsx`

- [ ] **Step 1: `useChat` — persisted prefs + streaming state**

In `resume-designer/src/components/chat/useChat.js`:

Seed reasoning/web-search from settings. Replace lines 145-146:
```js
  const [reasoningEffort, setReasoningEffortState, reasoningRef] = useStateRef(getSettings().chatReasoningEffort || 'medium');
  const [webSearchEnabled, setWebSearchState, webSearchRef] = useStateRef(!!getSettings().chatWebSearch);
```
Persist on change. Replace `setReasoning` (line 613) and `toggleWebSearch` (line 614):
```js
  const setReasoning = (level) => { setReasoningEffortState(level); saveSettings({ chatReasoningEffort: level }); };
  const toggleWebSearch = () => { const next = !webSearchRef.current; setWebSearchState(next); saveSettings({ chatWebSearch: next }); };
```

Add streaming state + abort ref near the other state (after line 146):
```js
  const [streamingMessage, setStreamingMessage, streamingRef] = useStateRef(null);
  const abortRef = useRef(null);
  const flushRaf = useRef(0);
```

Add a throttled flush + a stop handler (place above `getAIResponse`):
```js
  // Coalesce streamed deltas to one state write per animation frame so the
  // Markdown render + DOMPurify re-sanitize runs at display rate, not per token.
  const scheduleFlush = (patch) => {
    const base = streamingRef.current || { id: uid(), role: 'assistant', streaming: true, content: '', reasoning: '', reasoningDetails: [], annotations: [], run: null, timestamp: new Date().toISOString() };
    streamingRef.current = { ...base, ...patch(base) };
    if (flushRaf.current) return;
    flushRaf.current = requestAnimationFrame(() => {
      flushRaf.current = 0;
      setStreamingMessage(streamingRef.current);
    });
  };

  const stop = () => { if (abortRef.current) abortRef.current.abort(); };
```

- [ ] **Step 2: `useChat` — stream the main chat reply**

Replace `getAIResponse` (lines 208-249) with the streaming version:
```js
  const getAIResponse = async (userMessage, hasExplicitContext = false) => {
    const modelId = modelRef.current;
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // History carries reasoning_details on assistant turns for Anthropic continuity.
    const history = messagesRef.current
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content, reasoningDetails: m.reasoningDetails }));
    if (history.length > 0) history[history.length - 1].content = userMessage;

    setStreamingMessage({ id: uid(), role: 'assistant', streaming: true, content: '', reasoning: '', annotations: [], run: null, timestamp: new Date().toISOString() });
    streamingRef.current = { ...streamingRef.current };

    try {
      const res = await chat(modelId, history, !hasExplicitContext, {
        reasoningEffort: reasoningRef.current,
        webSearch: webSearchRef.current,
        signal: controller.signal,
        structured: true,
        hooks: {
          onReasoning: (_d, full) => scheduleFlush(() => ({ reasoning: full })),
          onContent: (_d, full) => scheduleFlush(() => ({ content: full })),
          onAnnotations: (list) => scheduleFlush(() => ({ annotations: list })),
        },
      });
      if (flushRaf.current) { cancelAnimationFrame(flushRaf.current); flushRaf.current = 0; }
      setStreamingMessage(null);
      streamingRef.current = null;
      abortRef.current = null;
      setLoading(false);
      appendMessage({
        id: uid(), role: 'assistant',
        content: res.stopped ? `${res.text}\n\n_(stopped)_` : res.text,
        reasoning: res.reasoning, reasoningDetails: res.reasoningDetails,
        annotations: res.annotations, run: res.run, timestamp: new Date().toISOString(),
      });
      refreshCustomModels();
    } catch (error) {
      if (flushRaf.current) { cancelAnimationFrame(flushRaf.current); flushRaf.current = 0; }
      setStreamingMessage(null);
      streamingRef.current = null;
      abortRef.current = null;
      setLoading(false);
      addMessage('error', error.message);
    }
  };
```

- [ ] **Step 3: `useChat` — reasoning into change-requests + stream their reasoning**

In `requestAIChanges` (line 301), pass reasoning + a reasoning-only stream into a transient streaming
message. Replace the `generateResumeChanges` call (line 301):
```js
      const controller = new AbortController();
      abortRef.current = controller;
      setStreamingMessage({ id: uid(), role: 'assistant', streaming: true, content: '', reasoning: '', annotations: [], run: null, timestamp: new Date().toISOString() });
      const result = await generateResumeChanges(modelRef.current, instruction, targetPath, null, 'generate', {
        reasoningEffort: reasoningRef.current,
        signal: controller.signal,
        hooks: { onReasoning: (_d, full) => scheduleFlush(() => ({ reasoning: full })) },
      });
      if (flushRaf.current) { cancelAnimationFrame(flushRaf.current); flushRaf.current = 0; }
      setStreamingMessage(null); streamingRef.current = null; abortRef.current = null;
```
Keep the rest of `requestAIChanges` (the change-set/diff handling) unchanged. Remove its `beginThinking()`
call (line 296) and rely on `streamingMessage`; replace the remaining `completeThinkingStep`/`endThinking`
calls in that function with nothing (delete those lines) — the streaming panel now covers progress.

- [ ] **Step 4: `useChat` — export `streamingMessage` + `stop`**

In the returned object (lines 658-668): add `streamingMessage,` to the state group and `stop,` to the actions
group.

- [ ] **Step 5: `MessageList` — render streaming + collapsible reasoning + citations + run footer**

In `resume-designer/src/components/chat/MessageList.jsx`:

Replace the imports (lines 1-7) to add the new components and drop the clip constant:
```jsx
import { useRef, useEffect } from 'react';
import { Check, KeyRound, MessageCircle, Pencil, Settings2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown.jsx';
import { LiveReasoning } from './LiveReasoning.jsx';
import { Citations } from './Citations.jsx';
import { RunMeta } from './RunMeta.jsx';
```
Delete `const REASONING_MAX = 300;` (line 9) and the whole `ThinkingBlock` function (lines 14-52).

In `MessageBubble` (lines 54-116), remove the clip logic (lines 64-66) and the old reasoning block (lines
78-85). Replace the assistant body so it renders the disclosure + citations + run footer:
```jsx
  const isUser = msg.role === 'user';
  const hasActions = msg.applyData || msg.pendingChanges;
  // ... keep the error branch (lines 55-61) above unchanged ...
  return (
    <div className={cn('w-fit px-3 py-2.5 text-[13.5px] leading-relaxed',
      isUser ? 'ml-auto max-w-[85%] rounded-[14px_14px_4px_14px] bg-primary text-primary-foreground'
             : 'max-w-[92%] rounded-[14px_14px_14px_4px] border bg-background')}>
      {!isUser && <LiveReasoning reasoning={msg.reasoning} reasoningTokens={msg.run?.reasoningTokens || 0} />}
      <Markdown content={msg.content} />
      {!isUser && <Citations annotations={msg.annotations} />}
      {!isUser && msg.run && <RunMeta run={msg.run} showCost className="mt-2 border-t pt-2" />}
      {hasActions && ( /* keep the existing actions block, lines 89-113 */ )}
    </div>
  );
```

Add a streaming bubble component (above `MessageList`):
```jsx
function StreamingBubble({ msg, onStop }) {
  return (
    <div className="w-[92%] max-w-[92%] self-start space-y-2 rounded-[14px_14px_14px_4px] border bg-background px-3 py-2.5">
      <LiveReasoning reasoning={msg.reasoning} reasoningTokens={msg.run?.reasoningTokens || 0} streaming defaultOpen />
      {msg.content ? <Markdown content={msg.content} /> : null}
      <Button variant="outline" size="sm" className="h-6 gap-1 text-[11px]" onClick={onStop}>
        <Square className="size-3" /> Stop
      </Button>
    </div>
  );
}
```

Change the `MessageList` signature (line 155) and body to take `streamingMessage` + `onStop` and render it
where `thinking` was (replace lines 167-176):
```jsx
export function MessageList({ messages, streamingMessage, configured, onReviewChanges, onApply, onConfigure, onStop }) {
  // ... scrollerRef + the useEffect, with [messages, streamingMessage] deps ...
      ) : messages.length === 0 && !streamingMessage ? (
        <Welcome />
      ) : (
        <>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} onReviewChanges={onReviewChanges} onApply={onApply} />
          ))}
          {streamingMessage && <StreamingBubble msg={streamingMessage} onStop={onStop} />}
        </>
      )}
```
Update the auto-scroll effect deps (line 161) from `[messages, thinking]` to `[messages, streamingMessage]`.

- [ ] **Step 6: `ChatPanel` — pass streaming through**

In `resume-designer/src/components/chat/ChatPanel.jsx`, update the `<MessageList>` props (lines 171-178):
replace `thinking={chat.thinking}` with `streamingMessage={chat.streamingMessage}` and add `onStop={chat.stop}`.
Update the busy-indicator effect (line 68-70) and toggle effect already key off `chat.loading` — leave as is
(`loading` is still set during streaming).

- [ ] **Step 7: Verify in preview**

Run: `cd resume-designer && npx eslint src/components/chat/ && npm test && npm run build`
Expected: lint clean, tests pass, build succeeds.

Then preview-verify (only if no `tauri:dev` is running):
1. `preview_start`, open the chat, set a fake OpenRouter key in settings (a clearly-fake string), send a
   message. (If the fake key 401s, that's fine — verify the *error path* renders cleanly, not raw JSON.)
2. With a working key (user-driven) you'd see: live reasoning streams, answer streams, Stop aborts,
   reasoning collapses to a disclosure, run footer shows model/tokens/cost. Capture a screenshot.

> Note: a real end-to-end stream needs the user's real key, which we must not enter. Verify the wiring
> (no console errors, error path clean, components mount) in preview; the live-stream happy path is
> confirmed at the `tauri:dev` gate (Task 7) by the user.

---

## Task 6: JSON-flow modals — live reasoning + token readout

**Files:**
- Modify: `resume-designer/src/components/jobs/JobsDialog.jsx`
- Modify: `resume-designer/src/components/jobs/AnalysisResults.jsx`
- Modify: `resume-designer/src/components/onboarding/OnboardingWizard.jsx`

- [ ] **Step 1: Jobs analysis — stream reasoning + capture run**

In `resume-designer/src/components/jobs/JobsDialog.jsx`, add state near the other `useState`s:
```jsx
  const [genReasoning, setGenReasoning] = useState('');
  const [genReasoningTokens, setGenReasoningTokens] = useState(0);
  const [lastRun, setLastRun] = useState(null);
  const genAbortRef = useRef(null); // add useRef to the React import if absent
```
Update `runAnalysis` (lines 251-266) to stream + capture run:
```jsx
  const runAnalysis = async (selectedJobs, modelId, reasoningEffort) => {
    const model = modelId || getSettings().defaultModel || getDefaultModelId();
    setIsAnalyzing(true);
    setAppliedIndexes(new Set());
    setGenReasoning(''); setGenReasoningTokens(0); setLastRun(null);
    const controller = new AbortController();
    genAbortRef.current = controller;
    try {
      const results = await analyzeAgainstJobs(model, selectedJobs, {
        reasoningEffort: reasoningEffort || 'medium',
        signal: controller.signal,
        hooks: { onReasoning: (_d, full) => setGenReasoning(full) },
      });
      const id = getCurrentId();
      if (id && results) saveVariantAnalysis(id, results);
      setAnalysisResults(results);
    } catch (error) {
      toast.error(`Analysis failed: ${error.message}`);
      setAnalysisResults(null);
    } finally {
      setIsAnalyzing(false);
    }
  };
```
> `analyzeAgainstJobs` returns the parsed object (not the run). To capture run metadata for the readout,
> read it from the last token-tracking event is brittle; instead have `analyzeAgainstJobs` return
> `{ ...parsed, _run }`. Simplest: in `aiService.js analyzeAgainstJobs`, after parsing, attach the run via a
> closure — capture `res.run` from the structured call. Change its `callOpenRouter` to `structured: true` is
> wrong (it must parse text). Instead, capture run through a hook: add `onRun` to options and call it from
> `streamOpenRouter` just before returning. **Add to `streamOpenRouter`** (right before `return {...}`):
> `hooks.onRun?.(run);` and thread `onRun` through `callOpenRouter`'s `options.hooks`. Then here pass
> `hooks: { onReasoning: ..., onRun: (r) => setLastRun(r) }`.

- [ ] **Step 1a: Add `onRun` hook to `aiService.js`**

In `streamOpenRouter`, immediately before the final `return {` add:
```js
  hooks.onRun?.(run);
```
(`callOpenRouter` already forwards `options.hooks`, so `onRun` flows through to every buffered caller.)

- [ ] **Step 2: Jobs — show `LiveReasoning` while analyzing + `RunMeta` with results**

In `JobsDialog.jsx`, import the components at the top:
```jsx
import { LiveReasoning } from '../chat/LiveReasoning.jsx';
import { RunMeta } from '../chat/RunMeta.jsx';
```
Find the render branch that shows the analyzing spinner (search: `rg -n "isAnalyzing" src/components/jobs/JobsDialog.jsx`).
Where the spinner renders, add (while `isAnalyzing`):
```jsx
  {isAnalyzing && <LiveReasoning reasoning={genReasoning} reasoningTokens={genReasoningTokens} streaming defaultOpen />}
```
Where `<AnalysisResults .../>` renders, pass `run={lastRun}` (see Step 4) — or render `<RunMeta run={lastRun} />`
just above it (tokens only — `showCost` omitted).

- [ ] **Step 3: Jobs "Tailor Resume" — reasoning Select + stream + run**

Add a reasoning control for tailoring near the Tailor button. Add state:
```jsx
  const [tailorReasoning, setTailorReasoning] = useState('medium');
```
Import the Select primitives (mirror `JobSelectionDialog.jsx:9-11`) and render next to the Tailor button:
```jsx
  <Select value={tailorReasoning} onValueChange={setTailorReasoning}>
    <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
    <SelectContent className="glass-card">
      {[['none','Off'],['low','Low'],['medium','Medium'],['high','High']].map(([v, l]) => (
        <SelectItem key={v} value={v}>{l}</SelectItem>
      ))}
    </SelectContent>
  </Select>
```
Update `handleTailor` (lines 268-288) to thread reasoning + stream + run:
```jsx
  const handleTailor = async () => {
    if (activeJDs.length === 0) { toast.error('Please activate at least one job description'); return; }
    const modelId = getSettings().defaultModel || getDefaultModelId();
    setIsAnalyzing(true); setGenReasoning(''); setLastRun(null);
    const controller = new AbortController(); genAbortRef.current = controller;
    try {
      const result = await generateResumeChanges(
        modelId,
        'Tailor my entire resume for these target jobs. Optimize keywords, adjust the summary, and highlight relevant experience.',
        null,
        { jobDescriptions: activeJDs },
        'tailor',
        { reasoningEffort: tailorReasoning, signal: controller.signal,
          hooks: { onReasoning: (_d, full) => setGenReasoning(full), onRun: (r) => setLastRun(r) } },
      );
      if (result.changes && Object.keys(result.changes).length > 0) {
        const changeSet = createChangeSet(store.getData(), result.changes);
        setOpen(false);
        showDiffView(changeSet);
      } else {
        toast.info('No changes suggested. Your resume may already be well-tailored!');
      }
    } catch (error) {
      toast.error(`Failed to generate changes: ${error.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };
```
(Also pass `onRun: (r) => setLastRun(r)` into `runAnalysis`'s hooks from Step 1.)

- [ ] **Step 4: `AnalysisResults` — optional `RunMeta` footer**

In `resume-designer/src/components/jobs/AnalysisResults.jsx`, add `run` to the props (line 88) and render a
footer at the end of the returned tree (before the closing `</div>` at line 211):
```jsx
import { RunMeta } from '../chat/RunMeta.jsx';
// ...
export function AnalysisResults({ results, appliedIndexes, onApply, run }) {
  // ...
      {run && <RunMeta run={run} className="border-t pt-3" />}
    </div>
  );
}
```
Pass `run={lastRun}` from `JobsDialog` where `<AnalysisResults>` is rendered.

- [ ] **Step 5: Onboarding — live reasoning during generation**

In `resume-designer/src/components/onboarding/OnboardingWizard.jsx`, add state + stream the generation.
Near the existing refs (line 82 `jobGenReasoningRef`):
```jsx
  const [genReasoning, setGenReasoning] = useState('');
  const [genRun, setGenRun] = useState(null);
```
Update `generateForJob` (lines 207-213) to pass hooks + capture run. `generateResumeForJob`
(`onboardingLogic.js:176`) must forward options — change its signature:
```js
// onboardingLogic.js
export function generateResumeForJob(modelId, targetJob, reasoningEffort, options = {}) {
  // ...existing body...
  return generateResumeFromProfileForJob(modelId, targetJob, { reasoningEffort, ...options });
}
```
Then in `OnboardingWizard.generateForJob`:
```jsx
    setGenReasoning(''); setGenRun(null);
    const resume = await generateResumeForJob(model, job, reasoning, {
      hooks: { onReasoning: (_d, full) => setGenReasoning(full), onRun: (r) => setGenRun(r) },
    });
```
In the generate step's loading view (search: `rg -n "generating|isGenerating|Loader" src/components/onboarding/`),
render `<LiveReasoning reasoning={genReasoning} streaming defaultOpen />` while generating and
`<RunMeta run={genRun} />` (tokens only) with the preview. Import both from `../chat/`.

- [ ] **Step 6: Verify**

Run: `cd resume-designer && npx eslint src/components/jobs/ src/components/onboarding/ src/onboardingLogic.js src/aiService.js && npm test && npm run build`
Expected: lint clean, tests pass, build succeeds.

Preview-verify (no real key needed for wiring): open Jobs → Analyze and Tailor, and the onboarding generate
step — confirm the `LiveReasoning` panel mounts in the generating state, no cost is shown in these readouts,
the Tailor reasoning Select renders, and there are no console errors.

---

## Task 7: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Static gate**

Run: `cd resume-designer && npx eslint src/ && npm test && npm run build`
Expected: 0 lint errors; all vitest suites pass (incl. `aiStream.test.js`); both Vite entries build.

- [ ] **Step 2: Preview wiring check**

`preview_start`; with a clearly-fake API key, confirm: chat renders, the error path on a failed call shows a
clean error bubble (never raw JSON), all new components mount, console is clean. Screenshot the chat composer
+ a completed/streamed message structure.

- [ ] **Step 3: `tauri:dev` live-stream gate (user-run, real key)**

This is the one check `vite preview` can't fully prove. With the user's real key in `tauri:dev`:
- Send a chat message → reasoning + answer stream live; reasoning collapses to a disclosure after.
- Click **Stop** mid-stream → partial answer is kept with "_(stopped)_", no console error.
- Enable web search on a query that needs it → a **Sources** list appears; run footer shows 🌐.
- Run Jobs → Analyze and Tailor, and onboarding generation → live reasoning shows, token (no-cost) readout
  shows, results/diff appear correctly.
- Confirm prod CSP `connect-src` still includes `https://openrouter.ai` (no CSP edit was needed).

- [ ] **Step 4: Final review subagent**

Dispatch a code-review subagent over the full diff (the SDD final-review step) before any commit. Address
findings. **Do not commit/push** until the user explicitly says so.

---

## Self-Review

**Spec coverage:**
- Streaming core + pure accumulator → Tasks 1, 2. ✓
- `callOpenRouter` unified / buffered → Task 2. ✓
- max_tokens + empty-content fixes → Task 2. ✓
- reasoning_tokens in trackUsage → Task 2. ✓
- Anthropic continuity (reasoning_details replay) → Task 2 (apiMessages) + Task 5 (history builder). ✓
- Dead `tailorForJob` removed → Task 2. ✓
- Persistence sanitize + persisted prefs → Task 3. ✓
- LiveReasoning / Citations / RunMeta → Task 4. ✓
- Chat streaming + collapsible reasoning + citations + run footer + Stop → Task 5. ✓
- Reasoning into chat change-requests → Task 5 Step 3. ✓
- JSON-flow live reasoning + token-only readout → Task 6. ✓
- Jobs Tailor reasoning Select → Task 6 Step 3. ✓
- Tests for the accumulator → Task 1. ✓
- Tauri streaming + CSP verification → Task 7. ✓

**Placeholder scan:** None — every code step has concrete code; search-then-edit steps name the exact file
and the literal lines to add.

**Type/name consistency:** `run` shape (`model`, `reasoningTokens`, `promptTokens`, `completionTokens`,
`cost`, `webSearch`, `finishReason`) is identical in Task 2 (`streamOpenRouter`), Task 4 (`RunMeta`), Tasks
5–6 (consumers). Hook names `onReasoning` / `onContent` / `onAnnotations` / `onRun` are consistent across
Tasks 2, 5, 6. `LiveReasoning` props (`reasoning`, `reasoningTokens`, `streaming`, `defaultOpen`) match
between Task 4 and its callers. `sanitizeForPersist` defined in Task 3 and used by `trimMessages` there.

**One discovered refinement folded in:** capturing run metadata for the buffered JSON flows needed an
`onRun(run)` hook (Task 6 Step 1a) rather than changing those functions' return type — keeps their parsed
return value intact while still surfacing the readout.
