/* @vitest-environment jsdom */

import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
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
    getPrivacyConsent: vi.fn(async () => ({ accepted: true })),
    acceptPrivacyConsent: vi.fn(async () => ({ accepted: true })),
    disconnect: vi.fn(async () => ({ disconnected: true, revoked: true })),
    cancelPairing: vi.fn(async () => ({ cancelled: true })),
    checkConnection: vi.fn(async () => ({
      connected: true,
      health: { ok: true },
      profileId: 'profile-1',
      profileContextId: 'context-1',
      resumes: [{ id: 'resume-1', name: 'Backend résumé' }],
    })),
    savePairing: vi.fn(async () => ({
      connected: true,
      health: { ok: true },
      profileId: 'profile-1',
      profileContextId: 'context-1',
      resumes: [{ id: 'resume-1', name: 'Backend résumé' }],
    })),
    openApp: vi.fn(async () => ({ opened: true })),
    listResumes: vi.fn(),
    getAIModels: vi.fn(async () => ({
      models: [{ id: 'provider/test-model', name: 'Test model' }],
      defaults: { mapping: 'provider/test-model', analysis: 'provider/test-model', tailoring: 'provider/test-model' },
      autoFallback: false,
    })),
    scanPage: vi.fn(async () => ({ descriptors: [], page: {} })),
    createMapping: vi.fn(async () => ({ fields: [], needs_human: [] })),
    fillPage: vi.fn(async () => ({ filled: [], unfilled: [] })),
    saveAnswer: vi.fn(async () => ({ answer: { id: 'answer-1' } })),
    logApplication: vi.fn(async () => ({ application: { id: 'application-1' } })),
    analyzeJobFit: vi.fn(async () => ({
      resumeId: 'resume-1',
      analysis: {
        matchScore: 82,
        keywordMatches: ['product'],
        missingKeywords: ['payments'],
        evidence: [],
        strengths: ['Relevant product experience'],
        gaps: [],
        recommendations: [],
      },
    })),
    createTailoredResume: vi.fn(async () => ({
      created: true,
      resume: { id: 'resume-tailored', name: 'Tailored résumé' },
    })),
    ...overrides,
  };
}

let container;
let root;

