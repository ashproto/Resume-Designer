import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { buildMappingMessages, requestMapping } from '../src/mapping.js';
import { scanForm } from '../src/content/scan.js';
import { fillForm } from '../src/content/fill.js';
import { buildFillPayload, buildReviewItems } from '../src/sidepanel/reviewModel.js';
import ReviewList from '../src/sidepanel/ReviewList.jsx';
import { isSensitiveQuestion } from '../src/sensitivity.js';

const workEligibilityQuestions = [
  'Are you legally authorized to work in the United States?',
  'Are you authorised to work in the UK?',
  'Are you eligible to work in Canada?',
  'Do you have the legal right to work in this country?',
  'Will you now or in the future require sponsorship?',
  'Will you need employer sponsorship for employment?',
  'Will you require us to sponsor you in the future?',
  'Do you require a work permit?',
  'Do you hold a valid working visa?',
  'What is your visa status?',
  'Can you work in the United States without sponsorship?',
  'Do you have authorization to work in the United States?',
  'Work eligibility',
  'Are you a permanent resident?',
];

const sensitiveLabels = [
  ...workEligibilityQuestions,
  'Race / ethnicity', 'Gender identity', 'Preferred pronouns', 'Disability status',
  'Protected veteran status', 'Date of birth', 'DOB', 'Nationality', 'Citizenship',
  'What is your desired annual pay?', 'Desired hourly rate', 'Expected wages',
  'Religion', 'Desired salary', 'Expected compensation', 'EEO survey',
  'Sexual orientation', 'I consent to the processing of my data',
];

function descriptor(label, extra = {}) {
  return { field_id: label, label, type: 'text', options: [], ...extra };
}

