/* @vitest-environment jsdom */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../src/sidepanel/App.jsx';
import {
  RuntimeMessageError,
  createRuntimeClient,
} from '../src/sidepanel/runtimeClient.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function descriptor(fieldId, overrides = {}) {
  return {
    field_id: fieldId,
    label: fieldId,
    type: 'text',
    options: [],
    required: false,
    ...overrides,
  };
}

function mapped(fieldId, value, confidence = 0.9, source = 'resume') {
  return { field_id: fieldId, value, confidence, source };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeClient(overrides = {}) {
  return {
    checkConnection: vi.fn(async () => ({
      connected: true,
      health: { ok: true },
      resumes: [{ id: 'resume-1', name: 'Backend résumé' }],
    })),
    savePairing: vi.fn(async () => ({
      connected: true,
      health: { ok: true },
      resumes: [{ id: 'resume-1', name: 'Backend résumé' }],
    })),
    listResumes: vi.fn(),
    scanPage: vi.fn(async () => ({ descriptors: [], page: {} })),
    createMapping: vi.fn(async () => ({ fields: [], needs_human: [] })),
    fillPage: vi.fn(async () => ({ filled: [], unfilled: [] })),
    saveAnswer: vi.fn(async () => ({ answer: { id: 'answer-1' } })),
    logApplication: vi.fn(async () => ({ application: { id: 'application-1' } })),
    ...overrides,
  };
}

let container;
let root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(assertion) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await settle();
    }
  }
  throw lastError;
}

async function renderApp(client) {
  await act(async () => {
    root.render(<App client={client} />);
  });
  await waitFor(() => expect(client.checkConnection).toHaveBeenCalledOnce());
  await settle();
}

function button(name) {
  const result = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent.trim() === name);
  if (!result) throw new Error(`Button not found: ${name}`);
  return result;
}

function labelled(label) {
  const labels = [...container.querySelectorAll('label')];
  const matching = labels.find((candidate) => candidate.textContent.includes(label));
  const control = matching?.htmlFor ? document.getElementById(matching.htmlFor) : null;
  if (control) return control;

  const ariaControl = [...container.querySelectorAll('input, select, textarea')]
    .find((candidate) => candidate.getAttribute('aria-label') === label);
  if (!ariaControl) throw new Error(`Control not found: ${label}`);
  return ariaControl;
}

async function click(control) {
  await act(async () => {
    control.click();
  });
  await settle();
}

async function change(control, value) {
  await act(async () => {
    const prototype = control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, value);
    control.dispatchEvent(new Event(
      control instanceof HTMLSelectElement ? 'change' : 'input',
      { bubbles: true },
    ));
  });
  await settle();
}

async function scanAndCreate(client) {
  await click(button('Scan page'));
  expect(client.scanPage).toHaveBeenCalledOnce();
  expect(client.createMapping).not.toHaveBeenCalled();
  await click(button('Create review'));
  await waitFor(() => expect(client.createMapping).toHaveBeenCalledOnce());
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('runtimeClient', () => {
  it('sends the exact top-level Task 5 message envelopes', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, data: { accepted: true } }));
    const client = createRuntimeClient(sendMessage);
    const descriptors = [{ field_id: 'name' }];
    const fields = [{ field_id: 'name', value: 'Jane' }];

    await client.checkConnection();
    await client.savePairing('token');
    await client.listResumes();
    await client.scanPage();
    await client.createMapping('resume-1', descriptors);
    await client.fillPage('resume-1', fields);
    await client.saveAnswer('Question?', 'Answer');
    await client.logApplication({
      variantId: 'resume-1', company: 'Acme', title: 'Engineer', notes: 'Optional',
    });

    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: 'connection.check' },
      { type: 'pairing.save', token: 'token' },
      { type: 'resumes.list' },
      { type: 'page.scan' },
      { type: 'mapping.create', resumeId: 'resume-1', descriptors },
      { type: 'page.fill', resumeId: 'resume-1', fields },
      { type: 'answer.save', question: 'Question?', answer: 'Answer' },
      {
        type: 'application.log',
        variantId: 'resume-1',
        company: 'Acme',
        title: 'Engineer',
        notes: 'Optional',
      },
    ]);
  });

  it('preserves stable background errors and rejects malformed responses', async () => {
    const stableError = {
      message: 'Page access was lost',
      status: null,
      code: 'active_tab_grant_lost',
      retryable: true,
    };
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: stableError })
      .mockResolvedValueOnce({ data: {} });
    const client = createRuntimeClient(sendMessage);

    await expect(client.scanPage()).rejects.toMatchObject(stableError);
    await expect(client.checkConnection()).rejects.toMatchObject({
      code: 'invalid_runtime_response',
      retryable: true,
    });
  });
});

