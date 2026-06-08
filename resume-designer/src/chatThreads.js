/**
 * Chat thread persistence — framework-agnostic helpers extracted from the former
 * chatPanel.js so the React `useChat` hook (and unit tests) can own thread state
 * without the panel's heavy import graph. Pure functions over plain thread
 * objects + localStorage; no module-level mutable state.
 *
 * Thread shape: { id, name, messages, createdAt, updatedAt }
 * Only the last 50 messages of a thread are persisted (see MAX_PERSISTED).
 */

const STORAGE_KEY = 'resume-designer-chat-history'; // legacy single-thread history
const THREADS_KEY = 'resume-designer-chat-threads';
const MAX_PERSISTED = 50;

// Short random suffix so two threads created in the same millisecond can't collide.
function randomSuffix() {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0].toString(36);
  } catch {
    return Math.floor(Math.random() * 1e9).toString(36);
  }
}

export function makeThread(name = 'New Chat', initialMessages = []) {
  const now = new Date().toISOString();
  return {
    id: `thread-${Date.now()}-${randomSuffix()}`,
    name,
    messages: Array.isArray(initialMessages) ? initialMessages : [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Load all threads and decide which is current. Migrates legacy single-thread
 * history on first run, guarantees at least one thread, and selects the
 * most-recently-updated thread as current. Mirrors the old loadChatHistory().
 */
export function loadThreads() {
  try {
    const saved = localStorage.getItem(THREADS_KEY);
    let threads = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(threads)) threads = [];

    if (threads.length === 0) {
      // Migrate any old single-thread history into a fresh thread.
      const oldHistory = localStorage.getItem(STORAGE_KEY);
      const oldMessages = oldHistory ? JSON.parse(oldHistory) : [];
      const thread = makeThread('New Chat', Array.isArray(oldMessages) ? oldMessages : []);
      threads = [thread];
      persistThreads(threads);
      return { threads, currentThreadId: thread.id };
    }

    const mostRecent = [...threads].sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    )[0];
    return { threads, currentThreadId: mostRecent.id };
  } catch (e) {
    console.error('Failed to load chat history:', e);
    const thread = makeThread('New Chat');
    return { threads: [thread], currentThreadId: thread.id };
  }
}

export function persistThreads(threads) {
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
  } catch (e) {
    console.error('Failed to save threads:', e);
  }
}

// Clear the legacy single-thread history key (used by /clear).
export function clearLegacyHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// Trim a message list to the persisted tail.
export function trimMessages(messages) {
  return Array.isArray(messages) ? messages.slice(-MAX_PERSISTED) : [];
}

/**
 * Display name for a thread: an explicit name if the user set one, otherwise a
 * truncated preview of the first user message, falling back to "New Chat".
 */
export function getThreadDisplayName(thread) {
  if (!thread) return 'New Chat';
  if (thread.name && thread.name !== 'New Chat') return thread.name;

  const firstUserMsg = thread.messages?.find((m) => m.role === 'user');
  if (firstUserMsg) {
    const text = firstUserMsg.content || '';
    return text.length > 30 ? `${text.substring(0, 30)}...` : text;
  }
  return thread.name || 'New Chat';
}