describe('sensitive questions stay on the application page', () => {
  it.each(sensitiveLabels)('never sends %s or its options to AI', async (label) => {
    const sensitive = descriptor(label, { type: 'select', options: [{ value: 'private-value', label: 'Private answer' }] });
    const complete = vi.fn().mockResolvedValue({ text: JSON.stringify({ fields: [{ field_id: 'Full name', value: 'Jane', confidence: 1, source: 'resume' }], needs_human: [] }) });
    const result = await requestMapping({ descriptors: [sensitive, descriptor('Full name')], complete });
    expect(complete).toHaveBeenCalledTimes(1);
    const sent = complete.mock.calls[0][0].messages[0].content;
    expect(sent).not.toContain(label);
    expect(sent).not.toContain('private-value');
    expect(result.fields).toHaveLength(1);
    expect(result.needs_human).toEqual([{ field_id: label, question: expect.stringMatching(/application page/i) }]);
  });

  it('does not call AI for a form containing only sensitive questions', async () => {
    const complete = vi.fn();
    await requestMapping({ descriptors: sensitiveLabels.map((label) => descriptor(label)), complete });
    expect(complete).not.toHaveBeenCalled();
  });

  it('also filters direct message construction and historical sensitive saved answers', () => {
    const [message] = buildMappingMessages({ descriptors: [descriptor('Gender'), descriptor('Full name')], resume: { learnedAnswers: [{ question: 'Gender', answer: 'private-answer' }, { question: 'Notice period', answer: 'Two weeks' }] } });
    const context = JSON.parse(message.content);
    expect(context.descriptors.map(({ label }) => label)).toEqual(['Full name']);
    expect(context.resume.learnedAnswers).toEqual([{ question: 'Notice period', answer: 'Two weeks' }]);
  });

  it('recognizes unlabelled demographic option sets and honours explicit sensitivity', async () => {
    const fields = [descriptor('Question 1', { type: 'select', options: [{ value: 'a', label: 'Male' }, { value: 'b', label: 'Female' }] }), descriptor('Question 2', { sensitive: true })];
    const complete = vi.fn();
    const result = await requestMapping({ descriptors: fields, complete });
    expect(complete).not.toHaveBeenCalled();
    expect(result.needs_human).toHaveLength(2);
  });

  it('removes malicious mappings and renders no editable control or save action', () => {
    const fields = [descriptor('Gender identity', { type: 'select', options: [{ value: 'private-value', label: 'Private answer' }] })];
    const items = buildReviewItems(fields, { fields: [{ field_id: 'Gender identity', value: 'private-value', confidence: 1, source: 'learned' }] });
    expect(items[0]).toMatchObject({ manualSensitive: true, value: '', options: [], needsHuman: true, source: null });
    const markup = renderToStaticMarkup(createElement(ReviewList, { items, savedAnswers: new Map(), savingAnswers: new Set() }));
    expect(markup).not.toMatch(/<input|<select|<button|private-value/);
    expect(markup).toContain('application page');
    expect(buildFillPayload([{ ...items[0], manualSensitive: false, value: 'private-value' }]).fields).toEqual([]);
  });

  it('refuses crafted fill payloads using live labels without changing sensitive controls', () => {
    const document = new JSDOM('<form><label>Full name<input></label><fieldset><legend>Disability status</legend><label>Yes<input type="radio" name="disability" value="yes"></label><label>No<input type="radio" name="disability" value="no"></label></fieldset><label>Desired salary<input value="120000"></label></form>').window.document;
    const descriptors = scanForm(document);
    expect(descriptors.map(({ sensitive }) => Boolean(sensitive))).toEqual([false, true, true]);
    const result = fillForm(descriptors.map(({ field_id }) => ({ field_id, value: field_id === descriptors[0].field_id ? 'Jane' : 'yes' })), { root: document });
    expect(result.filled).toEqual([descriptors[0].field_id]);
    expect(result.unfilled).toHaveLength(2);
    expect(document.querySelector('input[name="disability"]').checked).toBe(false);
    expect(document.querySelector('input[value="120000"]').value).toBe('120000');
  });

  it('blocks demographic radio options even when the group label is generic', () => {
    const document = new JSDOM('<form><fieldset><legend>Question 1</legend><label>Male<input type="radio" name="q1" value="a"></label><label>Female<input type="radio" name="q1" value="b"></label></fieldset></form>').window.document;
    const [field] = scanForm(document);
    expect(field.sensitive).toBe(true);
    expect(fillForm([{ field_id: field.field_id, value: 'a' }], { root: document }).filled).toEqual([]);
    expect(document.querySelector('input').checked).toBe(false);
  });

  it.each(workEligibilityQuestions)('keeps %s manual in review, scanning, filling, and saved-answer filtering', (label) => {
    expect(isSensitiveQuestion(label)).toBe(true);
    const document = new JSDOM('<form><label><input></label></form>').window.document;
    document.querySelector('label').prepend(document.createTextNode(label));
    const [field] = scanForm(document);
    expect(field.sensitive).toBe(true);
    const items = buildReviewItems([field], { fields: [{ field_id: field.field_id, value: 'Yes', confidence: 1, source: 'learned' }] });
    expect(items[0]).toMatchObject({ manualSensitive: true, value: '', needsHuman: true });
    expect(buildFillPayload(items).fields).toEqual([]);
    expect(fillForm([{ field_id: field.field_id, value: 'Yes' }], { root: document }).filled).toEqual([]);
    expect(document.querySelector('input').value).toBe('');
    const [message] = buildMappingMessages({ resume: { learnedAnswers: [{ question: label, answer: 'Yes' }] } });
    expect(JSON.parse(message.content).resume.learnedAnswers).toEqual([]);
  });

  it.each([
    'When are you available to start?',
    'Are you available to work weekends?',
    'Are you able to work a flexible schedule?',
    'What notice period do you require before starting?',
    'Describe your sponsorship marketing experience',
  ])('keeps the ordinary work question %s eligible for review', (label) => {
    expect(isSensitiveQuestion(label)).toBe(false);
    expect(buildReviewItems([descriptor(label)], {})[0].manualSensitive).toBe(false);
  });

  it('allows ordinary work fields including Veteran Engineer and years of experience', async () => {
    const fields = [descriptor('Veteran Engineer'), descriptor('Years of experience'), descriptor('Full name')];
    const complete = vi.fn().mockResolvedValue({ text: JSON.stringify({ fields: [], needs_human: fields.map(({ field_id }) => ({ field_id, question: 'Please answer' })) }) });
    await requestMapping({ descriptors: fields, complete });
    expect(JSON.parse(complete.mock.calls[0][0].messages[0].content).descriptors).toHaveLength(3);
  });
});


it.each(['Terms', 'Accept terms', 'Terms of service', 'I have read the privacy notice', 'Subscribe to our newsletter', 'Send me updates'])('keeps the consent question %s manual', (question) => {
  expect(isSensitiveQuestion(question)).toBe(true);
});