async function settle() {
  await act(async () => {
    if (vi.isFakeTimers()) {
      await Promise.resolve();
      await Promise.resolve();
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
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

async function renderApp(client, props = {}) {
  await act(async () => {
    root.render(<App client={client} {...props} />);
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
  const control = matching?.htmlFor ? container.querySelector(`[id="${matching.htmlFor}"]`) : null;
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
      : control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
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
  await click(button('Prepare autofill review'));
  expect(client.scanPage).toHaveBeenCalledOnce();
  await waitFor(() => expect(client.createMapping).toHaveBeenCalledOnce());
  await settle();
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('chrome', { windows: { getCurrent: vi.fn(async () => ({ id: 4 })) } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    await client.createMapping('context-1', 'resume-1', descriptors);
    await client.fillPage('context-1', 'resume-1', fields);
    await client.saveAnswer('context-1', 'Question?', 'Answer');
    await client.logApplication({
      profileContextId: 'context-1', requestId: '550e8400-e29b-41d4-a716-446655440000', variantId: 'resume-1', company: 'Acme', title: 'Engineer', notes: 'Optional',
    });

    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: 'connection.check' },
      { type: 'pairing.save', token: 'token' },
      { type: 'resumes.list' },
      { type: 'page.scan' },
      { type: 'mapping.create', profileContextId: 'context-1', resumeId: 'resume-1', descriptors },
      { type: 'page.fill', profileContextId: 'context-1', resumeId: 'resume-1', fields },
      { type: 'answer.save', profileContextId: 'context-1', question: 'Question?', answer: 'Answer' },
      {
        type: 'application.log',
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        profileContextId: 'context-1',
        variantId: 'resume-1',
        company: 'Acme',
        title: 'Engineer',
        notes: 'Optional',
      },
    ]);
  });

  it('refreshes resumes and clears reviewed data when the app context changes', async () => {
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const profileChanged = new RuntimeMessageError({
      message: 'On Paper reloaded or switched profiles. Review the refreshed résumé list and scan again.',
      code: 'profile_changed',
      retryable: true,
    });
    const client = makeClient({
      checkConnection: vi.fn()
        .mockResolvedValueOnce({
          connected: true,
          health: { ok: true },
          profileId: 'profile-1',
          profileContextId: 'context-1',
          resumes: [{ id: 'resume-1', name: 'Backend résumé' }],
        })
        .mockResolvedValueOnce({
          connected: true,
          health: { ok: true },
          profileId: 'profile-1',
          profileContextId: 'context-2',
          resumes: [{ id: 'resume-2', name: 'Frontend résumé' }],
        }),
      scanPage: vi.fn(async () => ({ descriptors, page: { company: 'Old Co', title: 'Old role' } })),
      createMapping: vi.fn(async () => ({
        fields: [mapped('name', 'Old Profile Name')], needs_human: [],
      })),
      fillPage: vi.fn(async () => { throw profileChanged; }),
    });
    await renderApp(client);
    await scanAndCreate(client);

    await click(button('Fill reviewed fields'));
    await waitFor(() => expect(client.checkConnection).toHaveBeenCalledTimes(2));

    expect(client.fillPage).toHaveBeenCalledWith('context-1', 'resume-1', [
      { field_id: 'name', value: 'Old Profile Name' },
    ], expect.any(Object));
    expect(labelled('Resume').value).toBe('resume-2');
    expect(labelled('Resume').options[0].textContent).toBe('Frontend résumé');
    expect(container.textContent).not.toContain('Old Profile Name');
    expect(button('Prepare autofill review').disabled).toBe(false);
    expect(container.querySelector('[role="alert"]').textContent)
      .toMatch(/reloaded or switched profiles/i);
  });

  it('retries profile refresh through a restore window without reviving the old review', async () => {
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const profileChanged = new RuntimeMessageError({
      message: 'On Paper is restoring the active profile.',
      status: 503,
      code: 'profile_changed',
      retryable: true,
    });
    const client = makeClient({
      checkConnection: vi.fn()
        .mockResolvedValueOnce({
          connected: true,
          health: { ok: true },
          profileId: 'profile-1',
          profileContextId: 'context-1',
          resumes: [{ id: 'resume-1', name: 'Backend résumé' }],
        })
        .mockRejectedValueOnce(profileChanged)
        .mockResolvedValueOnce({
          connected: true,
          health: { ok: true },
          profileId: 'profile-1',
          profileContextId: 'context-2',
          resumes: [{ id: 'resume-2', name: 'Frontend résumé' }],
        }),
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(async () => ({
        fields: [mapped('name', 'Old Profile Name')], needs_human: [],
      })),
      fillPage: vi.fn(async () => { throw profileChanged; }),
    });
    await renderApp(client);
    await scanAndCreate(client);

    vi.useFakeTimers();
    try {
      await act(async () => {
        button('Fill reviewed fields').click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(client.checkConnection).toHaveBeenCalledTimes(2);
      expect([...container.querySelectorAll('label')]
        .some((label) => label.textContent.includes('Full name'))).toBe(false);
      expect(container.querySelector('[role="status"]').textContent).toMatch(/reconnecting/i);

      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });

      expect(client.checkConnection).toHaveBeenCalledTimes(3);
      expect(labelled('Resume').value).toBe('resume-2');
      expect(labelled('Resume').options[0].textContent).toBe('Frontend résumé');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnects when the initial connection check lands in a restore window', async () => {
    const profileChanged = new RuntimeMessageError({
      message: 'On Paper is restoring the active profile.',
      status: 503,
      code: 'profile_changed',
      retryable: true,
    });
    const client = makeClient({
      checkConnection: vi.fn()
        .mockRejectedValueOnce(profileChanged)
        .mockResolvedValueOnce({
          connected: true,
          health: { ok: true },
          profileId: 'profile-2',
          profileContextId: 'context-2',
          resumes: [{ id: 'resume-2', name: 'Restored résumé' }],
        }),
    });

    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(<App client={client} />);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(client.checkConnection).toHaveBeenCalledOnce();
      expect(container.querySelector('[role="status"]')?.textContent).toMatch(/reconnecting/i);

      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });

      expect(client.checkConnection).toHaveBeenCalledTimes(2);
      expect(labelled('Resume').value).toBe('resume-2');
      expect(labelled('Resume').options[0].textContent).toBe('Restored résumé');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns to actionable pairing after an unauthorized fill discards the old review', async () => {
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const unauthorized = new RuntimeMessageError({
      message: 'Pairing token is no longer valid. Pair the extension again.',
      status: 401,
      code: 'unauthorized',
      retryable: false,
    });
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(async () => ({
        fields: [mapped('name', 'Old Profile Name')], needs_human: [],
      })),
      fillPage: vi.fn(async () => { throw unauthorized; }),
    });
    await renderApp(client);
    await scanAndCreate(client);

    await click(button('Fill reviewed fields'));

    expect(client.fillPage).toHaveBeenCalledWith('context-1', 'resume-1', [
      { field_id: 'name', value: 'Old Profile Name' },
    ], expect.any(Object));
    expect([...container.querySelectorAll('label')]
      .some((label) => label.textContent.includes('Full name'))).toBe(false);
    expect(labelled('Pairing token')).toBeTruthy();
    expect(container.querySelector('[role="alert"]').textContent)
      .toMatch(/pair the extension again/i);
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
  it('automatically checks only connection and creates a review from one explicit click', async () => {
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

    await click(button('Prepare autofill review'));
    expect(client.scanPage).toHaveBeenCalledOnce();
    expect(client.createMapping).toHaveBeenCalledWith('context-1', 'resume-1', descriptors, { job: { company: 'Acme', title: 'Engineer', description: '' } });
    expect(labelled('Full name').value).toBe('Jane');
    expect(container.querySelector('.workflow-status')?.textContent)
      .toBe('Review ready — 1 field.');
    expect(button('Start over')).toBeTruthy();
  });

  it('starts a fresh scan and mapping only after explicitly discarding a completed review', async () => {
    const firstDescriptors = [descriptor('name', { label: 'Full name' })];
    const secondDescriptors = [
      descriptor('name', { label: 'Full name' }),
      descriptor('email', { label: 'Email' }),
    ];
    const client = makeClient({
      scanPage: vi.fn()
        .mockResolvedValueOnce({ descriptors: firstDescriptors, page: {} })
        .mockResolvedValueOnce({ descriptors: secondDescriptors, page: {} }),
      createMapping: vi.fn()
        .mockResolvedValueOnce({
          fields: [mapped('name', 'Jane')],
          needs_human: [],
        })
        .mockResolvedValueOnce({
          fields: [mapped('name', 'Jane'), mapped('email', 'jane@example.com')],
          needs_human: [],
        }),
    });
    await renderApp(client);

    await click(button('Prepare autofill review'));
    expect(container.querySelector('.workflow-status')?.textContent)
      .toBe('Review ready — 1 field.');

    await change(labelled('Full name'), 'Edited locally');
    await click(button('Start over'));
    expect(client.scanPage).toHaveBeenCalledOnce();
    expect(client.createMapping).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('Review fields');
    expect(button('Prepare autofill review')).toBeTruthy();

    await click(button('Prepare autofill review'));
    expect(client.scanPage).toHaveBeenCalledTimes(2);
    expect(client.createMapping).toHaveBeenCalledTimes(2);
    expect(client.createMapping.mock.calls.map((call) => call[2])).toEqual([
      firstDescriptors,
      secondDescriptors,
    ]);
    expect(container.querySelector('.workflow-status')?.textContent)
      .toBe('Review ready — 2 fields.');
    expect(labelled('Email').value).toBe('jane@example.com');
  });

  it('reuses a successful scan when retrying after a mapping failure', async () => {
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn()
        .mockRejectedValueOnce(new Error('The model request failed'))
        .mockResolvedValueOnce({
          fields: [mapped('name', 'Jane')],
          needs_human: [],
        }),
    });
    await renderApp(client);

    await click(button('Prepare autofill review'));
    expect(client.scanPage).toHaveBeenCalledOnce();
    expect(client.createMapping).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain('The model request failed');
    expect(button('Retry preparing review').disabled).toBe(false);
    expect(container.querySelector('.workflow-status')?.textContent)
      .toBe('Application fields scanned. Retry preparing the review.');

    await click(button('Retry preparing review'));
    expect(client.scanPage).toHaveBeenCalledOnce();
    expect(client.createMapping).toHaveBeenCalledTimes(2);
    expect(client.createMapping.mock.calls.map((call) => call[2])).toEqual([
      descriptors,
      descriptors,
    ]);
    expect(labelled('Full name').value).toBe('Jane');
    expect(button('Start over')).toBeTruthy();
  });

  it('announces an empty scan without requesting a mapping', async () => {
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors: [], page: {} })),
    });
    await renderApp(client);

    await click(button('Prepare autofill review'));

    expect(client.scanPage).toHaveBeenCalledOnce();
    expect(client.createMapping).not.toHaveBeenCalled();
    expect(container.querySelector('.workflow-status')?.textContent)
      .toBe('No supported application fields were found on this page.');
    expect(button('Prepare autofill review').disabled).toBe(false);
  });

  it('pairs only on click and keeps the running-app sentence plain and unlinked', async () => {
    const client = makeClient({
      checkConnection: vi.fn(async () => ({ connected: false, health: { ok: true }, resumes: [] })),
    });
    await renderApp(client);

    expect(container.textContent).toMatch(/open the desktop app/i);
    expect(client.savePairing).not.toHaveBeenCalled();

    await change(labelled('Pairing token'), '  pasted-token  ');
    expect(client.savePairing).not.toHaveBeenCalled();
    await click(button('Pair with token'));

    expect(client.savePairing).toHaveBeenCalledWith('  pasted-token  ');
    await waitFor(() => expect(container.textContent).toContain('Connected'));
  });

  it('renders editable review items, saves answers explicitly, skips manual items, and shows fill warnings', async () => {
    const descriptors = [
      descriptor('name', { label: 'Full name' }),
      descriptor('work-auth', { label: 'Notice period?' }),
      descriptor('salary', { label: 'Salary expectation?' }),
      descriptor('resume-file', { label: 'Upload résumé', type: 'file' }),
      descriptor('cover-file', { label: 'Cover letter', type: 'file' }),
      descriptor('consent', { label: 'Availability', type: 'checkbox' }),
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
          { field_id: 'work-auth', question: 'What is your notice period?' },
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
    expect(container.textContent).toContain('Selected resume PDF');
    expect(container.textContent).toContain('Attach cover letter manually.');

    await change(labelled('Notice period?'), 'Two weeks');
    expect(client.saveAnswer).not.toHaveBeenCalled();
    labelled('Notice period?').dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await settle();
    expect(client.saveAnswer).not.toHaveBeenCalled();

    const saveButton = container.querySelector('[aria-label="Save answer for Notice period?"]');
    expect(saveButton).toBeTruthy();
    expect(container.querySelector('[aria-label="Save answer for Cover letter"]')).toBeNull();
    await click(saveButton);
    expect(client.saveAnswer).toHaveBeenCalledWith(
      'context-1',
      'What is your notice period?',
      'Two weeks',
    );

    await click(button('Fill reviewed fields'));
    expect(client.fillPage).toHaveBeenCalledWith('context-1', 'resume-1', [
      { field_id: 'name', value: 'Jane' },
      { field_id: 'work-auth', value: 'Two weeks' },
      { field_id: 'resume-file', value: '__resume_pdf__' },
      { field_id: 'consent', value: 'false' },
    ], expect.any(Object));
    expect(container.textContent).toContain('Salary expectation?');
    expect(container.textContent).toContain('Attach cover letter manually.');
    expect(container.textContent).toContain('Availability: Custom control must be filled manually');
    expect(container.textContent).toContain('Log application');
  });

  it('shows mapped and needs-human custom controls as static manual fields and excludes them from fill', async () => {
    const descriptors = [
      descriptor('name', { label: 'Full name' }),
      descriptor('country', { label: 'Country', type: 'custom' }),
      descriptor('eligibility', { label: 'Office preference', type: 'custom' }),
    ];
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(async () => ({
        fields: [mapped('name', 'Jane')],
        needs_human: [],
      })),
    });
    await renderApp(client);
    await scanAndCreate(client);

    expect(client.createMapping).toHaveBeenCalledWith(
      'context-1', 'resume-1', [descriptors[0]], { job: { company: '', title: '', description: '' } },
    );

    const countryItem = [...container.querySelectorAll('.review-item')]
      .find((item) => item.textContent.includes('Country'));
    expect(countryItem).toBeTruthy();
    expect(countryItem.querySelector('input, select, textarea')).toBeNull();
    expect(countryItem.querySelector('[aria-label="Save answer for Country"]')).toBeNull();
    expect(countryItem.querySelector('.field-question')?.textContent)
      .toBe('Complete this field on the application page.');
    expect(countryItem.querySelector('.manual-warning[role="note"]')?.textContent)
      .toBe('This field can’t be autofilled. Complete it on the application page.');
    const countryLabel = document.getElementById(countryItem.getAttribute('aria-labelledby'));
    const countryDescriptions = countryItem.getAttribute('aria-describedby')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
      .join(' ');
    expect(countryLabel?.textContent).toBe('Country');
    expect(countryDescriptions)
      .toContain('This field can’t be autofilled. Complete it on the application page.');

    const eligibilityItem = [...container.querySelectorAll('.review-item')]
      .find((item) => item.textContent.includes('Office preference'));
    expect(eligibilityItem.querySelector('input, select, textarea')).toBeNull();
    expect(eligibilityItem.querySelector('[aria-label="Save answer for Office preference"]')).toBeNull();
    expect(client.saveAnswer).not.toHaveBeenCalled();
    expect(container.querySelector('.workflow-status')?.textContent)
      .toBe('Review ready — 3 fields; 2 require manual entry.');

    await click(button('Fill reviewed fields'));
    expect(client.fillPage).toHaveBeenCalledWith('context-1', 'resume-1', [
      { field_id: 'name', value: 'Jane' },
    ], expect.any(Object));
    expect(container.textContent).toContain('Country: This custom control must be completed manually.');
    expect(container.textContent).toContain('Office preference: This custom control must be completed manually.');
  });

  it('omits the fill action when every reviewed field requires manual entry', async () => {
    const descriptors = [descriptor('country', { label: 'Country', type: 'custom' })];
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
    });
    await renderApp(client);
    await click(button('Prepare autofill review'));
    await waitFor(() => expect(container.textContent).toContain('Review fields'));

    expect(client.createMapping).not.toHaveBeenCalled();
    expect([...container.querySelectorAll('button')]
      .some((candidate) => candidate.textContent.trim() === 'Fill reviewed fields')).toBe(false);
    expect(container.querySelector('.workflow-status')?.textContent)
      .toBe('Review ready — 1 field; 1 requires manual entry.');
    expect(client.fillPage).not.toHaveBeenCalled();
  });

  it('serializes scan and mapping actions synchronously and locks resume changes', async () => {
    const scanRequest = deferred();
    const mappingRequest = deferred();
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const client = makeClient({
      checkConnection: vi.fn(async () => ({
        connected: true,
        health: { ok: true },
        profileId: 'profile-1',
        profileContextId: 'context-1',
        resumes: [
          { id: 'resume-1', name: 'Backend résumé' },
          { id: 'resume-2', name: 'Frontend résumé' },
        ],
      })),
      scanPage: vi.fn(() => scanRequest.promise),
      createMapping: vi.fn(() => mappingRequest.promise),
    });
    await renderApp(client);

    const resumePicker = labelled('Resume');
    const reviewButton = button('Prepare autofill review');
    await act(async () => {
      reviewButton.click();
      reviewButton.click();
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
        .set.call(resumePicker, 'resume-2');
      resumePicker.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(client.scanPage).toHaveBeenCalledOnce();
    expect(client.createMapping).not.toHaveBeenCalled();
    expect(resumePicker.value).toBe('resume-1');
    expect(resumePicker.disabled).toBe(true);
    expect(button('Scanning application form…').disabled).toBe(true);

    scanRequest.resolve({ descriptors, page: {} });
    await waitFor(() => expect(client.createMapping).toHaveBeenCalledOnce());
    expect(button('Preparing field suggestions…').disabled).toBe(true);
    expect(resumePicker.disabled).toBe(true);
    await act(async () => {
      reviewButton.click();
      reviewButton.click();
      await Promise.resolve();
    });

    expect(client.createMapping).toHaveBeenCalledOnce();
    expect(client.scanPage).toHaveBeenCalledOnce();
    expect(reviewButton.disabled).toBe(true);

    mappingRequest.resolve({ fields: [mapped('name', 'Jane')], needs_human: [] });
    await settle();
    expect(labelled('Full name').value).toBe('Jane');
    expect(button('Start over')).toBeTruthy();
    expect(container.querySelector('.workflow-status')?.textContent)
      .toBe('Review ready — 1 field.');
  });

  it('keeps workflow controls locked while a fill request is pending', async () => {
    const fillRequest = deferred();
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(async () => ({
        fields: [mapped('name', 'Jane')], needs_human: [],
      })),
      fillPage: vi.fn(() => fillRequest.promise),
    });
    await renderApp(client);
    await scanAndCreate(client);

    const fillButton = button('Fill reviewed fields');
    const reviewButton = button('Start over');
    await act(async () => {
      fillButton.click();
      fillButton.click();
      reviewButton.click();
      await Promise.resolve();
    });

    expect(client.fillPage).toHaveBeenCalledOnce();
    expect(client.scanPage).toHaveBeenCalledOnce();
    expect(client.createMapping).toHaveBeenCalledOnce();
    expect(labelled('Resume').disabled).toBe(true);
    expect(labelled('Full name').disabled).toBe(true);
    expect(reviewButton.disabled).toBe(true);

    fillRequest.resolve({ filled: ['name'], unfilled: [] });
    await settle();
    expect(container.textContent).toContain('Log application');
  });

  it('keeps the exact saved answer value and locks its editor while saving', async () => {
    const saveRequest = deferred();
    const descriptors = [descriptor('work-auth', { label: 'Notice period?' })];
    const client = makeClient({
      checkConnection: vi.fn(async () => ({
        connected: true,
        health: { ok: true },
        profileId: 'profile-1',
        profileContextId: 'context-1',
        resumes: [
          { id: 'resume-1', name: 'Backend résumé' },
          { id: 'resume-2', name: 'Frontend résumé' },
        ],
      })),
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(async () => ({
        fields: [],
        needs_human: [{
          field_id: 'work-auth',
          question: 'What is your notice period?',
        }],
      })),
      saveAnswer: vi.fn(() => saveRequest.promise),
    });
    await renderApp(client);
    await scanAndCreate(client);

    const editor = labelled('Notice period?');
    const resumePicker = labelled('Resume');
    const reviewButton = button('Start over');
    await change(editor, 'Answer A');
    await act(async () => {
      button('Save answer').click();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        .set.call(editor, 'Answer B');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
        .set.call(resumePicker, 'resume-2');
      resumePicker.dispatchEvent(new Event('change', { bubbles: true }));
      reviewButton.click();
      await Promise.resolve();
    });

    expect(client.saveAnswer).toHaveBeenCalledOnce();
    expect(client.saveAnswer).toHaveBeenCalledWith(
      'context-1',
      'What is your notice period?',
      'Answer A',
    );
    expect(resumePicker.value).toBe('resume-1');
    expect(client.scanPage).toHaveBeenCalledOnce();
    expect(client.createMapping).toHaveBeenCalledOnce();
    expect(editor.disabled).toBe(true);
    expect(editor.value).toBe('Answer A');
    expect(reviewButton.disabled).toBe(true);
    expect(button('Fill reviewed fields').disabled).toBe(true);

    saveRequest.resolve({ answer: { id: 'answer-1' } });
    await settle();
    expect(button('Answer saved').disabled).toBe(true);

    await change(editor, 'Answer B');
    expect(button('Save answer').disabled).toBe(false);
  });

  it('associates stable needs-human and low-confidence descriptions with their editors', async () => {
    const descriptors = [
      descriptor('name', { label: 'Full name' }),
      descriptor('work-auth', { label: 'Notice period?' }),
      descriptor('consent', { label: 'Available immediately?', type: 'checkbox' }),
    ];
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(async () => ({
        fields: [mapped('name', 'Jane', 0.5)],
        needs_human: [{
          field_id: 'work-auth',
          question: 'What is your notice period?',
        }, {
          field_id: 'consent',
          question: 'Are you available immediately?',
        }],
      })),
    });
    await renderApp(client);
    await scanAndCreate(client);

    const nameEditor = labelled('Full name');
    const answerEditor = labelled('Notice period?');
    const consentEditor = labelled('Available immediately?');
    const confidenceId = nameEditor.getAttribute('aria-describedby');
    const questionId = answerEditor.getAttribute('aria-describedby').split(' ')[0];
    const consentQuestionId = consentEditor.getAttribute('aria-describedby').split(' ')[0];
    expect(document.getElementById(confidenceId)?.textContent).toBe('Low confidence');
    expect(document.getElementById(questionId)?.textContent)
      .toBe('What is your notice period?');
    expect(document.getElementById(consentQuestionId)?.textContent).toBe('Are you available immediately?');

    await change(nameEditor, 'Janet');
    await change(answerEditor, 'Yes');
    await change(consentEditor, 'false');
    expect(nameEditor.getAttribute('aria-describedby')).toBe(confidenceId);
    expect(answerEditor.getAttribute('aria-describedby').split(' ')[0]).toBe(questionId);
    expect(consentEditor.getAttribute('aria-describedby').split(' ')[0]).toBe(consentQuestionId);
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
      descriptor('consent', { label: 'Available immediately?', type: 'checkbox' }),
    ];
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(async () => ({
        fields: [],
        needs_human: [
          { field_id: 'sponsorship', question: 'Will you require sponsorship?' },
          { field_id: 'consent', question: 'Are you available immediately?' },
        ],
      })),
    });
    await renderApp(client);
    await scanAndCreate(client);

    const sponsorship = labelled('Sponsorship?');
    const consent = labelled('Available immediately?');
    expect(sponsorship.value).toBe('');
    expect(consent.value).toBe('');
    expect(sponsorship.options[0]).toMatchObject({ value: '', textContent: 'Choose…' });
    expect(consent.options[0]).toMatchObject({ value: '', textContent: 'Choose…' });

    await change(sponsorship, 'no_required');
    await change(consent, 'false');
    expect(client.saveAnswer).not.toHaveBeenCalled();
    await click(button('Fill reviewed fields'));
    expect(client.fillPage).toHaveBeenCalledWith('context-1', 'resume-1', [
      { field_id: 'sponsorship', value: 'no_required' },
      { field_id: 'consent', value: 'false' },
    ], expect.any(Object));
  });

  it('disables rescanning while a mapping request is in flight', async () => {
    const mappingRequest = deferred();
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(() => mappingRequest.promise),
    });
    await renderApp(client);
    await act(async () => {
      button('Prepare autofill review').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(client.createMapping).toHaveBeenCalledOnce();
    expect(button('Preparing field suggestions…').disabled).toBe(true);

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
    await click(button('Prepare autofill review'));
    expect(client.createMapping).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent)
      .toMatch(/click the extension toolbar button again/i);
    expect(button('Prepare autofill review').disabled).toBe(false);

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
      .toContain('Is On Paper running?');
  });

  it('logs exactly once on an explicit click and locks after successful creation', async () => {
    const logRequest = deferred();
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const client = makeClient({
      checkConnection: vi.fn(async () => ({
        connected: true,
        health: { ok: true },
        profileId: 'profile-1',
        profileContextId: 'context-1',
        resumes: [
          { id: 'resume-1', name: 'Backend résumé' },
          { id: 'resume-2', name: 'Frontend résumé' },
        ],
      })),
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
    const resumePicker = labelled('Resume');
    const reviewButton = button('Start over');
    const fillButton = button('Fill reviewed fields');
    await act(async () => {
      logButton.click();
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
        .set.call(resumePicker, 'resume-2');
      resumePicker.dispatchEvent(new Event('change', { bubbles: true }));
      reviewButton.click();
      fillButton.click();
      logButton.click();
      await Promise.resolve();
    });

    await waitFor(() => expect(client.logApplication).toHaveBeenCalledOnce());
    expect(client.logApplication).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      profileContextId: 'context-1',
      variantId: 'resume-1',
      company: 'Edited Co',
      title: 'Edited Role',
    });
    expect(resumePicker.value).toBe('resume-1');
    expect(client.scanPage).toHaveBeenCalledOnce();
    expect(client.createMapping).toHaveBeenCalledOnce();
    expect(client.fillPage).toHaveBeenCalledOnce();
    expect(resumePicker.disabled).toBe(true);
    expect(button('Logging…').disabled).toBe(true);

    logRequest.resolve({ application: { id: 'application-1' } });
    await settle();
    expect(container.textContent).toContain('Application logged.');
    expect(button('Application logged').disabled).toBe(true);
    await click(button('Application logged'));
    expect(client.logApplication).toHaveBeenCalledOnce();
  });

  it('reports an unreachable app truthfully, never auto-launches, and opens it only on request', async () => {
    const unavailable = new RuntimeMessageError({
      message: 'Failed to fetch',
      code: 'app_unavailable',
      retryable: true,
    });
    const client = makeClient({
      checkConnection: vi.fn()
        .mockRejectedValueOnce(unavailable)
        .mockResolvedValueOnce({
          connected: true,
          profileId: 'profile-1',
          profileContextId: 'context-1',
          resumes: [{ id: 'resume-1', name: 'Backend résumé' }],
        }),
    });

    await renderApp(client);

    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/not connected/i);
    expect(client.openApp).not.toHaveBeenCalled();
    await click(button('Open On Paper'));

    expect(client.openApp).toHaveBeenCalledOnce();
    expect(client.checkConnection).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Connected');
  });

  it('shows update and download guidance for an incompatible or missing desktop app', async () => {
    const incompatible = new RuntimeMessageError({
      message: 'On Paper must be updated',
      code: 'app_update_required',
      retryable: false,
    });
    const client = makeClient({
      checkConnection: vi.fn(async () => { throw incompatible; }),
    });
    await renderApp(client);

    expect(container.textContent).toContain('Update On Paper');
    const download = [...container.querySelectorAll('a')]
      .find((link) => link.textContent.trim() === 'Download On Paper');
    expect(download?.href).toMatch(/github\.com\/ashproto\/Resume-Designer\/releases\/latest/);
    expect(labelled.bind(null, 'Pairing token')).toThrow();
    expect(client.openApp).not.toHaveBeenCalled();
  });

  it('marks a lost heartbeat offline, keeps the review visible, and rebuilds it after restart without filling', async () => {
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const unavailable = new RuntimeMessageError({
      message: 'On Paper stopped',
      code: 'app_unavailable',
      retryable: true,
    });
    const client = makeClient({
      checkConnection: vi.fn()
        .mockResolvedValueOnce({
          connected: true,
          profileId: 'profile-1',
          profileContextId: 'context-1',
          resumes: [{ id: 'resume-1', name: 'Backend résumé' }],
        })
        .mockRejectedValueOnce(unavailable)
        .mockResolvedValueOnce({
          connected: true,
          profileId: 'profile-1',
          profileContextId: 'context-1',
          resumes: [{ id: 'resume-1', name: 'Backend résumé' }],
        }),
      scanPage: vi.fn()
        .mockResolvedValueOnce({ descriptors, page: { url: 'https://jobs.test/1', fingerprint: 'job-1' } })
        .mockResolvedValueOnce({ descriptors, page: { url: 'https://jobs.test/1', fingerprint: 'job-1' } }),
      createMapping: vi.fn()
        .mockResolvedValueOnce({ fields: [mapped('name', 'Old value')], needs_human: [] })
        .mockResolvedValueOnce({ fields: [mapped('name', 'Fresh value')], needs_human: [] }),
    });
    vi.useFakeTimers();
    try {
      await renderApp(client, { heartbeatMs: 25 });
      await scanAndCreate(client);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(25);
      });
      expect(container.querySelector('[role="status"]')?.textContent).toMatch(/not connected/i);
      expect(labelled('Full name').value).toBe('Old value');

      await act(async () => {
        button('Reconnect and refresh review').click();
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(client.openApp).toHaveBeenCalledOnce();
      expect(client.fillPage).not.toHaveBeenCalled();
      expect(client.scanPage).toHaveBeenCalledTimes(2);
      expect(client.createMapping).toHaveBeenCalledTimes(2);
      expect(labelled('Full name').value).toBe('Fresh value');
      expect(container.querySelector('.workflow-status')?.textContent).toMatch(/review refreshed/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a stale review when a heartbeat observes a new profile context', async () => {
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const client = makeClient({
      checkConnection: vi.fn()
        .mockResolvedValueOnce({
          connected: true,
          profileId: 'profile-1',
          profileContextId: 'context-1',
          resumes: [{ id: 'resume-1', name: 'Backend résumé' }],
        })
        .mockResolvedValueOnce({
          connected: true,
          profileId: 'profile-2',
          profileContextId: 'context-2',
          resumes: [{ id: 'resume-2', name: 'Product résumé' }],
        }),
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(async () => ({
        fields: [mapped('name', 'Old profile value')], needs_human: [],
      })),
    });
    vi.useFakeTimers();
    try {
      await renderApp(client, { heartbeatMs: 25 });
      await scanAndCreate(client);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(25);
      });
      expect(labelled('Resume').value).toBe('resume-2');
      expect(container.textContent).not.toContain('Old profile value');
      expect(button('Prepare autofill review')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('announces the exact attached PDF filename and filled-field count', async () => {
    const descriptors = [
      descriptor('name', { label: 'Full name' }),
      descriptor('resume-file', { label: 'Résumé PDF', type: 'file' }),
    ];
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page: {} })),
      createMapping: vi.fn(async () => ({
        fields: [mapped('name', 'Jane'), mapped('resume-file', '__resume_pdf__', 1)],
        needs_human: [],
      })),
      fillPage: vi.fn(async () => ({
        filled: ['name', 'resume-file'],
        unfilled: [],
        attachments: [{ field_id: 'resume-file', filename: 'Jane-Product-Resume.pdf' }],
      })),
    });
    await renderApp(client);
    await scanAndCreate(client);
    await click(button('Fill reviewed fields'));

    expect(container.textContent)
      .toContain('Attached Jane-Product-Resume.pdf. Filled 2 fields.');
  });

  it('offers a manual job-description fallback and renders app-backed fit analysis', async () => {
    const page = {
      company: 'Acme',
      title: 'Staff Product Engineer',
      url: 'https://jobs.test/staff',
      description: '',
      fingerprint: 'job-empty',
    };
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors: [], page })),
    });
    await renderApp(client);

    await change(labelled('AI model'), 'provider/test-model');
    await click(button('Tailor resume'));
    await click(button('Analyze fit'));
    expect(client.analyzeJobFit).not.toHaveBeenCalled();
    expect(labelled('Job description')).toBeTruthy();
    await change(labelled('Job description'), 'Lead accessible product development.');
    await click(button('Analyze fit'));

    expect(client.analyzeJobFit).toHaveBeenCalledWith({
      profileContextId: 'context-1',
      resumeId: 'resume-1',
      job: {
        company: 'Acme',
        title: 'Staff Product Engineer',
        description: 'Lead accessible product development.',
      },
      model: 'provider/test-model',
    });
    expect(container.textContent).toContain('82% match');
    expect(container.textContent).toContain('Relevant product experience');
  });

  it('reuses a tailoring request id, selects the new résumé, and rebuilds review only on the unchanged page', async () => {
    const originalDescriptors = [descriptor('name', { label: 'Full name' })];
    const tailoredDescriptors = [
      descriptor('name', { label: 'Full name' }),
      descriptor('country', { label: 'Country', type: 'custom' }),
    ];
    const page = {
      company: 'Acme',
      title: 'Staff Product Engineer',
      url: 'https://jobs.test/staff',
      description: 'Lead product development.',
      fingerprint: 'job-123',
    };
    const failure = new RuntimeMessageError({
      message: 'AI request timed out', code: 'ai_failed', retryable: true,
    });
    const tailoredId = 'companion-550e8400-e29b-41d4-a716-446655440000';
    const client = makeClient({
      checkConnection: vi.fn()
        .mockResolvedValueOnce({
          connected: true,
          profileId: 'profile-1',
          profileContextId: 'context-1',
          resumes: [{ id: 'resume-1', name: 'Backend résumé' }],
        })
        .mockResolvedValueOnce({
          connected: true,
          profileId: 'profile-1',
          profileContextId: 'context-1',
          resumes: [{ id: tailoredId, name: 'Staff Product Engineer — Acme' }],
        }),
      scanPage: vi.fn()
        .mockResolvedValueOnce({ descriptors: originalDescriptors, page })
        .mockResolvedValueOnce({ descriptors: originalDescriptors, page })
        .mockResolvedValueOnce({ descriptors: tailoredDescriptors, page })
        .mockResolvedValueOnce({ descriptors: tailoredDescriptors, page }),
      createMapping: vi.fn()
        .mockResolvedValueOnce({ fields: [mapped('name', 'Jane')], needs_human: [] })
        .mockResolvedValueOnce({ fields: [mapped('name', 'Tailored Jane')], needs_human: [] }),
      createTailoredResume: vi.fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({
          created: true,
          resume: { id: tailoredId, name: 'Staff Product Engineer — Acme' },
        }),
    });
    await renderApp(client, {
      createRequestId: () => '550e8400-e29b-41d4-a716-446655440000',
    });
    await change(labelled('AI model'), 'provider/test-model');
    await scanAndCreate(client);
    await click(button('Tailor resume'));

    await click(button('Create tailored resume'));
    expect(client.createTailoredResume).toHaveBeenCalledTimes(1);
    await click(button('Create tailored resume'));
    await waitFor(() => expect(client.createTailoredResume).toHaveBeenCalledTimes(2));

    expect(client.createTailoredResume.mock.calls[0][0].requestId)
      .toBe(client.createTailoredResume.mock.calls[1][0].requestId);
    expect(client.createTailoredResume.mock.calls[0][0].job).toEqual({
      company: 'Acme',
      title: 'Staff Product Engineer',
      description: 'Lead product development.',
    });
    expect(client.createTailoredResume.mock.calls[0][0].job).not.toHaveProperty('url');
    expect(client.createTailoredResume.mock.calls[0][0].model).toBe('provider/test-model');
    expect(client.fillPage).not.toHaveBeenCalled();
    expect(labelled('Resume').value).toBe(tailoredId);
    expect(client.createMapping).toHaveBeenLastCalledWith(
      'context-1', tailoredId, [tailoredDescriptors[0]], { job: { company: 'Acme', title: 'Staff Product Engineer', description: 'Lead product development.' }, model: 'provider/test-model' },
    );
    expect(labelled('Full name').value).toBe('Tailored Jane');
    expect(container.textContent).toContain('Country');
    expect(container.querySelector('.workflow-status')?.textContent)
      .toMatch(/tailored resume created.*review ready/i);
  });

  it('selects a tailored résumé but does not rebuild or fill when the page changes during generation', async () => {
    const before = {
      company: 'Acme', title: 'Engineer', description: 'Build products.',
      url: 'https://jobs.test/one', fingerprint: 'job-one',
    };
    const after = {
      company: 'Other', title: 'Designer', description: 'Design products.',
      url: 'https://jobs.test/two', fingerprint: 'job-two',
    };
    const tailoredId = 'companion-550e8400-e29b-41d4-a716-446655440000';
    const client = makeClient({
      checkConnection: vi.fn()
        .mockResolvedValueOnce({
          connected: true,
          profileId: 'profile-1',
          profileContextId: 'context-1',
          resumes: [{ id: 'resume-1', name: 'Base résumé' }],
        })
        .mockResolvedValueOnce({
          connected: true,
          profileId: 'profile-1',
          profileContextId: 'context-1',
          resumes: [{ id: tailoredId, name: 'Tailored résumé' }],
        }),
      scanPage: vi.fn()
        .mockResolvedValueOnce({ descriptors: [], page: before })
        .mockResolvedValueOnce({ descriptors: [descriptor('name')], page: after }),
      createTailoredResume: vi.fn(async () => ({
        created: true,
        resume: { id: tailoredId, name: 'Tailored résumé' },
      })),
    });
    await renderApp(client, {
      createRequestId: () => '550e8400-e29b-41d4-a716-446655440000',
    });

    await click(button('Tailor resume'));
    await click(button('Create tailored resume'));

    expect(labelled('Resume').value).toBe(tailoredId);
    expect(client.createMapping).not.toHaveBeenCalled();
    expect(client.fillPage).not.toHaveBeenCalled();
    expect(container.querySelector('.workflow-status')?.textContent)
      .toMatch(/page changed.*prepare a new autofill review/i);
  });

  it.each([
    { scenario: 'a different profile', profileId: 'profile-2', currentResumeId: 'resume-2' },
    { scenario: 'a reloaded profile with a reused resume id', profileId: 'profile-1', currentResumeId: 'resume-tailored' },
  ])('discards a tailored result when the refresh observes $scenario', async ({ profileId, currentResumeId }) => {
    const refresh = deferred();
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const page = {
      company: 'Old Company', title: 'Old role', description: 'Build products.',
      url: 'https://jobs.test/one', fingerprint: 'job-one',
    };
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors, page })),
      createMapping: vi.fn(async () => ({
        fields: [mapped('name', 'Old profile answer')], needs_human: [],
      })),
      createTailoredResume: vi.fn(async () => ({
        created: true,
        profileContextId: 'context-1',
        resume: { id: 'resume-tailored', name: 'Private old-profile tailored resume' },
      })),
    });
    await renderApp(client, { heartbeatMs: 0 });
    await scanAndCreate(client);
    expect(labelled('Full name').value).toBe('Old profile answer');
    client.checkConnection.mockImplementationOnce(() => refresh.promise);
    await click(button('Tailor resume'));
    await click(button('Create tailored resume'));
    expect(client.createTailoredResume).toHaveBeenCalledOnce();
    expect(client.checkConnection).toHaveBeenCalledTimes(2);

    // The old-context mutation has succeeded; the app switches before its
    // following connection refresh returns. No background error rejects it.
    await act(async () => refresh.resolve({
      connected: true,
      profileId,
      profileContextId: 'context-2',
      resumes: [{ id: currentResumeId, name: 'Current profile resume' }],
    }));
    await settle();

    expect([...container.querySelector('#resume-picker').options]
      .map((option) => ({ id: option.value, name: option.textContent })))
      .toEqual([{ id: currentResumeId, name: 'Current profile resume' }]);
    expect(container.querySelector('#resume-picker').value).toBe(currentResumeId);
    expect(container.textContent).not.toContain('Private old-profile tailored resume');
    expect(container.textContent).toMatch(/reloaded or switched profiles/i);
    expect(client.scanPage).toHaveBeenCalledTimes(2);
    expect(client.createMapping).toHaveBeenCalledOnce();
    expect(client.fillPage).not.toHaveBeenCalled();
    await click(button('Autofill'));
    expect(container.querySelector('.review-list')).toBeNull();
    expect(button('Prepare autofill review').disabled).toBe(false);

    await click(button('Prepare autofill review'));
    expect(client.createMapping).toHaveBeenLastCalledWith(
      'context-2', currentResumeId, descriptors, expect.any(Object),
    );
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


