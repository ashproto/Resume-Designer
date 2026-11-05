// Ephemeral, profile-bound AI work. Polling keeps the HTTP bridge responsive and
// lets a dropped connection rejoin the same operation without spending twice.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEADLINE_MS = 15 * 60_000;
const RESULT_TTL_MS = 15 * 60_000;
const error = (status, code, message) => ({ status, body: { code, error: message } });

export function createBridgeProgress() {
  const operations = new Map();
  function prune() {
    for (const [id, entry] of operations) {
      // Replay is bounded from terminal completion, including providers that
      // ignore abort, so hung work cannot retain full payloads indefinitely.
      if (entry.result && Date.now() - entry.completedAt >= RESULT_TTL_MS) operations.delete(id);
    }
  }
  function snapshot(id, entry) {
    return { status: entry.result ? 200 : 202, body: {
      operationId: id, state: entry.result ? 'complete' : 'running',
      progress: entry.progress, ...(entry.result ? { result: entry.result } : {}),
    } };
  }
  return {
    read(id, owner) {
      prune();
      const entry = operations.get(id);
      if (!entry || entry.owner !== owner) return error(404, 'operation_not_found', 'This operation is no longer available.');
      return snapshot(id, entry);
    },
    start(id, owner, fingerprint, execute) {
      prune();
      if (!ID.test(id ?? '')) return error(400, 'invalid_request_id', 'operationId must be a UUID');
      const existing = operations.get(id);
      if (existing) {
        if (existing.owner !== owner || existing.fingerprint !== fingerprint) {
          return error(409, 'idempotency_conflict', 'This operation belongs to different input.');
        }
        return snapshot(id, existing);
      }
      // Terminal deadlines release a running slot even when a provider ignores
      // abort. Its identity stays available for the terminal retention window.
      if ([...operations.values()].filter((entry) => !entry.result).length >= 32) {
        return error(503, 'bridge_busy', 'On Paper is handling too many requests. Try again shortly.');
      }
      if (operations.size >= 32) {
        const completed = [...operations].find(([, entry]) => entry.settled);
        if (completed) operations.delete(completed[0]);
      }
      const controller = new AbortController();
      const entry = { owner, fingerprint, settled: false,
        progress: { stage: 'preparing', message: 'Preparing your request' } };
      operations.set(id, entry);
      function complete(result) {
        if (entry.result) return;
        entry.result = result;
        entry.completedAt = Date.now();
      }
      const deadlineTimer = setTimeout(() => {
        complete(error(504, 'ai_failed', 'The AI request timed out. Start a new request to try again.'));
        controller.abort();
      }, DEADLINE_MS);
      deadlineTimer?.unref?.();
      function settle(result) {
        clearTimeout(deadlineTimer);
        entry.settled = true;
        complete(result);
      }
      const hooks = {
        signal: controller.signal,
        onReasoning(delta, full) {
          if (entry.result) return;
          entry.progress = { stage: 'thinking', kind: 'reasoning',
            message: String(full ?? delta ?? '').slice(-2400) };
        },
        onContent() {
          if (entry.result) return;
          entry.progress = { stage: 'writing', message: 'Putting the result together' };
        },
      };
      void Promise.resolve().then(() => execute(hooks)).then(settle,
        () => settle(error(502, 'ai_failed', 'The AI request could not finish. Try again.')));
      return snapshot(id, entry);
    },
  };
}
