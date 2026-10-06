// Ephemeral, profile-bound AI work. Polling keeps the HTTP bridge responsive and
// lets a dropped connection rejoin the same operation without spending twice.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TTL_MS = 15 * 60_000;
const error = (status, code, message) => ({ status, body: { code, error: message } });

export function createBridgeProgress() {
  const operations = new Map();
  function prune() {
    for (const [id, entry] of operations) {
      if (Date.now() - entry.startedAt > TTL_MS && entry.result) operations.delete(id);
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
      if (operations.size >= 32) {
        const completed = [...operations].find(([, entry]) => entry.result);
        if (completed) operations.delete(completed[0]);
        else return error(503, 'bridge_busy', 'On Paper is handling too many requests. Try again shortly.');
      }
      const entry = { owner, fingerprint, startedAt: Date.now(),
        progress: { stage: 'preparing', message: 'Preparing your request' } };
      operations.set(id, entry);
      const hooks = {
        onReasoning(delta, full) {
          entry.progress = { stage: 'thinking', kind: 'reasoning',
            message: String(full ?? delta ?? '').slice(-2400) };
        },
        onContent() {
          entry.progress = { stage: 'writing', message: 'Putting the result together' };
        },
      };
      void Promise.resolve().then(() => execute(hooks)).then((result) => {
        entry.result = result;
      }, () => { entry.result = error(502, 'ai_failed', 'The AI request could not finish. Try again.'); });
      return snapshot(id, entry);
    },
  };
}
