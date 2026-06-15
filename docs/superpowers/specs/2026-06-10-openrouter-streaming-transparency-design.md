# OpenRouter Streaming + Run Transparency — Design

**Date:** 2026-06-10
**Branch:** `feat/react-chrome`
**Status:** Approved for planning

## Goal

Make every AI run in Resume-Designer transparent and live: stream the model's
reasoning and answer as they arrive (replacing today's *synthetic* "thinking"
steps), surface real run metadata (model used, reasoning tokens, cost, web-search
citations), and fix the result-handling bugs found during the audit — across both
the chat panel and the structured "JSON" flows (resume change-requests, job
tailoring, job analysis, onboarding generation).

## Background — audit result

The OpenRouter **request protocol is already correct and current** (verified
against live docs + the `/models` catalog on 2026-06-10):

- `reasoning: { effort }` is the current unified reasoning format. ✓
- `tools: [{ type: 'openrouter:web_search' }]` is the current server-tool format
  (the older `plugins:[{id:'web'}]` is deprecated; the app already migrated). ✓
- All 12 curated slugs resolve and support both `reasoning` and `tools`. ✓
- `usage: { include: true }` returns real cost. ✓

What's wrong is **result handling and surfacing**, not the wire:

1. **Bug** — empty `content` dumps raw JSON as the answer
   (`text || JSON.stringify(...)`, `aiService.js:970`).
2. **Bug** — `max_tokens` ignores reasoning; Haiku's 4096 cap + high effort can
   truncate mid-thought → feeds bug #1. No `finish_reason` handling anywhere.
3. **Gap** — web-search **citations are dropped**: only a `usedWebSearch` boolean
   is returned; the `url_citation` annotations never reach the UI.
4. **Gap** — reasoning is **clipped to 300 chars**, not expandable
   (`MessageList.jsx:9`).
5. **Gap** — `reasoning_details` and `usage…reasoning_tokens` are ignored
   (no token transparency; Anthropic multi-turn continuity not preserved).
6. **Polish** — reasoning effort + web-search toggle are not persisted.
7. **Latent bug** — chat *change-requests* (`generateResumeChanges` via
   `useChat`) silently run with **no reasoning**, ignoring the composer's existing
   reasoning picker. The Jobs **"Tailor Resume"** button has no reasoning control
   at all.
8. **Dead code** — `tailorForJob` (`aiService.js:1201`) has zero callers.

## Non-goals