describe('first-use disclosure', () => {
  it('shows data-use disclosure before accessing the app or page', async () => {
    const client = makeClient({ getPrivacyConsent: vi.fn(async () => ({ accepted: false })) });
    await act(async () => { root.render(<App client={client} />); });
    await settle();
    expect(container.textContent).toContain('Before you connect');
    expect(container.textContent).toContain('OpenRouter');
    expect(client.checkConnection).not.toHaveBeenCalled();
    expect(client.scanPage).not.toHaveBeenCalled();
    await click(button('Agree and continue'));
    await waitFor(() => expect(client.checkConnection).toHaveBeenCalledOnce());
    expect(client.acceptPrivacyConsent).toHaveBeenCalledOnce();
  });

  it('disconnects, clears the workspace and returns to the disclosure', async () => {
    const client = makeClient();
    await renderApp(client);
    await click(button('Disconnect'));
    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Before you connect');
    expect(container.querySelector('#resume-picker')).toBeNull();
    expect(container.textContent).toContain('App access revoked');
  });
});


describe('focused application workspace', () => {
  it('keeps tailoring separate from autofill and moves connection actions into Settings', async () => {
    await renderApp(makeClient());
    expect(button('Prepare autofill review')).toBeTruthy();
    expect(container.textContent).toContain('Autofill uses Test model.');
    expect(container.querySelector('#tailor-workflow')).toBeNull();
    expect(labelled('Resume to fill from').closest('#autofill-workflow')).toBeTruthy();
    expect(labelled('AI model').closest('#autofill-workflow')).toBeTruthy();
    expect(container.querySelector('.workflow-switcher').compareDocumentPosition(labelled('Resume to fill from')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button('Disconnect').closest('details').open).toBe(false);
    expect(container.querySelector('.panel-footer a').textContent).toBe('Privacy');
    await click(button('Tailor resume'));
    expect(button('Analyze fit')).toBeTruthy();
    expect(button('Create tailored resume')).toBeTruthy();
    expect(labelled('Base resume').closest('#tailor-workflow')).toBeTruthy();
    expect(labelled('AI model').closest('#tailor-workflow')).toBeTruthy();
    expect(container.textContent).toContain('Creates a new copy. Your base resume stays unchanged.');
    expect(container.querySelector('#autofill-workflow')).toBeNull();
  });

  it('sends job context and the selected model, labels draft answers, and clears review on model change', async () => {
    const page = { title: 'Designer', company: 'Acme', description: 'Design accessible tools.' };
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors: [descriptor('interest', { label: 'What interests you about this role?', type: 'textarea' })], page })),
      createMapping: vi.fn(async () => ({ fields: [mapped('interest', 'I would bring my experience with accessible design.', 0.85, 'draft')], needs_human: [] })),
    });
    await renderApp(client);
    await change(labelled('AI model'), 'provider/test-model');
    await scanAndCreate(client);
    expect(client.createMapping).toHaveBeenCalledWith('context-1', 'resume-1', expect.any(Array), {
      job: { company: 'Acme', title: 'Designer', description: 'Design accessible tools.' },
      model: 'provider/test-model',
    });
    expect(labelled('What interests you about this role?').tagName).toBe('TEXTAREA');
    expect(container.textContent).toContain('AI draft — review before filling');
    await change(labelled('What interests you about this role?'), 'Reviewed motivation answer.');
    await click(button('Fill reviewed fields'));
    expect(client.fillPage).toHaveBeenCalledWith('context-1', 'resume-1', [{ field_id: 'interest', value: 'Reviewed motivation answer.' }], expect.any(Object));
    await click(button('Reset to app defaults'));
    expect(container.querySelector('.review-list')).toBeNull();
    expect(button('Prepare autofill review')).toBeTruthy();
  });

  it('does not reuse a manual job description after the application page changes', async () => {
    const firstPage = { company: 'First', title: 'Designer', description: '', url: 'https://jobs.test/one', fingerprint: 'first' };
    const nextPage = { company: 'Second', title: 'Engineer', description: '', url: 'https://jobs.test/two', fingerprint: 'second' };
    const client = makeClient({
      scanPage: vi.fn()
        .mockResolvedValueOnce({ descriptors: [], page: firstPage })
        .mockResolvedValueOnce({ descriptors: [descriptor('name')], page: nextPage }),
    });
    await renderApp(client);
    await click(button('Tailor resume'));
    await click(button('Analyze fit'));
    await change(labelled('Job description'), 'A description only for the first role.');
    await click(button('Autofill'));
    await click(button('Prepare autofill review'));
    expect(client.createMapping).toHaveBeenCalledWith('context-1', 'resume-1', expect.any(Array), {
      job: { company: 'Second', title: 'Engineer', description: '' },
    });
    await click(button('Tailor resume'));
    expect(labelled('Job description').value).toBe('');
  });

  it('shows the selected default model and preserves task defaults until explicitly changed', async () => {
    const client = makeClient({
      getAIModels: vi.fn(async () => ({
        models: [{ id: 'provider/mapping', name: 'Mapping model' }, { id: 'provider/tailoring', name: 'Tailoring model' }],
        defaults: { mapping: 'provider/mapping', analysis: 'provider/mapping', tailoring: 'provider/tailoring' },
      })),
      scanPage: vi.fn(async () => ({ descriptors: [descriptor('name')], page: { description: 'Build accessible products.' } })),
    });
    await renderApp(client);
    expect(labelled('AI model').value).toBe('provider/mapping');
    expect([...labelled('AI model').options].map((option) => option.textContent)).toEqual(['Mapping model', 'Tailoring model']);
    await scanAndCreate(client);
    expect(client.createMapping.mock.calls[0][3]).not.toHaveProperty('model');
    await click(button('Tailor resume'));
    expect(labelled('AI model').value).toBe('provider/tailoring');
    await click(button('Analyze fit'));
    expect(client.analyzeJobFit.mock.calls[0][0]).not.toHaveProperty('model');
  });

  it('shows a model loading error and lets the user retry successfully', async () => {
    const client = makeClient({
      getAIModels: vi.fn()
        .mockRejectedValueOnce(new RuntimeMessageError({ message: 'The app bridge returned an invalid model response.', code: 'invalid_response' }))
        .mockResolvedValueOnce({ models: [{ id: 'provider/recovered', name: 'Recovered model' }], defaults: { mapping: 'provider/recovered' } }),
    });
    await renderApp(client);
    expect(container.textContent).toContain('The app bridge returned an invalid model response.');
    expect(labelled('AI model').disabled).toBe(true);
    await click(button('Retry loading models'));
    await waitFor(() => expect(labelled('AI model').disabled).toBe(false));
    expect(labelled('AI model').value).toBe('provider/recovered');
    expect(client.getAIModels).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('The app bridge returned an invalid model response.');
  });

  it('falls back to app settings when an older app has no model catalog', async () => {
    const client = makeClient({ getAIModels: vi.fn(async () => { throw new RuntimeMessageError({ message: 'Not found', status: 404 }); }) });
    await renderApp(client);
    expect(labelled('AI model').disabled).toBe(true);
    expect(container.textContent).toContain('Uses your AI settings in On Paper. Update the app to choose a model here.');
    expect(container.querySelector('[role="alert"]').textContent).toContain('Not found');
    expect(button('Retry loading models')).toBeTruthy();
    expect(button('Prepare autofill review').disabled).toBe(false);
  });
});


