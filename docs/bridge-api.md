# Bridge API reference

The **companion bridge** is a loopback HTTP server the On Paper desktop
app runs so a browser companion extension can read your resumes, ask the app's
AI to draft answers, export PDFs, and record job applications — all against the
one running app instance, with no separate account or cloud service.

This document is the authoritative endpoint reference. It is written from the
code as built:

- Routing, statuses, validation — `resume-designer/src/bridgeRoutes.js`
- Token / dependency wiring — `resume-designer/src/bridge.js`
- Loopback server, port, body cap, timeouts — `resume-designer/src-tauri/src/commands/bridge.rs`

## Base URL

```
http://127.0.0.1:17872
```

The server binds `127.0.0.1` only — it is never reachable off the machine. The
port (`17872`) is fixed. If the port is already in use the bridge does not
start (it logs and gives up); the app itself is unaffected.

## Authentication and pairing

Every endpoint except `GET /health`, `POST /pairing/request`, and
`POST /pairing/claim` requires a bearer token:

```
Authorization: Bearer <token>
```

The token is a per-install random UUID. **Open and connect** first checks the
loopback bridge. When a compatible app is already running and advertises
`pairing.request`, the extension sends a one-time SHA-256 challenge to
`POST /pairing/request`. The app foregrounds its window and asks for explicit
approval. The request returns only `202 {"pending":true}`; the token is available
only from `POST /pairing/claim` after approval and proof of the verifier.

If the app is unavailable or lacks that capability, the extension opens a
`resume-designer://companion/pair` link containing the challenge, random request
ID, and protocol version. This cold-launch path needs the installed app's OS
URL-handler registration. Merely running an uninstalled development/demo bundle
does not guarantee that registration. Once a compatible bridge responds, the
same request/approval flow is available without relying on deep-link delivery.

The extension verifies a claimed token against `GET /resumes` and stores it only
in memory-backed `chrome.storage.session`. It is never persisted to Chrome
local/sync storage and is cleared on extension reload/update/disable or browser
restart. Neither the durable token nor the one-time verifier appears in a deep
link; the verifier remains inside the extension until the proof exchange.

The masked token remains available under **Settings → Data → Companion
extension** as an advanced recovery/troubleshooting path. Treat it like a
password — anyone with the token and local machine access can drive the app.

The desktop token is explicitly included in `BACKUP_FIXED_KEYS` and
`BACKUP_SHARED_KEYS`, so **full app backups include it**. Restoring a full backup
can restore that backup's pairing token, including an older token. The API key
is separate: it stays in the system keychain and is excluded from backups.
A changed pairing token invalidates the current browser session; the extension
then asks for approval again or offers manual pairing.

A missing or wrong token on any authenticated route returns:

```
HTTP 401
{"error":"invalid or missing bearer token"}
```

## Conventions

- All request and response bodies are JSON. Responses always carry
  `Content-Type: application/json`.
- `POST` bodies must be valid JSON with a top-level object. A malformed body
  returns `400 {"error":"invalid JSON body"}`. A valid non-object value such
  as `null`, an array, a string, or a number returns
  `400 {"error":"JSON body must be an object"}`.
- Request bodies must be valid UTF-8. A body that can't be read as UTF-8 text
  returns `400 {"error":"unreadable request body"}` (enforced in Rust before
  the request reaches the router).
- Request bodies are capped at **1 MiB**. A larger body returns
  `413 {"error":"request body too large"}` (enforced in Rust before the request
  reaches the router).
- Requests are accepted only when the HTTP `Host` header is exactly
  `127.0.0.1:17872`. Responses use `Cache-Control: no-store` and
  `X-Content-Type-Options: nosniff`.
- The native bridge accepts at most **16 in-flight requests**. Additional
  requests fail immediately with
  `503 {"error":"On Paper is handling too many companion requests","code":"bridge_busy"}`
  rather than accumulating unbounded work inside the app.
