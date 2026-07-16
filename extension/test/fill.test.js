import { readFileSync } from 'node:fs';

import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import { fillForm } from '../src/content/fill.js';
import { scanForm } from '../src/content/scan.js';

const fixtureUrls = {
  greenhouse: 'https://job-boards.greenhouse.io/example/jobs/job-token',
  lever: 'https://jobs.lever.co/example/job-token/apply',
  ashby: 'https://jobs.ashbyhq.com/example/job-token/application',
};

function loadFixture(name) {
  const html = readFileSync(new URL(`./fixtures/${name}-form.html`, import.meta.url), 'utf8');
  return new JSDOM(html, { url: fixtureUrls[name] }).window.document;
}

function fieldByLabel(document, label) {
  return scanForm(document).find((field) => field.label === label);
}

function eventLog(root) {
  const events = [];

  for (const type of ['input', 'change']) {
    root.addEventListener(type, (event) => {
      events.push({ type: event.type, target: event.target });
    });
  }

  return events;
}

function fakeDataTransferFactory() {
  return {
    items: {
      add(file) {
        this.files.push(file);
      },
      files: [],
    },
    get files() {
      return this.items.files;
    },
  };
}

function makeFilesAssignable(input) {
  let files = [];

  Object.defineProperty(input, 'files', {
    configurable: true,
    get: () => files,
    set: (value) => {
      files = value;
    },
  });
}

