/**
 * Chat panel bridge.
 *
 * The AI chat panel is now a React component (src/components/chat/ChatPanel.jsx)
 * that listens for the `rd:chat-*` window events dispatched below. This thin
 * module preserves chatPanel.js's original ES exports so the still-vanilla
 * callers keep importing the same names from the same path with zero churn:
 *
 *   - inlineEditor.js  → openChatWithContext(), addContextChip()
 *   - onboarding.js    → refreshChatPanel()
 *   - main.js          → refreshChatPanel(), startProfileInterviewFromPanel()
 *
 * Each call simply dispatches the matching event; ChatPanel.jsx subscribes while
 * mounted. (initChatPanel() is gone — the React panel self-initializes on mount,
 * and main.js now inits diffView/inlineChanges directly since it owns the
 * resume-rerender callback.)
 */

// Open the chat panel and attach the given resume context as a chip.
export function openChatWithContext(context, elementPath, contextType = 'text') {
  window.dispatchEvent(
    new CustomEvent('rd:chat-open-context', {
      detail: { context, path: elementPath || '', type: contextType },
    })
  );
}

// Add a pre-built context chip without forcing the panel open.
export function addContextChip(chipData) {
  window.dispatchEvent(new CustomEvent('rd:chat-add-chip', { detail: chipData }));
}

// Re-evaluate model/configuration state (called after API keys change).
export function refreshChatPanel() {
  window.dispatchEvent(new CustomEvent('rd:chat-refresh'));
}

// Open the panel and kick off the AI profile interview.
export function startProfileInterviewFromPanel() {
  window.dispatchEvent(new CustomEvent('rd:chat-start-interview'));
}