- Because every request round-trips through the running app's JavaScript (see
  [Design notes](#design-notes)), the app must be **running and unlocked**. If
  the webview does not answer in time the server returns
  `504 {"error":"the app did not answer in time — is On Paper running and unlocked?"}`.
  Timeouts: **2 s** for `/health`, `/pairing/request`, and `/pairing/claim`, **180 s** for `/ai/*`
  and any `…/pdf` path (model latency / PDF render), **30 s** for everything
  else.
- If the app window is unavailable to receive the request at all, the server
  returns `502 {"error":"app window unavailable"}`.
- If the server's internal request-tracking state is unusable (a poisoned lock
  after a panic — should not happen in practice), it returns
  `500 {"error":"bridge state lock poisoned"}`.
- Authenticated résumé, profile, learned-answer, PDF, and application data is
  scoped to the profile active for the current app boot. `GET /resumes`
  returns both the stable `profileId` and an opaque, boot-scoped
  `profileContextId`. The context ID changes on every app reload, including a
  profile switch or backup restore. Clients must discard profile-scoped
  selections and work if it changes. The pairing token is install-scoped, so
  switching profiles does not require re-pairing.
- While saves are suspended for a destructive backup import, every
  profile-sensitive route — `GET /resumes`, `GET /resumes/:id`,
  `GET /resumes/:id/pdf`, every `POST /ai/*` action, `POST /applications`, and
  `POST /profile/answers` — returns
  `503 {"error":"a data import is in progress; retry after the app reloads","code":"profile_changed"}`
  until the app reloads. The public `GET /health` probe remains available
  during this window.

### Status codes at a glance

| Status | Meaning |
| ------ | ------- |
| `200`  | OK (GET routes, `POST /ai/complete`) |
| `202`  | Native pairing approval requested; no token returned |
| `201`  | Created (`POST /applications`, `POST /profile/answers`) |
| `400`  | Invalid JSON body, non-UTF-8 request body, or request-body validation failed |
| `401`  | Missing/invalid bearer token |
| `403`  | A one-time pairing request was rejected |
| `404`  | Unknown resume id, pairing request, or route |
| `409`  | Stale/missing `profileContextId`, or reuse of a tailoring/application idempotency key with a different request |
| `413`  | Request body exceeds 1 MiB |
| `425`  | Pairing approval is still pending |
| `429`  | Another native pairing approval is open or requests are too frequent |
| `500`  | Unhandled error inside the router (e.g. PDF export failed), or the Rust-side bridge state lock is poisoned |
| `502`  | AI upstream failed (`/ai/complete`), or app window unavailable |
| `503`  | Bridge concurrency limit reached (`code: "bridge_busy"`), or a destructive import suspended profile-sensitive routes (`code: "profile_changed"`) |
| `504`  | The app did not answer within the timeout |
| `507`  | A résumé, application, or reusable answer could not be saved durably |

---

## Endpoints

In the examples below, `$TOKEN` is the pairing token from Settings.

### `GET /health`

Liveness probe. **Public**, as are the pairing request and one-time claim. Use it to confirm the bridge is up and
to read the app version. It remains
available while a destructive backup import suspends profile-sensitive routes.

**Response** `200`

```json
{
  "ok": true,
  "app": "resume-designer",
  "version": "1.0.0",
  "protocolVersion": 2,
  "capabilities": [
    "app.launch",
    "pairing.challenge",
    "pairing.request",
    "pairing.revoke",
    "profile.context",
    "resume.pdf",
    "ai.complete",
    "ai.models",
    "ai.job-fit",
    "ai.tailored-resume",
    "profile.answers",
    "applications.log",
    "applications.idempotent"
  ]
}
```

Clients must validate `app`, `protocolVersion`, and their required capability
set before sending a stored bearer token. A different response on the fixed
port is not On Paper; an older protocol/capability set requires an app
update.

```bash
curl -s http://127.0.0.1:17872/health
```

---

### `POST /pairing/request`

Start native approval in an already-running app. Public, but the native HTTP
boundary accepts only `POST` with `Content-Type: application/json` (an optional
charset is allowed) and the exact production `Origin`
`chrome-extension://keggfbelidgpjiapcbgkjidenhdjmega`. The body’s `clientId` must
match that origin. The fixed loopback Host check also applies. Other extension
IDs, ordinary web origins, absent/null origins, simple form/text posts, and
preflights are rejected with `403`; no CORS access is enabled. Local processes can forge HTTP headers, so these checks do
not replace native approval or the verifier proof.

**Request**

