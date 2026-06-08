import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getSettings, saveSettings } from '../../persistence.js';
import { openSettings } from '../../settingsModal.js';
import { useChat } from './useChat.js';
import { MessageList } from './MessageList.jsx';
import { ChatComposer } from './ChatComposer.jsx';
import { ThreadSelector } from './ThreadSelector.jsx';

const MIN_WIDTH = 240;
const MAX_WIDTH = 500;

/**
 * The docked AI chat panel. React owns the entire interior of the existing
 * `<aside id="chat-panel">` shell (the skeleton ships it empty), portaling its
 * content in and toggling the `.closed` class on the host the same way the
 * vanilla panel did. The floating `#toggle-chat-panel` button and its busy
 * indicator stay in the skeleton and are wired here by effect. All cross-module
 * entry points arrive as `rd:chat-*` window events (dispatched by chatPanel.js).
 */
export default function ChatPanel() {
  const chat = useChat();
  const [host] = useState(() => document.getElementById('chat-panel'));
  const [open, setOpen] = useState(false);

  // Latest engine snapshot for the once-subscribed event listeners below.
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const focusInput = () => setTimeout(() => document.getElementById('chat-input')?.focus(), 300);

  // Pin the width var to a clamped, valid value up front so the panel never
  // relies on the CSS fallback or collapses if settings.chatPanelWidth is bad.
  useEffect(() => {
    const saved = Number(getSettings().chatPanelWidth) || 320;
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, saved));
    document.documentElement.style.setProperty('--chat-panel-width', `${width}px`);
  }, []);

  // Wire the floating toggle button (lives in the skeleton).
  useEffect(() => {
    const btn = document.getElementById('toggle-chat-panel');
    if (!btn) return undefined;
    const onClick = () => setOpen((o) => !o);
    btn.addEventListener('click', onClick);
    return () => btn.removeEventListener('click', onClick);
  }, []);

  // Reflect open/closed on the host; focus the input when opening.
  useEffect(() => {
    host?.classList.toggle('closed', !open);
    if (open) {
      const t = setTimeout(() => document.getElementById('chat-input')?.focus(), 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, host]);

  // Busy indicator on the toggle pulses only while a request runs and the panel
  // is closed (so you notice work finishing without the panel open).
  useEffect(() => {
    document.getElementById('chat-toggle-indicator')?.classList.toggle('active', chat.loading && !open);
  }, [chat.loading, open]);

  // Bridge the vanilla/React entry points (inlineEditor, onboarding, settings,
  // profile panel) — subscribed once, always calling the latest engine.
  useEffect(() => {
    const onOpenContext = (e) => { setOpen(true); chatRef.current.openWithContext(e.detail || {}); focusInput(); };
    const onAddChip = (e) => chatRef.current.addChip(e.detail);
    const onRefresh = () => chatRef.current.refresh();
    const onStartInterview = () => { setOpen(true); chatRef.current.startInterview(); };
    window.addEventListener('rd:chat-open-context', onOpenContext);
    window.addEventListener('rd:chat-add-chip', onAddChip);
    window.addEventListener('rd:chat-refresh', onRefresh);
    window.addEventListener('rd:chat-start-interview', onStartInterview);
    return () => {
      window.removeEventListener('rd:chat-open-context', onOpenContext);
      window.removeEventListener('rd:chat-add-chip', onAddChip);
      window.removeEventListener('rd:chat-refresh', onRefresh);
      window.removeEventListener('rd:chat-start-interview', onStartInterview);
    };
  }, []);

  const startResize = (e) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.classList.add('active');
    host?.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const move = (ev) => {
      const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, ev.clientX));
      document.documentElement.style.setProperty('--chat-panel-width', `${w}px`);
    };
    const end = () => {
      handle.classList.remove('active');
      host?.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', end);
      const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chat-panel-width'), 10);
      if (cur && !Number.isNaN(cur)) saveSettings({ chatPanelWidth: cur });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
  };

  const openApiSettings = () => openSettings('api-keys');

  if (!host) return null;

  return createPortal(
    <>
      <div className="chat-resize-handle" onMouseDown={startResize} />

      <div className="chat-header">
        <div className="chat-header-top">
          <h2 className="chat-title">AI Assistant</h2>
          <div className="chat-header-actions">
            <button className="chat-settings-btn" type="button" title="API Settings" onClick={openApiSettings}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button className="chat-close-btn" type="button" title="Close panel" onClick={() => setOpen(false)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        {chat.configured && (
          <ThreadSelector
            threads={chat.threads}
            currentThreadId={chat.currentThreadId}
            onSwitch={chat.switchThread}
            onNew={chat.newThread}
            onDelete={chat.deleteThread}
          />
        )}
      </div>

      <MessageList
        messages={chat.messages}
        thinking={chat.thinking}
        configured={chat.configured}
        onReviewChanges={chat.openDiffForMessage}
        onApply={chat.applyAction}
        onConfigure={openApiSettings}
      />

      {chat.configured && (
        <ChatComposer
          contextChips={chat.contextChips}
          onRemoveChip={chat.removeChip}
          onClearChips={chat.clearChips}
          onSend={chat.send}
          currentModel={chat.currentModel}
          configured={chat.configured}
          customModels={chat.customModels}
          onSelectModel={chat.selectModel}
          onApplyCustomSlug={chat.applyCustomSlug}
          onRemoveCustom={chat.removeCustomModelEntry}
          onConfigure={openApiSettings}
          reasoningEffort={chat.reasoningEffort}
          reasoningSupported={chat.reasoningSupported}
          onSetReasoning={chat.setReasoning}
          webSearchEnabled={chat.webSearchEnabled}
          onToggleWebSearch={chat.toggleWebSearch}
        />
      )}
    </>,
    host
  );
}