describe('connection recovery and review polish', () => {
  it('checks the connection again without launching the app', async () => {
    const client = makeClient({
      checkConnection: vi.fn()
        .mockRejectedValueOnce(new RuntimeMessageError({ message: 'On Paper is not running.', code: 'app_unavailable', retryable: true }))
        .mockResolvedValueOnce({ connected: true, profileContextId: 'restored', resumes: [{ id: 'resume-1', name: 'Resume' }] }),
    });
    await renderApp(client);
    await click(button('Check connection again'));
    expect(client.checkConnection).toHaveBeenCalledTimes(2);
    expect(client.openApp).not.toHaveBeenCalled();
    expect(labelled('Resume').value).toBe('resume-1');
  });

  it.each(['resolve', 'reject'])('keeps manual recovery visible and ignores a late automatic %s after cancellation', async (completion) => {
    const opening = deferred();
    const cancelling = deferred();
    const client = makeClient({
      checkConnection: vi.fn(async () => ({ connected: false, resumes: [] })),
      openApp: vi.fn(() => opening.promise),
      cancelPairing: vi.fn(() => cancelling.promise),
    });
    await renderApp(client);
    await click(button('Open and connect'));
    expect(container.querySelector('.pairing-section')).toBeTruthy();
    expect(labelled('Pairing token').disabled).toBe(true);
    await click(button('Cancel and pair manually'));
    expect(labelled('Pairing token').disabled).toBe(true);
    cancelling.resolve({ cancelled: true });
    await settle();
    expect(container.querySelector('.manual-pairing').open).toBe(true);
    expect(labelled('Pairing token').disabled).toBe(false);
    await change(labelled('Pairing token'), 'manual-token');
    await click(button('Pair with token'));
    expect(client.savePairing).toHaveBeenCalledWith('manual-token');
    expect(labelled('Resume').value).toBe('resume-1');
    if (completion === 'resolve') opening.resolve({ connected: false, resumes: [] });
    else opening.reject(new RuntimeMessageError({ message: 'Old attempt expired.', code: 'pairing_timeout' }));
    await settle();
    expect(labelled('Resume').value).toBe('resume-1');
    expect(container.textContent).not.toContain('Old attempt expired.');
    expect(container.querySelector('.pairing-section')).toBeNull();
  });

  it('provides a resume-empty state and read-only refresh after connecting', async () => {
    const client = makeClient({ checkConnection: vi.fn(async () => ({ connected: true, resumes: [], profileContextId: 'context-1' })) });
    await renderApp(client);
    expect(container.textContent).toContain('Add a resume in On Paper');
    await click(button('Check connection again'));
    expect(client.checkConnection).toHaveBeenCalledTimes(2);
    expect(client.openApp).not.toHaveBeenCalled();
  });

  it('filters a large model catalog by name or provider without changing the selected model', async () => {
    const models = Array.from({ length: 25 }, (_, index) => ({ id: `provider/model-${index}`, name: `Model ${index}` }));
    models.push({ id: 'other/standout', name: 'Distinctive choice' });
    const client = makeClient({ getAIModels: vi.fn(async () => ({ models, defaults: { mapping: 'provider/model-0', analysis: 'provider/model-0', tailoring: 'provider/model-0' } })) });
    await renderApp(client);
    await change(labelled('Search AI models'), 'other/');
    expect([...labelled('AI model').options].map((option) => option.value)).toEqual(['provider/model-0', 'other/standout']);
    expect(labelled('AI model').value).toBe('provider/model-0');
    await change(labelled('Search AI models'), 'no such model');
    expect(labelled('AI model').value).toBe('provider/model-0');
    expect(container.textContent).toContain('No models match. Your selected model is unchanged.');
    await change(labelled('Search AI models'), 'Distinctive');
    await change(labelled('AI model'), 'other/standout');
    expect(labelled('Search AI models').value).toBe('');
    await click(button('Tailor resume'));
    expect(labelled('AI model').value).toBe('other/standout');
  });

  it('counts unanswered editable fields separately from fields that must be answered on the page', async () => {
    const client = makeClient({
      scanPage: vi.fn(async () => ({ descriptors: [
        descriptor('name', { label: 'Full name' }),
        descriptor('availability', { label: 'Availability', type: 'select', options: [{ value: 'month', label: 'Next month' }] }),
        descriptor('gender', { label: 'Gender identity', type: 'select' }),
      ], page: {} })),
      createMapping: vi.fn(async () => ({ fields: [mapped('name', 'Jordan')], needs_human: [{ field_id: 'availability', question: 'When can you start?' }] })),
    });
    await renderApp(client);
    await scanAndCreate(client);
    expect(container.querySelector('.workflow-status').textContent).toContain('1 requires manual entry; 1 needs your answer');
    expect(container.textContent).toContain('Needs your answer');
    await change(labelled('Availability'), 'month');
    expect(container.querySelector('.workflow-status').textContent).not.toContain('needs your answer');
    expect(container.querySelector('.workflow-status').textContent).toContain('1 requires manual entry');
  });
});