```json
{
  "protocolVersion": "2",
  "requestId": "a-random-base64url-request-id",
  "challenge": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "clientId": "keggfbelidgpjiapcbgkjidenhdjmega"
}
```

All fields are strings. The request ID must be 16–128 base64url characters,
the challenge exactly 43, and the client ID the trusted extension ID. Duplicate
requests with the same ID/challenge/client reuse their existing grant and never open
another prompt. Only one approval dialog may be pending; new HTTP attempts
must be at least five seconds apart. Approval follows the same 60-second grant
TTL and one-time proof validation as deep-link pairing.

**Response** `202`: `{"pending":true}`. Never contains a bearer token.

**Errors:** `400 invalid_pairing_request`; `403` for disallowed HTTP request
origin/type; `409 invalid_pairing_request` for a reused ID with another
challenge; `429 pairing_busy`; `503 profile_changed` during destructive import.

---

### `POST /pairing/claim`

One-time unauthenticated exchange used only after the app receives a valid
`POST /pairing/request` or a valid `resume-designer://companion/pair` link
and the user approves it. The verifier
must be 43–128 base64url characters and hash to the challenge registered by the
pairing request. Grants expire after 60 seconds and are deleted after the first
successful claim or a rejection. The native HTTP boundary also requires the
trusted extension JSON origin for claims and binds the grant to that client;
setting a different `clientId` in the JSON or a launch link cannot bypass it.

**Request**

```json
{
  "requestId": "a-random-base64url-request-id",
  "verifier": "the-extension-only-base64url-verifier"
}
```

**Response** `200`

```json
{"token":"per-install-token"}
```

**Errors:** `400 {"code":"invalid_pairing_claim"}` for malformed input;
`403 {"code":"pairing_rejected"}`; `404 {"code":"pairing_not_found"}` for
unknown, expired, wrong-verifier, or replayed claims; `425
{"code":"pairing_pending"}` while the confirmation is open; `503
{"code":"pairing_unavailable"}` if the app cannot make the token durable.

---

### `POST /pairing/revoke`

Authenticated. Rotate the app's install token, invalidate pending grants, and
wait for durable storage before returning `200 {"ok":true}`. Failure returns
`503 pairing_unavailable` and must not be presented as successful revocation.
The extension aborts its active mutation requests and rejects operations that
were waiting in a preflight when disconnect began. The desktop rechecks the
request’s authorization generation and token immediately before a mutation
commits, so an AI result still in flight cannot save after revocation. A write
committed before revocation is not undone or relabeled as a retryable failure.
The extension still forgets its own session token and consent on disconnect,
and distinguishes local disconnection from acknowledged app-wide revocation.

---

### `GET /resumes`

List every resume variant, newest first (sorted by `updatedAt` descending).

**Response** `200`

```json
{
  "profileId": "pmf2k8s9c1abc234",
  "profileContextId": "c9e8d7a1-92c0-4e95-962e-89d8285dbe3e",
  "resumes": [
    {"id":"custom-1770251688327","name":"Backend Engineer - Acme Corp","updatedAt":"2026-07-15T22:21:02.749Z"},
    {"id":"custom-1770248233098","name":"Frontend Engineer - Globex","updatedAt":"2026-07-04T02:41:46.505Z"}
  ]
}
```

Each entry is a lightweight summary — `id`, `name`, `updatedAt` only. Fetch the
full document with `GET /resumes/:id`. `profileId` identifies the active
profile; `profileContextId` identifies this exact running-app context. Cache
both with any selected résumé, mapping, review, or fill payload, and use the
context ID as the guard before profile-sensitive work. If it differs or is
absent, discard that state, refetch the list, and ask the user to scan/review
again. This also invalidates work after a restore that reloads into the same
profile. Résumé IDs alone are not a safe check because IDs can collide between
profiles.

```bash
curl -s http://127.0.0.1:17872/resumes \
  -H "Authorization: Bearer $TOKEN"
```

**Errors:** `401`; `503 {"error":"a data import is in progress; retry after the
app reloads","code":"profile_changed"}` while a destructive backup import is
waiting for the app reload.

---

### `GET /resumes/:id`

Full detail for one resume variant, plus the active profile's user profile and
learned answers (returned alongside so the extension can fill forms in one
round-trip).