describe('fillForm', () => {
  it('uses native value setters and bubbling input/change events for text and textarea fields', () => {
    const document = new JSDOM(`
      <form>
        <label>Name <input type="text"></label>
        <label>Summary <textarea></textarea></label>
      </form>
    `).window.document;
    const [nameField, summaryField] = scanForm(document);
    const input = document.querySelector('input');
    const textarea = document.querySelector('textarea');
    const inputValue = Object.getOwnPropertyDescriptor(
      document.defaultView.HTMLInputElement.prototype,
      'value',
    );
    const textareaValue = Object.getOwnPropertyDescriptor(
      document.defaultView.HTMLTextAreaElement.prototype,
      'value',
    );
    const inputWrapper = vi.fn();
    const textareaWrapper = vi.fn();
    const events = eventLog(document.querySelector('form'));

    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => inputValue.get.call(input),
      set: inputWrapper,
    });
    Object.defineProperty(textarea, 'value', {
      configurable: true,
      get: () => textareaValue.get.call(textarea),
      set: textareaWrapper,
    });

    const result = fillForm([
      { field_id: nameField.field_id, value: 'Ada Lovelace' },
      { field_id: summaryField.field_id, value: 'Builds reliable systems' },
    ], { root: document });

    expect(result).toEqual({
      filled: [nameField.field_id, summaryField.field_id],
      unfilled: [],
    });
    expect(inputWrapper).not.toHaveBeenCalled();
    expect(textareaWrapper).not.toHaveBeenCalled();
    expect(inputValue.get.call(input)).toBe('Ada Lovelace');
    expect(textareaValue.get.call(textarea)).toBe('Builds reliable systems');
    expect(events.map(({ type }) => type)).toEqual(['input', 'change', 'input', 'change']);
    expect(events.every(({ target }) => target === input || target === textarea)).toBe(true);
  });

  it('reports browser-sanitized number and date values as unfilled without erasing prior values', () => {
    const document = new JSDOM(`
      <form>
        <label>Salary <input type="number" value="120000"></label>
        <label>Start date <input type="date" value="2026-08-01"></label>
      </form>
    `).window.document;
    const [salaryField, dateField] = scanForm(document);
    const [salary, date] = document.querySelectorAll('input');
    const events = eventLog(document.querySelector('form'));

    const result = fillForm([
      { field_id: salaryField.field_id, value: 'USD 150k' },
      { field_id: dateField.field_id, value: 'next Monday' },
    ], { root: document });

    expect(result.filled).toEqual([]);
    expect(result.unfilled).toEqual([
      {
        field_id: salaryField.field_id,
        reason: expect.stringMatching(/browser rejected.*complete.*manually/i),
      },
      {
        field_id: dateField.field_id,
        reason: expect.stringMatching(/browser rejected.*complete.*manually/i),
      },
    ]);
    expect(salary.value).toBe('120000');
    expect(date.value).toBe('2026-08-01');
    expect(events).toEqual([]);
  });

  it('matches selects by exact value before a case-insensitive visible label', () => {
    const document = new JSDOM(`
      <form>
        <label for="first">First choice</label>
        <select id="first">
          <option value="target">Value match</option>
          <option value="other">target</option>
        </select>
        <label for="second">Second choice</label>
        <select id="second">
          <option value="engineering">Engineering</option>
          <option value="design">Product Design</option>
        </select>
      </form>
    `).window.document;
    const [firstField, secondField] = scanForm(document);
    const [first, second] = document.querySelectorAll('select');
    const events = eventLog(document.querySelector('form'));

    const result = fillForm([
      { field_id: firstField.field_id, value: 'target' },
      { field_id: secondField.field_id, value: 'product design' },
    ], { root: document });

    expect(result.unfilled).toEqual([]);
    expect(first.value).toBe('target');
    expect(second.value).toBe('design');
    expect(events.map(({ type }) => type)).toEqual(['input', 'change', 'input', 'change']);
  });

  it('matches radios by exact value and then by case-insensitive visible label', () => {
    const document = loadFixture('lever');
    const radioField = scanForm(document).find(({ type }) => type === 'radio');
    const radios = [...document.querySelectorAll('input[type="radio"]')];
    const checked = Object.getOwnPropertyDescriptor(
      document.defaultView.HTMLInputElement.prototype,
      'checked',
    );
    const wrapper = vi.fn();
    const events = eventLog(document.querySelector('form'));

    Object.defineProperty(radios[0], 'checked', {
      configurable: true,
      get: () => checked.get.call(radios[0]),
      set: wrapper,
    });

    expect(fillForm([
      { field_id: radioField.field_id, value: 'hybrid' },
    ], { root: document })).toEqual({ filled: [radioField.field_id], unfilled: [] });
    expect(checked.get.call(radios[1])).toBe(true);

    expect(fillForm([
      { field_id: radioField.field_id, value: 'REMOTE' },
    ], { root: document })).toEqual({ filled: [radioField.field_id], unfilled: [] });
    expect(wrapper).not.toHaveBeenCalled();
    expect(checked.get.call(radios[0])).toBe(true);
    expect(checked.get.call(radios[1])).toBe(false);
    expect(events.map(({ type }) => type)).toEqual(['input', 'change', 'input', 'change']);
  });

  it('fills checkboxes only from case-insensitive true or false strings', () => {
    const document = loadFixture('lever');
    const checkboxField = scanForm(document).find(({ type }) => type === 'checkbox');
    const checkbox = document.querySelector('input[type="checkbox"]');
    const checked = Object.getOwnPropertyDescriptor(
      document.defaultView.HTMLInputElement.prototype,
      'checked',
    );
    const wrapper = vi.fn();
    const events = eventLog(document.querySelector('form'));

    Object.defineProperty(checkbox, 'checked', {
      configurable: true,
      get: () => checked.get.call(checkbox),
      set: wrapper,
    });

    expect(fillForm([
      { field_id: checkboxField.field_id, value: 'TRUE' },
    ], { root: document }).unfilled).toEqual([]);
    expect(checked.get.call(checkbox)).toBe(true);

    expect(fillForm([
      { field_id: checkboxField.field_id, value: 'false' },
    ], { root: document }).unfilled).toEqual([]);
    expect(checked.get.call(checkbox)).toBe(false);
    expect(wrapper).not.toHaveBeenCalled();
    expect(events.map(({ type }) => type)).toEqual(['input', 'change', 'input', 'change']);

    for (const value of [true, false, 1, 'yes', ' true ']) {
      const invalid = fillForm([
        { field_id: checkboxField.field_id, value },
      ], { root: document });

      expect(invalid.filled).toEqual([]);
      expect(invalid.unfilled).toEqual([
        { field_id: checkboxField.field_id, reason: expect.stringMatching(/true.*false/i) },
      ]);
    }

    expect(events).toHaveLength(4);
  });

  it('decodes a PDF into a realm-correct File and attaches it through DataTransfer', () => {
    const document = loadFixture('greenhouse');
    const fileField = fieldByLabel(document, 'Resume/CV');
    const input = document.querySelector('#resume');
    const events = eventLog(document.querySelector('form'));

    makeFilesAssignable(input);

    const result = fillForm([
      { field_id: fileField.field_id, value: 'ignored-for-file-fields' },
    ], {
      root: document,
      pdf: {
        filename: 'Ada-Lovelace-Resume.pdf',
        pdfBase64: Buffer.from('%PDF-1.7 test bytes').toString('base64'),
      },
      dataTransferFactory: fakeDataTransferFactory,
    });

    expect(result).toEqual({ filled: [fileField.field_id], unfilled: [] });
    expect(input.files).toHaveLength(1);
    expect(input.files[0]).toBeInstanceOf(document.defaultView.File);
    expect(input.files[0]).toMatchObject({
      name: 'Ada-Lovelace-Resume.pdf',
      type: 'application/pdf',
      size: 19,
    });
    expect(events.map(({ type }) => type)).toEqual(['input', 'change']);
  });

  it('reports missing markers, unsupported controls, unmatched choices, and missing PDFs', () => {
    const greenhouse = loadFixture('greenhouse');
    const greenhouseFields = scanForm(greenhouse);
    const custom = greenhouseFields.find(({ type }) => type === 'custom');
    const select = greenhouseFields.find(({ type }) => type === 'select');
    const file = greenhouseFields.find(({ type }) => type === 'file');

    const result = fillForm([
      { field_id: 'missing-field', value: 'anything' },
      { field_id: custom.field_id, value: 'Canada' },
      { field_id: select.field_id, value: 'Atlantis' },
      { field_id: file.field_id, value: '' },
    ], { root: greenhouse });

    expect(result.filled).toEqual([]);
    expect(result.unfilled).toEqual([
      { field_id: 'missing-field', reason: expect.stringMatching(/not found|missing/i) },
      { field_id: custom.field_id, reason: expect.stringMatching(/custom|unsupported/i) },
      { field_id: select.field_id, reason: expect.stringMatching(/match/i) },
      { field_id: file.field_id, reason: expect.stringMatching(/pdf/i) },
    ]);

    const lever = loadFixture('lever');
    const radio = scanForm(lever).find(({ type }) => type === 'radio');
    const radioResult = fillForm([
      { field_id: radio.field_id, value: 'onsite' },
    ], { root: lever });

    expect(radioResult.unfilled).toEqual([
      { field_id: radio.field_id, reason: expect.stringMatching(/match/i) },
    ]);
  });

  it('leaves Ashby backing checkboxes for sibling Yes/No buttons unfilled', () => {
    const document = loadFixture('ashby');
    const travel = fieldByLabel(document, 'Are you willing to travel?');
    const checkbox = document.querySelector('input[type="checkbox"]');

    const result = fillForm([
      { field_id: travel.field_id, value: 'true' },
    ], { root: document });

    expect(result.filled).toEqual([]);
    expect(result.unfilled).toEqual([
      { field_id: travel.field_id, reason: expect.stringMatching(/custom|manual/i) },
    ]);
    expect(checkbox.checked).toBe(false);
  });

  it('continues filling later fields after a field-level failure', () => {
    const document = loadFixture('greenhouse');
    const fileField = fieldByLabel(document, 'Resume/CV');
    const nameField = fieldByLabel(document, 'First Name');
    const input = document.querySelector('#first_name');

    makeFilesAssignable(document.querySelector('#resume'));

    const result = fillForm([
      { field_id: fileField.field_id, value: '' },
      { field_id: nameField.field_id, value: 'Grace Hopper' },
    ], {
      root: document,
      pdf: { filename: 'resume.pdf', pdfBase64: 'JVBERg==' },
      dataTransferFactory: () => {
        throw new Error('DataTransfer unavailable');
      },
    });

    expect(result).toEqual({
      filled: [nameField.field_id],
      unfilled: [
        { field_id: fileField.field_id, reason: expect.stringMatching(/DataTransfer unavailable/) },
      ],
    });
    expect(input.value).toBe('Grace Hopper');
  });

  it('never fetches, submits, requests submission, clicks submit controls, or dispatches submit', () => {
    const document = loadFixture('greenhouse');
    const nameField = fieldByLabel(document, 'First Name');
    const form = document.querySelector('form');
    const submitControl = document.querySelector('button[type="submit"]');
    const fetchSpy = vi.fn();
    const submitSpy = vi.fn();
    const requestSubmitSpy = vi.fn();
    const clickSpy = vi.spyOn(submitControl, 'click');
    const submitEventSpy = vi.fn();
    const previousFetch = globalThis.fetch;

    globalThis.fetch = fetchSpy;
    form.submit = submitSpy;
    form.requestSubmit = requestSubmitSpy;
    form.addEventListener('submit', submitEventSpy);

    try {
      const result = fillForm([
        { field_id: nameField.field_id, value: 'Katherine Johnson' },
      ], { root: document });

      expect(result.unfilled).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(submitSpy).not.toHaveBeenCalled();
      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(clickSpy).not.toHaveBeenCalled();
      expect(submitEventSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