describe('review page binding', () => {
  it('uses the original immutable scan context after edits and a later job scan', async () => {
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const page = { tabId: 12, url: 'https://jobs.test/first', fingerprint: 'first', company: 'First', title: 'Designer', description: 'First role' };
    const expectedContext = structuredClone({ descriptors, page });
    const client = makeClient({
      scanPage: vi.fn()
        .mockResolvedValueOnce({ descriptors, page })
        .mockResolvedValueOnce({ descriptors: [], page: { tabId: 13, url: 'https://jobs.test/second', fingerprint: 'second', company: 'Second', title: 'Engineer', description: 'Second role' } }),
      createMapping: vi.fn(async () => ({ fields: [mapped('name', 'Jordan')], needs_human: [] })),
    });
    await renderApp(client);
    await scanAndCreate(client);
    page.fingerprint = 'mutated';
    descriptors[0].label = 'Changed field';
    await change(labelled('Full name'), 'Reviewed Jordan');
    await click(button('Tailor resume'));
    await click(button('Analyze fit'));
    await click(button('Autofill'));
    await click(button('Fill reviewed fields'));
    expect(client.fillPage).toHaveBeenCalledWith('context-1', 'resume-1', [{ field_id: 'name', value: 'Reviewed Jordan' }], expectedContext);
  });

  it('refreshes a stale review before another fill without launching the app or reusing the old page', async () => {
    const descriptors = [descriptor('name', { label: 'Full name' })];
    const first = { tabId: 12, url: 'https://jobs.test/first', fingerprint: 'first' };
    const second = { tabId: 13, url: 'https://jobs.test/second', fingerprint: 'second' };
    const client = makeClient({
      scanPage: vi.fn().mockResolvedValueOnce({ descriptors, page: first }).mockResolvedValueOnce({ descriptors, page: second }),
      createMapping: vi.fn().mockResolvedValueOnce({ fields: [mapped('name', 'Old Jordan')], needs_human: [] }).mockResolvedValueOnce({ fields: [mapped('name', 'Fresh Jordan')], needs_human: [] }),
      fillPage: vi.fn().mockRejectedValueOnce(new RuntimeMessageError({ message: 'The application changed. Prepare a fresh review.', code: 'stale_review' })).mockResolvedValueOnce({ filled: ['name'], unfilled: [] }),
    });
    await renderApp(client);
    await scanAndCreate(client);
    await click(button('Fill reviewed fields'));
    expect(labelled('Full name').value).toBe('Old Jordan');
    await click(button('Refresh review'));
    expect(client.fillPage).toHaveBeenCalledTimes(1);
    expect(client.openApp).not.toHaveBeenCalled();
    expect(labelled('Full name').value).toBe('Fresh Jordan');
    await click(button('Fill reviewed fields'));
    expect(client.fillPage).toHaveBeenLastCalledWith('context-1', 'resume-1', [{ field_id: 'name', value: 'Fresh Jordan' }], { page: second, descriptors });
  });
});