**Response** `200`

```json
{
  "profileId": "pmf2k8s9c1abc234",
  "profileContextId": "c9e8d7a1-92c0-4e95-962e-89d8285dbe3e",
  "id": "custom-1770251688327",
  "name": "Backend Engineer - Acme Corp",
  "updatedAt": "2026-07-15T22:21:02.749Z",
  "data": { "name": "Jane Q. Applicant", "tagline": "…", "summary": "…", "contact": {}, "experience": [] },
  "profile": { },
  "learnedAnswers": []
}
```

- `data` — the full resume document for this variant.
- `profileId` / `profileContextId` — the same context labels returned by
  `GET /resumes`; verify them before using this data.
- `profile` — the active profile's user profile (`getUserProfile()`),
  independent of the variant.
- `learnedAnswers` — every saved question/answer pair (see
  `POST /profile/answers`).

```bash
curl -s http://127.0.0.1:17872/resumes/custom-1770251688327 \
  -H "Authorization: Bearer $TOKEN"
```

**Errors:** `401`; `404 {"error":"no resume with id <id>"}` if the id is
unknown; `503 {"error":"a data import is in progress; retry after the app
reloads","code":"profile_changed"}` while a destructive backup import is
waiting for the app reload. Note: ids are matched by **own key only** —
inherited object keys such as `__proto__` or `constructor` do not resolve and
return `404`.

---

### `GET /resumes/:id/pdf`

Render the given variant to a vector PDF and return it base64-encoded. The
render happens headlessly in a hidden print window against that specific variant
(not the currently-open one).

**Response** `200`

```json
{"profileId":"pmf2k8s9c1abc234","profileContextId":"c9e8d7a1-92c0-4e95-962e-89d8285dbe3e","filename":"Backend-Engineer---Acme-Corp.pdf","pdfBase64":"JVBERi0…"}
```

- `profileId` / `profileContextId` — label the context that rendered the PDF;
  verify them before attaching it.
- `filename` — derived from the variant name: trimmed, characters outside
  letters/numbers/`_ . -`/space stripped, spaces collapsed to `-`, then
  `.pdf`. Empty names fall back to `Resume.pdf`.
- `pdfBase64` — the PDF bytes, base64-encoded. Decode to get a valid PDF.

```bash
curl -s http://127.0.0.1:17872/resumes/custom-1770251688327/pdf \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json,base64; open('out.pdf','wb').write(base64.b64decode(json.load(sys.stdin)['pdfBase64']))"
file out.pdf   # PDF document, version 1.5, N pages
```

