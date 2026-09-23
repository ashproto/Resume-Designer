import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../src/store.js';
import { applyRecommendationToStore } from '../src/jobRecommendations.js';
import { exportAsMarkdown, saveApiKey } from '../src/persistence.js';
import { chat } from '../src/aiService.js';
import { revokeAIConsent, setAIConsentPresenter } from '../src/aiConsent.js';
import { commitActiveInlineEdit, extractEditedValue, initInlineEditor } from '../src/inlineEditor.js';

const prose = 'Led the platform team.\nMentored new engineers.';
const section = (title = 'About') => ({
  id: 'legacy', title, area: 'sidebar', content: prose, customMetadata: { source: 'old export' },
});
const resume = (sections = [section()]) => ({
  name: 'Alex', tagline: 'Engineer', contact: {}, sections, experience: [], education: [],
});

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '';
  await revokeAIConsent();
  setAIConsentPresenter(null);
  store.setData(resume(), true);
});

afterEach(() => {
  store.saveNow();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('exports string section prose and existing array items without changing the document', async () => {
  const data = resume([
    section(), { ...section('Biography'), type: 'text' },
    { id: 'array', title: 'Skills', type: 'list', content: ['JavaScript', 'Swift'] },
  ]);
  const before = JSON.stringify(data);
  let exported;
  vi.stubGlobal('URL', {
    createObjectURL: (blob) => { exported = blob; return 'blob:test'; },
    revokeObjectURL: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  exportAsMarkdown(data, 'resume.md');
  const markdown = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(exported);
  });
  expect(markdown).toContain(`## About\n\n${prose}\n`);
  expect(markdown).toContain(`## Biography\n\n${prose}\n`);
  expect(markdown).toContain('## Skills\n\n- JavaScript\n- Swift\n');
  expect(JSON.stringify(data)).toBe(before);
});

it('includes string section prose in the AI request context without normalizing saved data', async () => {
  store.setData(resume([section(), { title: 'Skills', content: ['JavaScript', 'Swift'] }]), true);
  const before = JSON.stringify(store.getData());
  await saveApiKey('test-key');
  setAIConsentPresenter(async () => true);
  let body;
  vi.stubGlobal('fetch', async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: false, status: 500, json: async () => ({}) };
  });
  await expect(chat('anthropic/claude-sonnet-4.6', [{ role: 'user', content: 'Review this resume' }]))
    .rejects.toThrow('500');
  const context = body.messages.find((message) => message.role === 'user').content;
  expect(context).toContain(`About:\n${prose}\n`);
  expect(context).toContain('Skills:\nJavaScript\nSwift\n');
  expect(JSON.stringify(store.getData())).toBe(before);
});

describe('recommendations for string-backed sections', () => {
  it.each(['About', 'Core Skills'])('replaces %s prose as one scalar and preserves metadata', (title) => {
    const original = section(title);
    store.setData(resume([original]), true);
    expect(applyRecommendationToStore(title.toLowerCase(), prose, 'Revised prose.')).toBe(true);
    expect(store.get('sections[0]')).toEqual({ ...original, content: 'Revised prose.' });
  });

  it.each(['About', 'Core Skills'])('adds to %s without splitting the original prose into characters', (title) => {
    const original = section(title);
    store.setData(resume([original]), true);
    expect(applyRecommendationToStore(title.toLowerCase(), 'N/A', 'New item')).toBe(true);
    expect(store.get('sections[0]')).toEqual({ ...original, content: [prose, 'New item'] });
  });

  it('finds a scalar section body when the recommendation uses a different section name', () => {
    expect(applyRecommendationToStore('other', prose, 'Revised prose.')).toBe(true);
    expect(store.get('sections[0]')).toEqual({ ...section(), content: 'Revised prose.' });
  });

  it('still replaces and appends individual array items', () => {
    store.setData(resume([{ ...section(), content: ['First', 'Second'] }]), true);
    expect(applyRecommendationToStore('about', 'Second', 'Updated')).toBe(true);
    expect(applyRecommendationToStore('about', 'N/A', 'Third')).toBe(true);
    expect(store.get('sections[0].content')).toEqual(['First', 'Updated', 'Third']);
  });
});

it('keeps line breaks and emphasis when committing scalar section prose from a contenteditable', () => {
  const element = document.createElement('div');
  element.innerHTML = 'First <b>line</b><div>Second<br>continued</div><div>Third</div>';
  expect(extractEditedValue(element, 'sections[0].content'))
    .toBe('First **line**\nSecond\ncontinued\nThird');
});

it('adds the complete string-backed section to chat context through the inline menu', () => {
  document.body.innerHTML = '<div id="resume"><p data-editable="sections[0].content"></p></div>';
  const editable = document.querySelector('[data-editable]');
  editable.textContent = prose;
  let added;
  const receive = (event) => { added = event.detail; };
  window.addEventListener('rd:chat-add-chip', receive);
  try {
    initInlineEditor();
    editable.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    document.querySelector('.editable-ai-btn').click();
    const addSection = [...document.querySelectorAll('.editable-ai-menu-item')]
      .find((button) => button.textContent.includes('Add entire About'));
    expect(addSection).toBeDefined();
    addSection.click();
    expect(added).toEqual({ type: 'section', path: 'sections[0]', content: `About:\n${prose}`, label: 'About' });
    expect(store.get('sections[0]')).toEqual(section());

    // jsdom exposes contentEditable but does not derive isContentEditable.
    Object.defineProperty(editable, 'isContentEditable', { get: () => editable.contentEditable === 'true' });
    editable.click();
    expect(editable.textContent).toBe(prose);
    editable.innerHTML = 'Updated <b>first</b><div>Updated second.</div>';
    commitActiveInlineEdit();
    expect(store.get('sections[0]')).toEqual({ ...section(), content: 'Updated **first**\nUpdated second.' });
  } finally {
    window.removeEventListener('rd:chat-add-chip', receive);
  }
});