- No change to the résumé document, renderer, or PDF/print pipeline.
- No change to the request protocol (it's correct).
- No new pricing logic — cost continues to come from OpenRouter's `usage.cost`.
- Slash-command helpers (`/feedback`, `/improve`, `/generate`) and the profile
  interview keep working through the unified path and gain metadata capture, but
  are not a focus of new live-reasoning UI in this pass (they already stream
  through the same core for free; see "Scope of live UI").

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │  aiService.js                                │
 chat / JSON flows  │                                             │
 ───────────────────►  streamOpenRouter(model, msgs, opts, hooks) │
                    │     └─ fetch(stream:true) → ReadableStream  │
                    │     └─ createStreamAccumulator()  [PURE]     │◄── unit-tested
                    │           ├─ onReasoning(delta, full)        │
                    │           ├─ onContent(delta, full)          │
                    │           ├─ onAnnotations(list)             │
                    │           └─ → { text, reasoning,            │
                    │                  reasoningDetails,           │
                    │                  annotations, usage,         │
                    │                  model, finishReason }       │
                    │  callOpenRouter(...)  = stream + buffer      │
                    │     (no hooks → identical final result)      │
                    └─────────────────────────────────────────────┘
                          │                         │
              live hooks  │                         │ buffered (parse JSON at end)
                          ▼                         ▼
                  Chat (useChat)          Jobs / Onboarding modals
                  live reasoning +        live reasoning panel +
                  live answer + Stop      token readout (no cost)
```

### Layer 1 — streaming core (`aiService.js`)

**`createStreamAccumulator()` — the pure, testable heart.** A factory returning
`{ push(textChunk) → events[], result() }`. It owns SSE framing and accumulation
with **no I/O**, so it can be unit-tested by feeding recorded chunk strings:

- Splits the rolling buffer on `\n`, keeping any partial trailing line.
- Ignores SSE comment lines (`:` prefix — OpenRouter sends `: OPENROUTER
  PROCESSING` keep-alives).
- On `data: ` lines: `[DONE]` ends; otherwise `JSON.parse` the payload and read
  `choices[0].delta.content`, `.delta.reasoning`, `.delta.reasoning_details`
  (merged by `index`), `choices[0].finish_reason`, top-level `model`, `usage`
  (final chunk), and `choices[0].delta.annotations` / message annotations.
- A `data:` chunk carrying `{ error: {...} }` mid-stream throws with the message.
- Accumulates `content`, `reasoning`, `reasoningDetails[]`, `annotations[]`,
  `usage`, `model`, `finishReason`; emits typed events
  (`{type:'reasoning'|'content'|'annotations', ...}`) for the caller's hooks.

**`streamOpenRouter(modelId, messages, options, hooks)`** — the I/O wrapper:

- Builds the same `requestBody` as today (system message, mapped messages,
  fallback `models`, `reasoning`, web-search `tools`) **plus** `stream: true` and
  `usage: { include: true }`.
- **max_tokens fix:** when reasoning is enabled, set the completion cap to a floor
  that leaves room for the answer after thinking:
  `max_tokens = reasoningOn ? Math.max(cfg?.maxTokens || 8192, 16000) : (cfg?.maxTokens || 8192)`
  (OpenRouter clamps to the model's true max, so over-asking is safe).
- `fetch(..., { signal })` where `signal` comes from an `AbortController` the
  caller supplies via `options.signal` (powers the Stop button / modal cancel).
- Reads `response.body.getReader()` + `TextDecoder`, feeds each chunk into the
  accumulator, invokes `hooks.onReasoning` / `hooks.onContent` /
  `hooks.onAnnotations` as events fire.
- On completion returns the accumulator's `result()`:
  `{ text, reasoning, reasoningDetails, annotations, usage, model, finishReason }`.
- **Empty-content fix:** if `text` is empty after the stream:
  - if `finishReason === 'length'` → throw/return a friendly
    "The response hit the token cap — lower reasoning effort or raise max tokens."
  - else surface the provider's refusal/empty cleanly (never raw JSON).
- **Side effects (once, at end):** `addCustomModel(modelId)` and `trackUsage(...)`
  (now including `reasoningTokens` from
  `usage.completion_tokens_details.reasoning_tokens`).
- On `AbortError`: return the partial `result()` with a `stopped: true` flag.

**`callOpenRouter(modelId, messages, options)`** is reimplemented as a thin
wrapper that calls `streamOpenRouter` with **no hooks** and returns the buffered
output — a plain string by default, or the structured
`{ text, thinking, reasoningDetails, annotations, usedWebSearch, run }` object
when `options.structured`. This unifies every flow onto one path, so reasoning
capture, citations, token/cost tracking, the empty-content fix, and `finish_reason`
handling apply **everywhere** with no second code path. Buffered callers get a
byte-identical final answer to today (only the transport changed: stream→buffer).

> Rationale for unifying rather than adding a parallel streaming path: it
> guarantees the JSON flows and chat share one tested accumulator, eliminates
> drift between two request builders, and makes "transparency everywhere" fall out
> for free. The risk (streaming must be robust) is contained by the pure
> accumulator's unit tests and by buffered callers being behavior-identical.

### Layer 2 — run-data model

A run's structured result carries a `run` object:

```js
run = {
  model,            // actual model used (fallback-aware), from the stream
  reasoningTokens,  // usage.completion_tokens_details.reasoning_tokens || 0
  promptTokens,     // usage.prompt_tokens
  completionTokens, // usage.completion_tokens
  cost,             // usage.cost (chat only in UI; omitted from JSON-flow UI)
  webSearch,        // annotations.length > 0
  finishReason,
}
```

**Chat assistant message** gains: `reasoning` (string), `annotations` (array),
`run` (object), and — in memory only — `reasoningDetails` (array).

**Persistence (`chatThreads.js`):** add `sanitizeForPersist(messages)` used by
`persistThreads`/`trimMessages` callers that:
- **drops `reasoningDetails`** (encrypted blobs can be large; localStorage is
  quota-bound), and
- caps persisted `reasoning` to ~8000 chars.
`annotations` + `run` are small and persist as-is. `reasoningDetails` stays on the
live in-memory message so Anthropic continuity holds **within the session**.

**`tokenTrackingService.js`:** `trackUsage` gains an optional `reasoningTokens`
field, recorded on the event and summarized (`byModel` / `byFeature` /
`summary.totalReasoningTokens`). Backward compatible (defaults to 0).

### Layer 3 — UI

**New shared component `LiveReasoning` (`components/chat/LiveReasoning.jsx`).**
One component used by chat *and* the modal flows:
- **Streaming state:** spinner + "Thinking…" header, live reasoning text body
  (auto-scrolled, muted, `whitespace-pre-wrap`), throttled updates.
- **Done state:** collapses to a clickable "Thought for N tokens" / "Reasoning"
  disclosure (chevron) that expands the full reasoning — **replacing the 300-char
  clip**.
- **Encrypted/empty reasoning:** no readable body; header shows
  "Thinking… (N reasoning tokens)" then collapses to "Reasoning hidden by provider
  · N tokens". Degrades gracefully per model.

**Chat (`useChat.js` + `MessageList.jsx` + `ChatComposer.jsx` + `ChatPanel.jsx`):**
- `useChat` holds a `streamingMessage` ref/state
  `{ id, role:'assistant', content, reasoning, reasoningDetails, annotations,
  run, streaming:true }`. As deltas arrive, a **throttled flush** (via
  `requestAnimationFrame`, coalescing bursts) updates it; on done it's committed
  into `messages` (persisted, sanitized) and cleared. This replaces the synthetic
  `thinking` steps for the chat path entirely.
- An `AbortController` per run; `stop()` aborts and commits the partial with a
  "_(stopped)_" suffix.
- `getAIResponse` and `requestAIChanges` route through `streamOpenRouter` with live
  hooks; `requestAIChanges` keeps buffering the JSON for the diff but streams its
  reasoning into `streamingMessage` so the user watches it think before the diff
  appears.
- `MessageList` renders `streamingMessage` after the list (where `thinking` was):
  `LiveReasoning` (live) + throttled `Markdown` of the partial answer + a **Stop**
  button. Completed assistant bubbles render: `LiveReasoning` (collapsed
  disclosure), the answer, a **citations** sources list (from `annotations`), and a
  **run footer** line (`model · N reasoning tokens · $cost · 🌐` when present).
- `ChatComposer` reasoning picker is unchanged but now **persisted** (below).

**Markdown throttle (`Markdown.jsx`):** unchanged for committed messages. The
streaming answer re-renders at most once per animation frame (the accumulator
buffers deltas; `useChat` flushes on rAF), so DOMPurify re-sanitization runs at
~display rate, not per token.

**Citations component (`components/chat/Citations.jsx`):** renders
`annotations` (`url_citation` → numbered list of `{title, url}`) as a compact
"Sources" block under the answer. URLs are validated/escaped via the existing
`htmlEscape`/safe-URL helpers before render.

**JSON / modal flows — live reasoning + token readout (no cost):**
- A `LiveReasoning` panel mounts in each modal's *generating* state (replacing the
  bare spinner): Jobs analysis (`JobsDialog` `isAnalyzing`), Jobs **Tailor**
  (`handleTailor`), and onboarding generation (`OnboardingWizard.generateForJob` /
  the generate step's loading view). It streams reasoning while the JSON answer
  buffers; on done the structured result renders as today.
- **Run readout** (tokens only, **no cost**): `model · N reasoning tokens · N
  total tokens`, shown beside `AnalysisResults` and under the onboarding preview /
  on the tailor diff entry. Implemented as a small `RunMeta` presentational
  component reused across surfaces.
- **Jobs "Tailor Resume" reasoning control:** add a `Reasoning` `Select`
  (mirroring `JobSelectionDialog.jsx:100-111`) to the Tailor entry point; thread the
  choice into `generateResumeChanges`.
- **Chat change-requests:** `requestAIChanges` passes the composer's
  `reasoningRef.current` into `generateResumeChanges` (honoring the existing
  picker — fixes latent bug #7).

### Layer 4 — folded-in fixes

- Empty-content / `finish_reason:'length'` → friendly message, never raw JSON
  (Layer 1).
- `max_tokens` headroom when reasoning on (Layer 1).
- Persist reasoning effort + web search: `useChat.setReasoning` →
  `saveSettings({ chatReasoningEffort })`; `toggleWebSearch` →
  `saveSettings({ chatWebSearch })`; seed initial state from settings. Add both
  keys to `persistence.js` owned-keys/defaults.
- Anthropic continuity: the `useChat` history builder includes `reasoning_details`
  (and `reasoning`) from in-memory assistant messages on subsequent turns.
- `generateResumeChanges` / `analyzeAgainstJobs` / `generateResumeFromProfileForJob`
  thread reasoning effort from their callers' controls (all surfaces now have one).
- Delete dead `tailorForJob`.

### Layer 5 — tests

- **New:** unit-test `createStreamAccumulator()` (pure) with recorded chunk
  sequences: content-only; reasoning+content; `reasoning_details` summary;
  `reasoning_details` encrypted (no readable text); annotations; `finish_reason:
  'length'` with empty content; mid-stream `{error}`; keep-alive comments; `[DONE]`
  framing; a delta split across two chunks (partial-line buffering).
- Existing vitest suite stays green (sanitizer, sort, backup, owned-keys) as the
  regression canary.

## Data flow (chat, happy path)

1. User sends → `useChat.send` → `getAIResponse`.
2. `streamOpenRouter` opens the stream; `onReasoning` deltas fill
   `streamingMessage.reasoning` (rAF-throttled) → `LiveReasoning` shows live
   thinking.
3. `onContent` deltas fill `streamingMessage.content` → throttled `Markdown`
   renders the answer live; `onAnnotations` fills citations.
4. Stream ends → final `{ text, reasoning, reasoningDetails, annotations, run }`;
   `trackUsage` fires once; message committed + persisted (sanitized);
   `streamingMessage` cleared. Footer shows model · reasoning tokens · cost · 🌐;
   Sources list shows citations.

## Risks & mitigations

- **Tauri webview streaming** — WKWebView/WebView2 support `fetch` +
  `ReadableStream`, but this is the one thing `vite preview` can't fully prove.
  **Gate:** verify a live stream in `tauri:dev` (and a Stop mid-stream).
- **CSP** — no change needed: the app already `fetch`es `openrouter.ai`, so
  `connect-src` allows it; streaming uses the same origin. **Verify** the prod CSP
  `connect-src` includes `https://openrouter.ai` and don't touch it otherwise.
- **localStorage quota** — never persist `reasoningDetails`; cap persisted
  `reasoning` (Layer 2).
- **Render perf** — rAF-throttled flush; DOMPurify runs at display rate, not per
  token.
- **JSON-flow regression** — buffered result is byte-identical; existing parse +
  tests cover it.
- **Side-effect timing** — `trackUsage` / `addCustomModel` fire exactly once at
  stream end, never per chunk.
- **Abort** — `stop()` commits a partial; no dangling reader (reader released in
  `finally`).

## Critical files

- `src/aiService.js` — `createStreamAccumulator`, `streamOpenRouter`,
  `callOpenRouter` rewrite, max_tokens + empty-content fixes, delete `tailorForJob`.
- `src/aiService.streaming.test.js` (new) — accumulator unit tests.
- `src/components/chat/useChat.js` — `streamingMessage`, hooks, Stop, persisted
  prefs, history continuity, reasoning into change-requests.
- `src/components/chat/MessageList.jsx` — streaming render, collapsible reasoning,
  citations, run footer (remove the 300-char clip).
- `src/components/chat/LiveReasoning.jsx`, `Citations.jsx`, `RunMeta.jsx` (new).
- `src/components/chat/ChatComposer.jsx` / `ChatPanel.jsx` — Stop wiring.
- `src/chatThreads.js` — `sanitizeForPersist`.
- `src/tokenTrackingService.js` — `reasoningTokens`.
- `src/components/jobs/JobsDialog.jsx` — live reasoning + Tailor reasoning Select +
  run readout; thread reasoning into both flows.
- `src/components/jobs/AnalysisResults.jsx` — `RunMeta` footer.
- `src/components/onboarding/OnboardingWizard.jsx` / `OnboardingSteps.jsx` — live
  reasoning during generation + run readout.
- `src/persistence.js` — `chatReasoningEffort` / `chatWebSearch` defaults +
  owned-keys.

## Verification

1. `npm run lint`, `npm test` (incl. new accumulator tests), `npm run build`.
2. Preview: live reasoning + answer stream in chat; Stop works; reasoning expands;
   citations show with web search on; run footer correct; change-request streams
   reasoning then opens the diff.
3. Preview: Jobs analyze + Tailor + onboarding generation show live reasoning and a
   token (no-cost) readout; Tailor reasoning Select applies.
4. **`tauri:dev` gate:** confirm streaming works in the desktop webview and a
   mid-stream Stop is clean.
5. No commit/push without explicit go-ahead.