**Errors:** `401`; `404 {"error":"no resume with id <id>"}`; `500` if the export
fails, including when another export is already running —
`{"error":"another PDF export is in progress — try again in a moment"}` (see
[one export at a time](#one-export-at-a-time));
`503 {"error":"a data import is in progress; retry after the app reloads","code":"profile_changed"}`
while a destructive backup import is waiting for the app reload; `504` if the
render exceeds 180 s.

---

### `GET /ai/models`

Authenticated cached model catalog; no provider request and no API key in the
response. The app supplies text-capable cached models, featured/offline
fallbacks, custom models, and currently configured defaults.

```json
{
  "models": [{"id":"provider/model-slug","name":"Model name"}],
  "defaults": {"mapping":"provider/model-slug","analysis":"provider/model-slug","tailoring":"provider/model-slug"},
  "autoFallback": false
}
```

All three AI POST endpoints below accept an optional `model` string (maximum
256 characters) from this catalog. Invalid/unknown values return
`400 invalid_model` before AI runs. Omission uses the app's existing action
default. An explicit model selects the primary model without changing those
preferences; the app's automatic provider fallback setting still applies.
The `ai.models` health capability identifies this API.

---

### `POST /ai/complete`

Run a one-shot completion through the app's configured AI (OpenRouter model set
in Settings). No resume context is injected — the caller supplies the full
message list.

**Request**

```json
{
  "profileContextId": "c9e8d7a1-92c0-4e95-962e-89d8285dbe3e",
  "messages": [{"role":"user","content":"Reply with exactly: bridge-ok"}],
  "systemPrompt": "optional system prompt",
  "reasoningEffort": "none | low | medium | high (optional)"
}
```

- `profileContextId` (required) — must match the `profileContextId` returned by
  `GET /resumes` for the app boot currently serving the request.
- `messages` (required) — non-empty array of `{role, content}`, both strings.
- `systemPrompt` (optional) — sent as the system message; when omitted, the
  app's default assistant system prompt is used.
- `reasoningEffort` (optional) — forwarded to the model.

**Response** `200`

```json
{"text":"bridge-ok"}
```

```bash
curl -s http://127.0.0.1:17872/ai/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"profileContextId":"c9e8d7a1-92c0-4e95-962e-89d8285dbe3e","messages":[{"role":"user","content":"Reply with exactly: bridge-ok"}]}'
```

**Errors:** `401`; `400 {"error":"invalid JSON body"}` (malformed body) or
`400 {"error":"messages must be a non-empty array of {role, content}"}`
(validation); `409 {"error":"profile context changed; refresh the companion
extension","code":"profile_changed"}` if `profileContextId` is missing or
stale; `502 {"error":"<upstream message>"}` if the AI request fails (e.g. no
API key configured, or the model call errors);
`503 {"error":"a data import is in progress; retry after the app reloads","code":"profile_changed"}`
while a destructive backup import is waiting for the app reload; `504` if the
model does not respond within 180 s.

---

### `POST /ai/job-fit`

Analyze one explicitly selected résumé against a normalized job description
using the selected primary model or app analysis default, reasoning setting, OpenRouter key,
and usage tracking.

**Request**

```json
{
  "profileContextId": "c9e8d7a1-92c0-4e95-962e-89d8285dbe3e",
  "resumeId": "custom-1770251688327",
  "job": {
    "title": "Staff Product Engineer",
    "company": "Example Co",
    "url": "https://jobs.example.com/staff-product-engineer",
    "description": "Job description text…"
  }
}
```

The description is required and capped at 64 KiB after normalization. Title
and company are capped at 300 characters; URL is optional, capped at 2,048
characters, and must be HTTP(S). AI output is recursively size- and
shape-bounded before it is returned.

**Response** `200`

```json
{
  "profileId": "pmf2k8s9c1abc234",
  "profileContextId": "c9e8d7a1-92c0-4e95-962e-89d8285dbe3e",
  "resumeId": "custom-1770251688327",
  "analysis": {
    "matchScore": 82,
    "keywordMatches": ["product strategy"],
    "missingKeywords": ["payments"],
    "strengths": ["Relevant staff-level leadership"],
    "gaps": [],
    "recommendations": []
  }
}
```

**Errors:** `400 invalid_job`; `401`; `404 resume_not_found`; `409
profile_changed`; `502 ai_failed` or `invalid_ai_response`; `503
profile_changed`; `504`.

---

### `POST /ai/tailored-resume`

Generate safe changes from one explicitly selected résumé, save them as a new
variant, and select that new variant in the running app. It never changes or
submits the application page.

**Request**

```json
{
  "profileContextId": "c9e8d7a1-92c0-4e95-962e-89d8285dbe3e",
  "resumeId": "custom-1770251688327",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "job": {
    "title": "Staff Product Engineer",
    "company": "Example Co",
    "url": "https://jobs.example.com/staff-product-engineer",
    "description": "Job description text…"
  }
}
```

`requestId` must be a UUIDv4 and is the idempotency key. An explicit `model`
is included in the request fingerprint; reusing an ID with another model is
a conflict. Retrying it returns
the already-created `companion-<requestId>` variant rather than generating a
duplicate. Generated paths are allowlisted against the résumé schema;
prototype keys, excessive nesting/arrays/text, unknown roots, and unsafe array
indices are rejected before saving.

**Response** `201` on first creation, `200` on replay

```json
{
  "profileId": "pmf2k8s9c1abc234",
  "profileContextId": "c9e8d7a1-92c0-4e95-962e-89d8285dbe3e",
  "created": true,
  "resume": {
    "id": "companion-550e8400-e29b-41d4-a716-446655440000",
    "name": "Staff Product Engineer — Example Co",
    "updatedAt": "2026-07-17T20:00:00.000Z"
  }
}
```

**Errors:** `400 invalid_job` or `invalid_request_id`; `401`; `404
resume_not_found`; `409 profile_changed` or `idempotency_conflict` (the same
`requestId` was already bound to different résumé/job input); `502 ai_failed` or
`invalid_ai_response`; `503 profile_changed`; `504`; `507 storage_full`.

---

### `POST /applications`

Record a job application against a variant. Appears in the app's application
tracker (Library). A success response waits for disk persistence.

**Request**

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "profileContextId": "c9e8d7a1-92c0-4e95-962e-89d8285dbe3e",
  "variantId": "custom-1770251688327",
  "company": "Curl Test Co",
  "title": "Engineer",
  "notes": "optional"
}
```

- `profileContextId` (required) — must match
  the `profileContextId` returned by `GET /resumes` for the app boot currently
  serving the request.
- `requestId` (required) — UUIDv4, reused unchanged when retrying the same application intent.
- `variantId` (required) — must be known for a new application; an accepted retry also works after that resume is deleted.
- `company`, `title`, `notes` (optional) — strings; default to `""`.

**Response** `201`

```json
{
  "application": {
    "id": "app-1784154104644-1cp6lfpmnvati",
    "variantId": "custom-1770251688327",
    "variantName": "Backend Engineer - Acme Corp",
    "jobId": null,
    "jobSnapshot": {"title":"Engineer","company":"Curl Test Co"},
    "status": "applied",
    "statusHistory": [{"status":"applied","at":"2026-07-15T22:21:44.644Z"}],
    "createdAt": "2026-07-15T22:21:44.644Z",
    "updatedAt": "2026-07-15T22:21:44.644Z",
    "appliedAt": "2026-07-15T22:21:44.644Z",
    "notes": ""
  }
}
```

New records use `status: "applied"`; `variantName` comes from the resolved variant.
The app stores `companionRequest` metadata with the record. Within the same
profile, the same request ID and original variant/title/company/notes return
the existing record after a fresh durability check, including after a restart
or later native edits. Reusing the ID with different details returns
`409 idempotency_conflict`. A genuinely new application uses a new UUID.
Refresh `profileContextId` after an app restart while retaining the request ID.
A timeout does not prove the first write failed; do not generate a new ID just
because the HTTP response was lost. Companion 0.1.5 requires the
`applications.idempotent` health capability before connecting.

```bash
curl -s http://127.0.0.1:17872/applications \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"requestId":"550e8400-e29b-41d4-a716-446655440000","profileContextId":"c9e8d7a1-92c0-4e95-962e-89d8285dbe3e","variantId":"custom-1770251688327","company":"Curl Test Co","title":"Engineer"}'
```

**Errors:** `400 invalid_request_id` for a missing/invalid UUID;
`409 idempotency_conflict` for changed details under an accepted ID;
`507 storage_full` if the write cannot be persisted; `401`; `400 {"error":"invalid JSON body"}` or
`400 {"error":"variantId is required"}`; `404 {"error":"no resume with id <id>"}`
if `variantId` is unknown; `409 {"error":"profile context changed; refresh the
companion extension","code":"profile_changed"}` if `profileContextId` is
missing or stale;
`503 {"error":"a data import is in progress; retry after the app reloads","code":"profile_changed"}`
while a destructive backup import is waiting for the app reload.

---

### `POST /profile/answers`

Save a learned question/answer pair (for example, notice period) to
the active profile. Upserts by a normalized form of the question, so re-saving
the same question updates the existing answer in that profile. Returned by every
`GET /resumes/:id` in `learnedAnswers`. Saves are serialized with application
logs and acknowledged only after disk persistence; rejected writes return
`507 storage_full` and are rolled back without discarding newer native edits.

**Request**

```json
{"profileContextId":"c9e8d7a1-92c0-4e95-962e-89d8285dbe3e","question":"Notice period?","answer":"4 weeks"}
```

- `profileContextId` (required) — must match
  the `profileContextId` returned by `GET /resumes` for the app boot currently
  serving the request.
- `question` (required) — non-empty after trimming.
- `answer` (required) — non-empty after trimming.

**Response** `201`

```json
{
  "answer": {
    "id": "ans-1784154104633-m1g5ig13wib5q",
    "question": "Notice period?",
    "normalized": "notice period",
    "answer": "4 weeks",
    "createdAt": "2026-07-15T22:21:44.633Z",
    "updatedAt": "2026-07-15T22:21:44.633Z"
  }
}
```

```bash
curl -s http://127.0.0.1:17872/profile/answers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"profileContextId":"c9e8d7a1-92c0-4e95-962e-89d8285dbe3e","question":"Notice period?","answer":"4 weeks"}'
```

**Errors:** `401`; `400 {"error":"invalid JSON body"}` or
`400 {"error":"question and answer are required"}`; `409` with
`code:"profile_changed"` if `profileContextId` is missing or stale;
`503 {"error":"a data import is in progress; retry after the app reloads","code":"profile_changed"}`
while a destructive backup import is waiting for the app reload.

---

### Unknown routes

Any authenticated request that matches no route returns:

```
HTTP 404
{"error":"no route: <METHOD> <path>"}
```

---

## Design notes

### Launching and reconnecting

The installed desktop app registers the `resume-designer://` scheme. An
`…/open?protocolVersion=2` link only launches/focuses the app; an `…/pair` link
registers a short-lived challenge and triggers explicit consent. The desktop
single-instance integration forwards deep links to the existing process on
platforms that otherwise start a second one, then shows, unminimizes, and
focuses the main window. The extension never launches the app merely because
its side panel opened; launch happens after an explicit connect or app-backed
action.

### Extension cancellation, time bounds, and review binding

These are internal runtime messages, not additional HTTP endpoints:

- `connection.check` is read-only: health and authenticated résumé access. It
  never opens an app or starts native approval.
- `app.open` probes first, requests approval through a running app when
  supported, and uses a deep link only when needed. Its full attempt is capped
  at 85 seconds, including OS launch, HTTP calls, and poll delays.
- `pairing.cancel` returns `{"cancelled":true}` after invalidating the pending
  attempt and cancelling its requests. It preserves existing credentials and
  consent. A late automatic response cannot overwrite a manual connection.
  The native consent dialog may still need to be dismissed in the app.
- Extension HTTP deadlines cover headers and response-body reading: 4 seconds
  for health/pairing, 185 seconds for AI actions/PDF, 30 seconds otherwise
  (including model catalog). These are client bounds in addition to the
  server's per-handler timeouts.
- `page.scan` preserves the sanitized content `page.url` and adds the trusted
  Chrome tab ID (`page.tabId`) and full URL (`page.tabUrl`). The full URL stays
  in the local review context and is not sent to AI. `page.fill`
  requires the original immutable `reviewContext:{page,descriptors}`. The
  background checks tab ID/URL before PDF export and immediately before
  sending values; content code checks page/job/field identity again. A changed
  tab or application fails with `stale_review` and requires a fresh review.

The panel ignores late results from cancelled attempts. A sequence of missing
pairing grants is reported as `pairing_not_received`; an approval that was seen
pending but times out is `pairing_timeout`. These conditions offer manual
pairing rather than leaving an indefinitely disabled panel.

### Single writer — everything round-trips through the app's JS

The Rust loopback server is deliberately a **dumb pipe**. It reads the request,
forwards it to the main webview as a `bridge:request` event, and blocks on a
per-request channel until the app's JavaScript answers via the `bridge_respond`
command. All reads and writes — resumes, profile, applications, learned answers,
PDF export — go through the running app's own JS modules (`persistence.js`,
`applications.js`, `learnedAnswers.js`, `aiService.js`, `pdf.js`).

This preserves `appStorage`'s **single-writer contract**: the running app is the
only process that touches the on-disk store. The bridge never reads or writes
storage files directly, so there is no cache-coherence risk between the bridge
and the live app, and no way for a companion request to corrupt state the app
has in memory. The cost is that the app must be running and unlocked to answer —
hence the `504` when the webview is silent and the `502` when the window is
unavailable.

### One PDF export at a time

PDF export drives a single hidden print window through a single-occupancy native
temp slot. The export path is guarded so only one export runs at a time: a
second concurrent `GET /resumes/:id/pdf` fails fast with
`500 {"error":"another PDF export is in progress — try again in a moment"}`
rather than corrupting the in-flight render. The guard is released on every exit
path (success or failure), so a failed export never permanently blocks future
ones. Callers should serialize PDF requests, or retry on that specific error.