describe('App explicit workflow', () => {
  it('automatically checks only connection and requires separate scan and mapping clicks', async () => {
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const client = makeClient({
      scanPage: vi.fn(async () => ({
        descriptors,
        page: { company: 'Acme', title: 'Engineer' },
      })),
      createMapping: vi.fn(async () => ({
        fields: [mapped('name', 'Jane')],
        needs_human: [],
      })),
    });

    await renderApp(client);

    expect(container.textContent).toContain('Connected');
    expect(client.scanPage).not.toHaveBeenCalled();
    expect(client.createMapping).not.toHaveBeenCalled();
    expect(client.fillPage).not.toHaveBeenCalled();
    expect(client.saveAnswer).not.toHaveBeenCalled();
    expect(client.logApplication).not.toHaveBeenCalled();

    await click(button('Scan page'));
    expect(client.scanPage).toHaveBeenCalledOnce();
    expect(client.createMapping).not.toHaveBeenCalled();

    await click(button('Create review'));
    expect(client.createMapping).toHaveBeenCalledWith('resume-1', descriptors);
    expect(labelled('Full name').value).toBe('Jane');
  });

  it('pairs only on click and keeps the running-app sentence plain and unlinked', async () => {
    const client = makeClient({
      checkConnection: vi.fn(async () => ({ connected: false, health: { ok: true }, resumes: [] })),
    });
    await renderApp(client);

    const runningCopy = [...container.querySelectorAll('p')]
      .find((paragraph) => paragraph.textContent.trim() === 'Resume Designer must be running.');
    expect(runningCopy).toBeTruthy();
    expect(runningCopy.closest('a')).toBeNull();
    expect(client.savePairing).not.toHaveBeenCalled();

    await change(labelled('Pairing token'), '  pasted-token  ');
    expect(client.savePairing).not.toHaveBeenCalled();
    await click(button('Pair extension'));

    expect(client.savePairing).toHaveBeenCalledWith('  pasted-token  ');
    await waitFor(() => expect(container.textContent).toContain('Connected'));
  });

  it('renders editable review items, saves answers explicitly, skips manual items, and shows fill warnings', async () => {
    const descriptors = [
      descriptor('name', { label: 'Full name' }),
      descriptor('work-auth', { label: 'Work authorization?' }),
      descriptor('salary', { label: 'Salary expectation?' }),
      descriptor('resume-file', { label: 'Upload résumé', type: 'file' }),
      descriptor('cover-file', { label: 'Cover letter', type: 'file' }),
      descriptor('consent', { label: 'Consent', type: 'checkbox' }),
    ];
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: { company: 'Acme', title: 'Engineer' } })),
      createMapping: vi.fn(async () => ({
        fields: [
          mapped('name', 'Jane', 0.5),
          mapped('resume-file', '__resume_pdf__', 1),
          mapped('consent', 'false', 1, 'learned'),
        ],
        needs_human: [
          { field_id: 'work-auth', question: 'Are you authorized to work here?' },
          { field_id: 'salary', question: 'What salary do you expect?' },
          { field_id: 'cover-file', question: 'Attach cover letter manually.' },
        ],
      })),
      fillPage: vi.fn(async () => ({
        filled: ['name', 'work-auth', 'resume-file'],
        unfilled: [{ field_id: 'consent', reason: 'Custom control must be filled manually' }],
      })),
    });
    await renderApp(client);
    await scanAndCreate(client);

    expect(container.textContent).toContain('Low confidence');
    expect(container.textContent).toContain('Selected résumé PDF');
    expect(container.textContent).toContain('Attach cover letter manually.');

    await change(labelled('Work authorization?'), 'No sponsorship required');
    expect(client.saveAnswer).not.toHaveBeenCalled();
    labelled('Work authorization?').dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await settle();
    expect(client.saveAnswer).not.toHaveBeenCalled();

    const saveButton = container.querySelector('[aria-label="Save answer for Work authorization?"]');
    expect(saveButton).toBeTruthy();
    expect(container.querySelector('[aria-label="Save answer for Cover letter"]')).toBeNull();
    await click(saveButton);
    expect(client.saveAnswer).toHaveBeenCalledWith(
      'Are you authorized to work here?',
      'No sponsorship required',
    );

    await click(button('Fill reviewed fields'));
    expect(client.fillPage).toHaveBeenCalledWith('resume-1', [
      { field_id: 'name', value: 'Jane' },
      { field_id: 'work-auth', value: 'No sponsorship required' },
      { field_id: 'resume-file', value: '__resume_pdf__' },
      { field_id: 'consent', value: 'false' },
    ]);
    expect(container.textContent).toContain('What salary do you expect?');
    expect(container.textContent).toContain('Attach cover letter manually.');
    expect(container.textContent).toContain('Custom control must be filled manually');
    expect(container.textContent).toContain('Log application');
  });

  it('retries PDF busy with the exact captured payload despite later edits', async () => {
    const descriptors = [
      descriptor('name', { label: 'Full name' }),
      descriptor('resume-file', { label: 'Upload résumé', type: 'file' }),
    ];
    const busy = new RuntimeMessageError({
      message: 'another PDF export is in progress — try again in a moment',
      status: 500,
      code: 'pdf_busy',
      retryable: true,
    });
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(async () => ({
        fields: [mapped('name', 'Jane'), mapped('resume-file', '__resume_pdf__', 1)],
        needs_human: [],
      })),
      fillPage: vi.fn()
        .mockRejectedValueOnce(busy)
        .mockResolvedValueOnce({ filled: ['name', 'resume-file'], unfilled: [] }),
    });
    await renderApp(client);
    await scanAndCreate(client);

    await click(button('Fill reviewed fields'));
    expect(client.fillPage).toHaveBeenCalledTimes(1);
    const captured = client.fillPage.mock.calls[0].map((value) => structuredClone(value));
    expect(container.textContent).toContain('Retry fill');

    await change(labelled('Full name'), 'Changed after failure');
    await click(button('Retry fill'));

    expect(client.fillPage).toHaveBeenCalledTimes(2);
    expect(client.fillPage.mock.calls[1]).toEqual(captured);
  });

  it('shows an explicit empty choice for needs-human radio and checkbox fields', async () => {
    const descriptors = [
      descriptor('sponsorship', {
        label: 'Sponsorship?',
        type: 'radio',
        options: [
          { value: 'yes_required', label: 'Yes' },
          { value: 'no_required', label: 'No' },
        ],
      }),
      descriptor('consent', { label: 'Consent?', type: 'checkbox' }),
    ];
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(async () => ({
        fields: [],
        needs_human: [
          { field_id: 'sponsorship', question: 'Will you require sponsorship?' },
          { field_id: 'consent', question: 'Do you consent?' },
        ],
      })),
    });
    await renderApp(client);
    await scanAndCreate(client);

    const sponsorship = labelled('Sponsorship?');
    const consent = labelled('Consent?');
    expect(sponsorship.value).toBe('');
    expect(consent.value).toBe('');
    expect(sponsorship.options[0]).toMatchObject({ value: '', textContent: 'Choose…' });
    expect(consent.options[0]).toMatchObject({ value: '', textContent: 'Choose…' });

    await change(sponsorship, 'no_required');
    await change(consent, 'false');
    expect(client.saveAnswer).not.toHaveBeenCalled();
    await click(button('Fill reviewed fields'));
    expect(client.fillPage).toHaveBeenCalledWith('resume-1', [
      { field_id: 'sponsorship', value: 'no_required' },
      { field_id: 'consent', value: 'false' },
    ]);
  });

  it('disables rescanning while a mapping request is in flight', async () => {
    const mappingRequest = deferred();
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(() => mappingRequest.promise),
    });
    await renderApp(client);
    await click(button('Scan page'));
    await click(button('Create review'));

    expect(client.createMapping).toHaveBeenCalledOnce();
    expect(button('Scan page').disabled).toBe(true);

    mappingRequest.resolve({ fields: [mapped('name', 'Jane')], needs_human: [] });
    await settle();
    expect(labelled('Full name').value).toBe('Jane');
  });

  it('shows actionable active-tab and running-app errors', async () => {
    const activeTabError = new RuntimeMessageError({
      message: 'Click the extension toolbar button again on that page.',
      code: 'active_tab_grant_lost',
      retryable: true,
    });
    const client = makeClient({ scanPage: vi.fn(async () => { throw activeTabError; }) });
    await renderApp(client);
    await click(button('Scan page'));
    expect(container.querySelector('[role="alert"]').textContent)
      .toMatch(/click the extension toolbar button again/i);

    const offlineClient = makeClient({
      checkConnection: vi.fn(async () => {
        throw new RuntimeMessageError({
          message: 'Failed to fetch',
          code: 'network_error',
          retryable: true,
        });
      }),
    });
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderApp(offlineClient);
    expect(container.querySelector('[role="alert"]').textContent)
      .toContain('Is Resume Designer running?');
  });

  it('logs exactly once on an explicit click and locks after successful creation', async () => {
    const logRequest = deferred();
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const client = makeClient({
      scanPage: vi.fn(async () => ({
        descriptors,
        page: { company: 'Scraped Co', title: 'Scraped Role' },
      })),
      createMapping: vi.fn(async () => ({
        fields: [mapped('name', 'Jane')], needs_human: [],
      })),
      fillPage: vi.fn(async () => ({ filled: ['name'], unfilled: [] })),
      logApplication: vi.fn(() => logRequest.promise),
    });
    await renderApp(client);
    await scanAndCreate(client);
    await click(button('Fill reviewed fields'));

    await change(labelled('Company'), 'Edited Co');
    await change(labelled('Role title'), 'Edited Role');
    const logButton = button('Log application');
    await act(async () => {
      logButton.click();
      logButton.click();
      await Promise.resolve();
    });

    expect(client.logApplication).toHaveBeenCalledOnce();
    expect(client.logApplication).toHaveBeenCalledWith({
      variantId: 'resume-1',
      company: 'Edited Co',
      title: 'Edited Role',
    });
    expect(button('Logging…').disabled).toBe(true);

    logRequest.resolve({ application: { id: 'application-1' } });
    await settle();
    expect(container.textContent).toContain('Application logged.');
    expect(button('Application logged').disabled).toBe(true);
    await click(button('Application logged'));
    expect(client.logApplication).toHaveBeenCalledOnce();
  });

  it('contains no submit capability and uses explicit button types', async () => {
    const client = makeClient();
    await renderApp(client);

    expect([...container.querySelectorAll('button')].every((item) => item.type === 'button')).toBe(true);
    expect([...container.querySelectorAll('button')]
      .some((item) => /^submit$/i.test(item.textContent.trim()))).toBe(false);

    const sources = await Promise.all([
      'App.jsx',
      'PairingView.jsx',
      'ReviewList.jsx',
      'runtimeClient.js',
      'reviewModel.js',
    ].map((name) => readFile(resolve('src/sidepanel', name), 'utf8')));
    expect(sources.join('\n')).not.toMatch(
      /page\.submit|requestSubmit|\.submit\s*\(|dispatchEvent\s*\(\s*new\s+Event\s*\(\s*['"]submit/i,
    );
  });
});
