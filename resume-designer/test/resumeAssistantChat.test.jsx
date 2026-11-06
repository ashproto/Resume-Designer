import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useChat } from '../src/components/chat/useChat.js';
import { store } from '../src/store.js';
import * as changeSession from '../src/changeSession.js';
import { revokeAIConsent, setAIConsentPresenter } from '../src/aiConsent.js';
import { __resetAppStorageForTests } from '../src/appStorage.js';
import { saveSettings } from '../src/persistence.js';

const RESUME = {
  name: 'Ada Example', summary: 'Engineer building useful software.',
  experience: [{ id: 'role-1', title: 'Engineer', company: 'Acme', bullets: ['Built useful software.'] }],
  sections: [], education: [],
  generationReview: {
    notes: 'Keep the product work prominent.',
    gaps: [{ requirement: 'Leadership', severity: 'medium', note: 'Ask about team mentoring.' }],
    jobs: [{ title: 'Staff Engineer', company: 'Example Co', description: 'Mentor engineers.' }],
  },
};

function completion(value) {
  const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(value) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

let requests;
let replies;
let respond;
beforeEach(async () => {
  __resetAppStorageForTests();
  localStorage.clear();
  changeSession.endSession();
  await revokeAIConsent();
  setAIConsentPresenter(async () => true);
  localStorage.setItem('resume-designer-data', JSON.stringify({
    settings: { openrouterKey: 'synthetic-test-key', chatReasoningEffort: 'none' },
  }));
  store.setData(structuredClone(RESUME), true);
  requests = [];
  replies = [];
  respond = null;
  vi.stubGlobal('fetch', async (_url, init) => {
    if (init?.method !== 'POST') return { ok: true, json: async () => ({ data: [] }) };
    requests.push(JSON.parse(init.body));
    if (respond) return respond(init);
    return completion(replies.shift() || { reply: 'What would you like to work on?', changes: {} });
  });
});

afterEach(() => {
  cleanup();
  changeSession.endSession();
  setAIConsentPresenter(null);
  vi.unstubAllGlobals();
  __resetAppStorageForTests();
  localStorage.clear();
});

async function mountChat() {
  let hook;
  await act(async () => { hook = renderHook(() => useChat()); });
  return hook.result;
}

async function send(chat, text) {
  await act(async () => { await chat.current.send(text); });
}

describe('sidebar resume assistant', () => {
  it('sends assistant requests with Opus 5.5 when no model is saved', async () => {
    const chat = await mountChat();
    await send(chat, 'What would help my summary?');
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe('anthropic/claude-opus-5.5');
    expect(chat.current.messages.at(-1).content).toBe('What would you like to work on?');
  });

  it('uses an explicitly saved model for assistant requests instead of replacing it with the factory default', async () => {
    saveSettings({ defaultModel: 'anthropic/claude-sonnet-4.6' });
    const chat = await mountChat();
    await send(chat, 'What would help my summary?');
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe('anthropic/claude-sonnet-4.6');
    expect(chat.current.currentModel).toBe('anthropic/claude-sonnet-4.6');
  });

  it('turns a short follow-up into a reviewable edit of the open resume', async () => {
    const chat = await mountChat();
    replies.push({ reply: 'I shortened the summary.', changes: { summary: 'Engineer building useful software.' } });
    await send(chat, 'shorter');
    // A real edit differs from the stored summary; the UI offers review without
    // changing the saved resume until the user accepts it.
    replies.push({ reply: 'Here is the shorter version.', changes: { summary: 'Software engineer.' } });
    await send(chat, 'even shorter');
    expect(chat.current.messages.at(-1).content).toContain('Here is the shorter version.');
    expect(chat.current.messages.at(-1).pendingChanges?.changes).toEqual([
      expect.objectContaining({ path: 'summary', oldValue: 'Engineer building useful software.', newValue: 'Software engineer.' }),
    ]);
    expect(changeSession.pendingPaths()).toEqual(['summary']);
    expect(store.getData().summary).toBe('Engineer building useful software.');
  });

  it('answers a question containing edit words in one request without creating a proposal', async () => {
    const chat = await mountChat();
    replies.push({ reply: 'Which role are you targeting?', changes: {} });
    await send(chat, 'How would you improve my summary?');
    expect(chat.current.messages.at(-1).content).toBe('Which role are you targeting?');
    expect(requests).toHaveLength(1);
    expect(changeSession.getChangeSet()).toBeNull();
  });

  it('keeps earlier conversation, selected context, and generation notes for edit follow-ups', async () => {
    const chat = await mountChat();
    act(() => chat.current.addChip({ label: 'Selected role', path: 'experience[0]', content: 'Mentored two interns.', type: 'experience' }));
    replies.push({ reply: 'We can emphasize mentoring.', changes: {} });
    await send(chat, 'I mentored two interns; remember that.');
    for (let i = 0; i < 6; i++) {
      replies.push({ reply: `Discussion ${i}`, changes: {} });
      await send(chat, `Tell me more ${i}`);
    }
    replies.push({ reply: 'Added the mentoring detail.', changes: { 'experience[0].bullets[0]': 'Built useful software and mentored two interns.' } });
    await send(chat, 'Update that bullet with the mentoring detail we discussed.');
    const outbound = requests.at(-1).messages.map((m) => m.content).join('\n');
    expect(outbound).toContain('I mentored two interns; remember that.');
    expect(outbound).toContain('We can emphasize mentoring.');
    expect(outbound).toContain('Selected role');
    expect(outbound).toContain('experience[0]');
    expect(outbound).toContain('Keep the product work prominent.');
    expect(outbound).toContain('Ask about team mentoring.');
    expect(outbound).toContain('Staff Engineer');
    expect(outbound).toContain('Mentor engineers.');
    expect(chat.current.messages.at(-1).pendingChanges?.changes).toHaveLength(1);
  });

  it('remembers the actual pending wording while using the latest saved resume on a follow-up', async () => {
    const chat = await mountChat();
    replies.push({ reply: 'Proposed a clearer summary.', changes: { summary: 'Product engineer mentoring teammates.' } });
    await send(chat, 'Rewrite my summary.');
    act(() => store.update('tagline', 'Staff Engineer'));
    replies.push({ reply: 'Made it more concise.', changes: { summary: 'Product engineer and mentor.' } });
    await send(chat, 'shorter, please');
    const outbound = requests.at(-1).messages.map((m) => m.content).join('\n');
    expect(outbound).toContain('Product engineer mentoring teammates.');
    expect(outbound).toContain('Staff Engineer');
    expect(chat.current.messages.at(-1).pendingChanges?.changes).toEqual([
      expect.objectContaining({ path: 'summary', newValue: 'Product engineer and mentor.' }),
    ]);
  });

  it('does not offer review when the model repeats an unchanged value', async () => {
    const chat = await mountChat();
    replies.push({ reply: 'The summary already matches your request.', changes: { summary: 'Engineer building useful software.' } });
    await send(chat, 'Update the summary.');
    expect(chat.current.messages.at(-1).pendingChanges).toBeUndefined();
    expect(changeSession.getChangeSet()).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it('removes an earlier preview when a revision returns to the saved wording', async () => {
    const chat = await mountChat();
    replies.push({ reply: 'Proposed a shorter summary.', changes: { summary: 'Software engineer.' } });
    await send(chat, 'Make the summary shorter.');
    expect(changeSession.pendingPaths()).toEqual(['summary']);
    replies.push({ reply: 'Kept your original summary.', changes: { summary: 'Engineer building useful software.' } });
    await send(chat, 'Actually, keep the original summary.');
    expect(chat.current.messages.at(-1).pendingChanges).toBeUndefined();
    expect(changeSession.getChangeSet()).toBeNull();
  });

  it('ignores even a complete edit response when the user stopped its request', async () => {
    const chat = await mountChat();
    let release;
    respond = () => new Promise((resolve) => { release = resolve; });
    let pending;
    await act(async () => { pending = chat.current.send('Make the summary concise.'); });
    expect(requests).toHaveLength(1);
    act(() => chat.current.stop());
    await act(async () => {
      release(completion({ reply: 'Shortened it.', changes: { summary: 'Software engineer.' } }));
      await pending;
    });
    expect(chat.current.messages.at(-1).content).toBe('_(stopped)_');
    expect(changeSession.getChangeSet()).toBeNull();
    expect(chat.current.loading).toBe(false);
    expect(store.getData().summary).toBe('Engineer building useful software.');
  });

  it('commits an answer to its original thread after switching threads', async () => {
    const chat = await mountChat();
    const origin = chat.current.currentThreadId;
    let release;
    respond = () => new Promise((resolve) => { release = resolve; });
    let pending;
    await act(async () => { pending = chat.current.send('What should I emphasize?'); });
    act(() => chat.current.newThread());
    const target = chat.current.currentThreadId;
    expect(target).not.toBe(origin);
    await act(async () => {
      release(completion({ reply: 'Emphasize mentoring.', changes: {} }));
      await pending;
    });
    expect(chat.current.messages).toEqual([]);
    expect(chat.current.threads.find((thread) => thread.id === origin).messages.at(-1).content).toBe('Emphasize mentoring.');
    expect(chat.current.currentThreadId).toBe(target);
  });

  it('refuses a stale proposal when the saved resume changes during the request', async () => {
    const chat = await mountChat();
    let release;
    respond = () => new Promise((resolve) => { release = resolve; });
    let pending;
    await act(async () => { pending = chat.current.send('Make the summary concise.'); });
    act(() => store.update('summary', 'My own newer wording.'));
    await act(async () => {
      release(completion({ reply: 'Shortened it.', changes: { summary: 'Software engineer.' } }));
      await pending;
    });
    expect(chat.current.messages.at(-1).content).toContain('This resume changed while I was working.');
    expect(chat.current.messages.at(-1).pendingChanges).toBeUndefined();
    expect(changeSession.getChangeSet()).toBeNull();
    expect(store.getData().summary).toBe('My own newer wording.');
  });

  it('shows a useful error without exposing JSON or proposals for a malformed response', async () => {
    const chat = await mountChat();
    replies.push({ reply: { text: 'Bad response' }, changes: { summary: 'Do not apply.' } });
    await send(chat, 'Please make the summary concise.');
    expect(chat.current.messages.at(-1)).toMatchObject({ role: 'error', content: 'The assistant returned an invalid response. Please try again.' });
    expect(changeSession.getChangeSet()).toBeNull();
    expect(chat.current.loading).toBe(false);
  });
});