describe('idempotent application logging', () => {
  const requestIds = ['550e8400-e29b-41d4-a716-446655440000', '650e8400-e29b-41d4-a716-446655440000'];
  function loggingClient() {
    return makeClient({
      scanPage: vi.fn(async () => ({ descriptors: [descriptor('name', { label: 'Full name' })], page: { url: 'https://jobs.test/one', fingerprint: 'form-one', company: 'Acme', title: 'Engineer' } })),
      createMapping: vi.fn(async () => ({ fields: [mapped('name', 'Jane')], needs_human: [] })),
      fillPage: vi.fn(async () => ({ filled: ['name'], unfilled: [] })),
      logApplication: vi.fn().mockRejectedValueOnce(new RuntimeMessageError({ message: 'Response was lost', code: 'app_timeout', status: 504, retryable: true })).mockResolvedValue({ application: { id: 'app-1' } }),
    });
  }
  async function readyToLog() {
    await click(button('Prepare autofill review'));
    await waitFor(() => expect(button('Fill reviewed fields').disabled).toBe(false));
    await click(button('Fill reviewed fields'));
    await waitFor(() => expect(button('Log application').disabled).toBe(false));
  }
  async function firstTimeout(client) {
    await click(button('Log application'));
    await waitFor(() => expect(client.logApplication).toHaveBeenCalledOnce());
    await waitFor(() => expect(button('Log application').disabled).toBe(false));
  }
  async function successfulRetry(client) {
    await click(button('Log application'));
    await waitFor(() => expect(button('Application logged').disabled).toBe(true));
    expect(client.logApplication).toHaveBeenCalledTimes(2);
  }
  function sessionStorage() {
    const data = {};
    return {
      data,
      get: vi.fn(async (key) => ({ [key]: data[key] })),
      set: vi.fn(async (values) => Object.assign(data, values)),
      remove: vi.fn(async (key) => { delete data[key]; }),
    };
  }
  const requestIdsSent = (client) => client.logApplication.mock.calls.map(([payload]) => payload.requestId);
  const requestIdFactory = () => vi.fn().mockReturnValueOnce(requestIds[0]).mockReturnValueOnce(requestIds[1]);

  it('reuses the request after a timeout and reconnect', async () => {
    const client = loggingClient();
    const createRequestId = requestIdFactory();
    await renderApp(client, { heartbeatMs: 0, createRequestId });
    await readyToLog();
    await firstTimeout(client);
    await successfulRetry(client);
    expect(requestIdsSent(client)).toEqual([requestIds[0], requestIds[0]]);
    expect(createRequestId).toHaveBeenCalledOnce();
  });

  it('retains pending identity and edited job details through a same-profile restart and refreshed form', async () => {
    const client = loggingClient();
    const createRequestId = requestIdFactory();
    await renderApp(client, { heartbeatMs: 0, createRequestId });
    await readyToLog();
    await change(labelled('Role title'), 'User-edited role');
    await firstTimeout(client);
    client.checkConnection.mockResolvedValue({ connected: true, profileId: 'profile-1', profileContextId: 'context-2', resumes: [{ id: 'resume-1', name: 'Backend résumé' }] });
    client.scanPage.mockResolvedValue({ descriptors: [descriptor('name', { label: 'Full name' })], page: { url: 'https://jobs.test/one', fingerprint: 'form-changed', company: 'Acme', title: 'Engineer' } });
    await click(button('Log application'));
    await readyToLog();
    expect(labelled('Role title').value).toBe('User-edited role');
    await successfulRetry(client);
    expect(client.logApplication.mock.calls.map(([payload]) => [payload.profileContextId, payload.requestId])).toEqual([['context-1', requestIds[0]], ['context-2', requestIds[0]]]);
  });

  it('requires Start over when a refreshed page reports a different job while a log is unresolved', async () => {
    const client = loggingClient();
    await renderApp(client, { heartbeatMs: 0, createRequestId: requestIdFactory() });
    await readyToLog();
    await firstTimeout(client);
    client.checkConnection.mockResolvedValue({ connected: true, profileId: 'profile-1', profileContextId: 'context-2', resumes: [{ id: 'resume-1', name: 'Backend résumé' }] });
    client.scanPage.mockResolvedValue({ descriptors: [descriptor('name', { label: 'Full name' })], page: { url: 'https://jobs.test/one', fingerprint: 'form-changed', company: 'Another company', title: 'Designer' } });
    await click(button('Log application'));
    await readyToLog();
    expect(labelled('Company').value).toBe('Another company');
    expect(labelled('Role title').value).toBe('Designer');
    await click(button('Log application'));
    await waitFor(() => expect(container.textContent).toContain('An earlier application log may have completed.'));
    expect(client.logApplication).toHaveBeenCalledOnce();
    await click(button('Start over'));
    await readyToLog();
    await successfulRetry(client);
    expect(requestIdsSent(client)).toEqual(requestIds);
  });

  it.each([['Company', 'Another company'], ['Role title', 'Senior Engineer']])('requires Start over before logging a changed %s after a timeout', async (label, value) => {
    const client = loggingClient();
    const createRequestId = requestIdFactory();
    const applicationRequestStorage = sessionStorage();
    await renderApp(client, { heartbeatMs: 0, createRequestId, applicationRequestStorage });
    await readyToLog();
    await firstTimeout(client);
    const stored = structuredClone(applicationRequestStorage.data);
    await change(labelled(label), value);
    await click(button('Log application'));
    await waitFor(() => expect(container.textContent).toContain('An earlier application log may have completed.'));
    expect(client.logApplication).toHaveBeenCalledOnce();
    expect(createRequestId).toHaveBeenCalledOnce();
    expect(applicationRequestStorage.data).toEqual(stored);
    await click(button('Start over'));
    await readyToLog();
    await change(labelled(label), value);
    await successfulRetry(client);
    expect(requestIdsSent(client)).toEqual(requestIds);
    expect(client.logApplication.mock.calls[1][0][label === 'Company' ? 'company' : 'title']).toBe(value);
  });

  it('uses a new identity after explicitly starting a new review', async () => {
    const client = loggingClient();
    await renderApp(client, { heartbeatMs: 0, createRequestId: requestIdFactory() });
    await readyToLog();
    await firstTimeout(client);
    await click(button('Start over'));
    await readyToLog();
    await successfulRetry(client);
    expect(requestIdsSent(client)).toEqual(requestIds);
  });

  it('recovers only hashed pending identity after closing and reopening the panel', async () => {
    const client = loggingClient();
    const applicationRequestStorage = sessionStorage();
    const createRequestId = requestIdFactory();
    await renderApp(client, { heartbeatMs: 0, createRequestId, applicationRequestStorage });
    await readyToLog();
    await firstTimeout(client);
    const stored = JSON.stringify(applicationRequestStorage.data);
    expect(stored).toContain(requestIds[0]);
    for (const privateValue of ['Acme', 'Engineer', 'jobs.test', 'Jane']) expect(stored).not.toContain(privateValue);
    await act(async () => root.unmount());
    root = createRoot(container);
    client.checkConnection.mockClear();
    await renderApp(client, { heartbeatMs: 0, createRequestId, applicationRequestStorage });
    await readyToLog();
    await successfulRetry(client);
    expect(requestIdsSent(client)).toEqual([requestIds[0], requestIds[0]]);
    await waitFor(() => expect(applicationRequestStorage.data).toEqual({}));
  });

  it.each(['Start over', 'restore details'])('blocks a mismatched restored intent until the user chooses to %s', async (recovery) => {
    const client = loggingClient();
    const applicationRequestStorage = sessionStorage();
    const createRequestId = requestIdFactory();
    await renderApp(client, { heartbeatMs: 0, createRequestId, applicationRequestStorage });
    await readyToLog();
    await change(labelled('Role title'), 'User-edited role');
    await firstTimeout(client);
    const stored = structuredClone(applicationRequestStorage.data);
    await act(async () => root.unmount());
    root = createRoot(container);
    client.checkConnection.mockClear();
    await renderApp(client, { heartbeatMs: 0, createRequestId, applicationRequestStorage });
    await readyToLog();
    expect(labelled('Role title').value).toBe('Engineer');
    await click(button('Log application'));
    await waitFor(() => expect(container.textContent).toContain('An earlier application log may have completed. Check On Paper, then choose Start over before logging another application.'));
    expect(client.logApplication).toHaveBeenCalledOnce();
    expect(createRequestId).toHaveBeenCalledOnce();
    expect(applicationRequestStorage.data).toEqual(stored);
    if (recovery === 'Start over') {
      await click(button('Start over'));
      await readyToLog();
    } else {
      await change(labelled('Role title'), 'User-edited role');
    }
    await successfulRetry(client);
    expect(requestIdsSent(client)).toEqual(recovery === 'Start over' ? requestIds : [requestIds[0], requestIds[0]]);
  });

  it('waits for stored identity before dispatching after a panel restart', async () => {
    const client = loggingClient();
    const applicationRequestStorage = sessionStorage();
    await renderApp(client, { heartbeatMs: 0, createRequestId: () => requestIds[0], applicationRequestStorage });
    await readyToLog();
    await firstTimeout(client);
    await act(async () => root.unmount());
    root = createRoot(container);
    client.checkConnection.mockClear();
    const storedIdentity = deferred();
    applicationRequestStorage.get.mockImplementation(() => storedIdentity.promise);
    await renderApp(client, { heartbeatMs: 0, createRequestId: () => requestIds[1], applicationRequestStorage });
    await readyToLog();
    await click(button('Log application'));
    expect(client.logApplication).toHaveBeenCalledOnce();
    storedIdentity.resolve({ ...applicationRequestStorage.data });
    await waitFor(() => expect(client.logApplication).toHaveBeenCalledTimes(2));
    expect(client.logApplication.mock.calls[1][0].requestId).toBe(requestIds[0]);
  });

  it.each(['not_paired', 'unauthorized'])('retains only opaque retry identity after %s and restores a non-first resume after re-pairing', async (code) => {
    const client = loggingClient();
    const applicationRequestStorage = sessionStorage();
    const createRequestId = requestIdFactory();
    const resumes = [{ id: 'resume-1', name: 'Backend résumé' }, { id: 'resume-2', name: 'Frontend résumé' }];
    client.checkConnection.mockResolvedValue({ connected: true, profileId: 'profile-1', profileContextId: 'context-1', resumes });
    client.logApplication.mockReset().mockRejectedValueOnce(new RuntimeMessageError({ message: 'Pairing was revoked after the save started', code })).mockResolvedValue({ application: { id: 'app-1' } });
    await renderApp(client, { heartbeatMs: 0, createRequestId, applicationRequestStorage });
    await change(labelled('Resume'), 'resume-2');
    await readyToLog();
    await change(labelled('Role title'), 'User-edited role');
    await click(button('Log application'));
    await waitFor(() => expect(labelled('Pairing token')).toBeTruthy());
    const stored = structuredClone(applicationRequestStorage.data);
    expect(stored['pendingApplicationRequest:4']).toMatchObject({ profileId: 'profile-1', requestId: requestIds[0] });
    expect(JSON.stringify(stored)).not.toMatch(/User-edited role|Acme|resume-2/);
    client.savePairing.mockResolvedValue({ connected: true, profileId: 'profile-1', profileContextId: 'context-2', resumes });
    client.checkConnection.mockResolvedValue({ connected: true, profileId: 'profile-1', profileContextId: 'context-2', resumes });
    await change(labelled('Pairing token'), 'new-token');
    await click(button('Pair with token'));
    await readyToLog();
    await click(button('Log application'));
    await waitFor(() => expect(container.textContent).toContain('An earlier application log may have completed.'));
    expect(client.logApplication).toHaveBeenCalledOnce();
    await change(labelled('Resume'), 'resume-2');
    await readyToLog();
    // Disconnect drops editable draft text; only the matching details can retry.
    expect(labelled('Role title').value).toBe('Engineer');
    await click(button('Log application'));
    await waitFor(() => expect(container.textContent).toContain('An earlier application log may have completed.'));
    expect(client.logApplication).toHaveBeenCalledOnce();
    expect(applicationRequestStorage.data).toEqual(stored);
    await change(labelled('Role title'), 'User-edited role');
    await successfulRetry(client);
    expect(requestIdsSent(client)).toEqual([requestIds[0], requestIds[0]]);
    expect(createRequestId).toHaveBeenCalledOnce();
  });

  it.each(['panel reopen', 'desktop restart', 'resume selection'])('preserves unresolved identity while restoring a non-first resume after %s', async (transition) => {
    const client = loggingClient();
    const applicationRequestStorage = sessionStorage();
    const createRequestId = requestIdFactory();
    const resumes = [{ id: 'resume-1', name: 'Backend résumé' }, { id: 'resume-2', name: 'Frontend résumé' }];
    client.checkConnection.mockResolvedValue({ connected: true, profileId: 'profile-1', profileContextId: 'context-1', resumes });
    await renderApp(client, { heartbeatMs: 0, createRequestId, applicationRequestStorage });
    await change(labelled('Resume'), 'resume-2');
    await readyToLog();
    await firstTimeout(client);
    const stored = structuredClone(applicationRequestStorage.data);
    if (transition === 'panel reopen') {
      await act(async () => root.unmount());
      root = createRoot(container);
      client.checkConnection.mockClear();
      await renderApp(client, { heartbeatMs: 0, createRequestId, applicationRequestStorage });
    } else if (transition === 'desktop restart') {
      client.checkConnection.mockResolvedValue({ connected: true, profileId: 'profile-1', profileContextId: 'context-2', resumes });
      await click(button('Log application'));
    } else {
      await change(labelled('Resume'), 'resume-1');
    }
    expect(labelled('Resume').value).toBe('resume-1');
    await readyToLog();
    await click(button('Log application'));
    await waitFor(() => expect(container.textContent).toContain('An earlier application log may have completed.'));
    expect(client.logApplication).toHaveBeenCalledOnce();
    expect(applicationRequestStorage.data).toEqual(stored);
    await change(labelled('Resume'), 'resume-2');
    await readyToLog();
    await successfulRetry(client);
    expect(requestIdsSent(client)).toEqual([requestIds[0], requestIds[0]]);
    expect(createRequestId).toHaveBeenCalledOnce();
  });

  it('uses a new identity after changing the actual profile', async () => {
    const client = loggingClient();
    const applicationRequestStorage = sessionStorage();
    await renderApp(client, { heartbeatMs: 0, createRequestId: requestIdFactory(), applicationRequestStorage });
    await readyToLog();
    await firstTimeout(client);
    client.checkConnection.mockResolvedValue({ connected: true, profileId: 'profile-2', profileContextId: 'context-2', resumes: [{ id: 'resume-1', name: 'Other profile résumé' }] });
    await click(button('Log application'));
    await waitFor(() => expect(applicationRequestStorage.data).toEqual({}));
    await readyToLog();
    await successfulRetry(client);
    expect(requestIdsSent(client)).toEqual(requestIds);
  });

  it('waits for delayed Start over cleanup before permitting another log', async () => {
    const client = loggingClient();
    const applicationRequestStorage = sessionStorage();
    await renderApp(client, { heartbeatMs: 0, createRequestId: requestIdFactory(), applicationRequestStorage });
    await readyToLog();
    await firstTimeout(client);
    const cleanup = deferred();
    applicationRequestStorage.remove.mockImplementationOnce(async (key) => { await cleanup.promise; delete applicationRequestStorage.data[key]; });
    await click(button('Start over'));
    await click(button('Log application'));
    expect(client.logApplication).toHaveBeenCalledOnce();
    cleanup.resolve();
    await waitFor(() => expect(button('Prepare autofill review').disabled).toBe(false));
    await readyToLog();
    await successfulRetry(client);
    expect(requestIdsSent(client)).toEqual(requestIds);
  });

  it('preserves retry identity when Start over cleanup fails', async () => {
    const client = loggingClient();
    const applicationRequestStorage = sessionStorage();
    const createRequestId = requestIdFactory();
    await renderApp(client, { heartbeatMs: 0, createRequestId, applicationRequestStorage });
    await readyToLog();
    await firstTimeout(client);
    const stored = structuredClone(applicationRequestStorage.data);
    applicationRequestStorage.remove.mockRejectedValueOnce(new Error('Could not clear pending identity'));
    await click(button('Start over'));
    await waitFor(() => expect(container.textContent).toContain('Could not clear pending identity'));
    expect(button('Log application').disabled).toBe(false);
    expect(applicationRequestStorage.data).toEqual(stored);
    await successfulRetry(client);
    expect(requestIdsSent(client)).toEqual([requestIds[0], requestIds[0]]);
    expect(createRequestId).toHaveBeenCalledOnce();
  });

  it.each(['Start over', 'successful log'])('keeps window A retry identity when window B performs %s', async (action) => {
    const applicationRequestStorage = sessionStorage();
    const clientA = loggingClient();
    const createRequestIdA = requestIdFactory();
    await renderApp(clientA, { heartbeatMs: 0, createRequestId: createRequestIdA, applicationRequestStorage });
    await readyToLog();
    await firstTimeout(clientA);
    const storedA = structuredClone(applicationRequestStorage.data);
    const panelA = { root, container };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    try {
      const clientB = loggingClient();
      clientB.logApplication.mockReset().mockResolvedValue({ application: { id: 'app-2' } });
      await renderApp(clientB, { heartbeatMs: 0, createRequestId: () => requestIds[1], applicationRequestStorage, windowApi: { getCurrent: vi.fn(async () => ({ id: 8 })) } });
      await readyToLog();
      if (action === 'Start over') await click(button('Start over'));
      else {
        await click(button('Log application'));
        await waitFor(() => expect(button('Application logged').disabled).toBe(true));
        expect(requestIdsSent(clientB)).toEqual([requestIds[1]]);
      }
      expect(applicationRequestStorage.data).toEqual(storedA);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      ({ root, container } = panelA);
    }
    // Closing and reopening A still restores its own original request.
    await act(async () => root.unmount());
    root = createRoot(container);
    clientA.checkConnection.mockClear();
    await renderApp(clientA, { heartbeatMs: 0, createRequestId: createRequestIdA, applicationRequestStorage });
    await readyToLog();
    await successfulRetry(clientA);
    expect(requestIdsSent(clientA)).toEqual([requestIds[0], requestIds[0]]);
    expect(createRequestIdA).toHaveBeenCalledOnce();
  });

  it('waits for the containing window before enabling application logging', async () => {
    const client = loggingClient();
    const containingWindow = deferred();
    const windowApi = { getCurrent: vi.fn(() => containingWindow.promise) };
    const applicationRequestStorage = sessionStorage();
    await renderApp(client, { heartbeatMs: 0, windowApi, applicationRequestStorage });
    await click(button('Prepare autofill review'));
    await click(button('Fill reviewed fields'));
    expect(button('Log application').disabled).toBe(true);
    await click(button('Log application'));
    expect(client.logApplication).not.toHaveBeenCalled();
    expect(applicationRequestStorage.set).not.toHaveBeenCalled();
    containingWindow.resolve({ id: 4 });
    await waitFor(() => expect(button('Log application').disabled).toBe(false));
    await firstTimeout(client);
    expect(Object.keys(applicationRequestStorage.data)).toEqual(['pendingApplicationRequest:4']);
  });

  it.each([undefined, -1, -2, '4'])('does not use a shared fallback when the window ID is %s', async (id) => {
    const client = loggingClient();
    const applicationRequestStorage = sessionStorage();
    await renderApp(client, { heartbeatMs: 0, applicationRequestStorage, windowApi: { getCurrent: vi.fn(async () => ({ id })) } });
    await click(button('Prepare autofill review'));
    await click(button('Fill reviewed fields'));
    expect(button('Log application').disabled).toBe(true);
    await click(button('Log application'));
    expect(client.logApplication).not.toHaveBeenCalled();
    expect(applicationRequestStorage.set).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Application logging is unavailable. Close and reopen this panel to retry.');
  });

  it.each(['missing API', 'rejected lookup'])('keeps logging unavailable after a %s', async (failure) => {
    const client = loggingClient();
    const applicationRequestStorage = sessionStorage();
    const windowApi = failure === 'missing API' ? null : { getCurrent: vi.fn().mockRejectedValue(new Error('Window unavailable')) };
    await renderApp(client, { heartbeatMs: 0, applicationRequestStorage, windowApi });
    await click(button('Prepare autofill review'));
    await click(button('Fill reviewed fields'));
    expect(button('Log application').disabled).toBe(true);
    await click(button('Log application'));
    expect(client.logApplication).not.toHaveBeenCalled();
    expect(applicationRequestStorage.set).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Application logging is unavailable. Close and reopen this panel to retry.');
  });

  it('does not dispatch a mutation when pending identity cannot be retained', async () => {
    const client = loggingClient();
    const applicationRequestStorage = sessionStorage();
    applicationRequestStorage.set.mockRejectedValue(new Error('Session storage unavailable'));
    await renderApp(client, { heartbeatMs: 0, applicationRequestStorage });
    await readyToLog();
    await click(button('Log application'));
    await waitFor(() => expect(container.textContent).toContain('Session storage unavailable'));
    expect(client.logApplication).not.toHaveBeenCalled();
  });
});
