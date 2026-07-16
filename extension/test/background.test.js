import { describe, expect, it, vi } from 'vitest';

import { BridgeError } from '../src/bridgeClient.js';
import { createBackgroundService } from '../src/background.js';

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

function createChrome({
  token = '',
  tab = { id: 17, windowId: 4, url: 'https://jobs.example.test/apply' },
  contentResponse,
} = {}) {
  let storedToken = token;
  const listeners = {};
  const chromeApi = {
    action: {
      onClicked: {
        addListener: vi.fn((listener) => {
          listeners.action = listener;
        }),
      },
    },
    runtime: {
      onMessage: {
        addListener: vi.fn((listener) => {
          listeners.runtime = listener;
        }),
      },
    },
    sidePanel: {
      open: vi.fn(async () => undefined),
    },
    scripting: {
      executeScript: vi.fn(async () => []),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({ bridgeToken: storedToken })),
        set: vi.fn(async (value) => {
          storedToken = value.bridgeToken;
        }),
      },
    },
    tabs: {
      query: vi.fn(async () => (tab ? [tab] : [])),
      sendMessage: vi.fn(async (_tabId, message) => (
        typeof contentResponse === 'function' ? contentResponse(message) : contentResponse
      )),
    },
  };

  return { chromeApi, listeners, getStoredToken: () => storedToken };
}

async function callRuntime(listener, message) {
  const sendResponse = vi.fn();
  expect(listener(message, {}, sendResponse)).toBe(true);
  await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
  return { response: sendResponse.mock.calls[0][0], sendResponse };
}

const PDF_FIELD = [{ field_id: 'resume-file', value: '__resume_pdf__' }];

describe('createBackgroundService', () => {
  it('installs action and runtime listeners exactly once per service', async () => {
    const { chromeApi, listeners } = createChrome();
    const service = createBackgroundService({ chromeApi, fetchImpl: vi.fn() });

    service.install();
    service.install();

    expect(chromeApi.action.onClicked.addListener).toHaveBeenCalledOnce();
    expect(chromeApi.runtime.onMessage.addListener).toHaveBeenCalledOnce();
    listeners.action({ windowId: 9 });
    await vi.waitFor(() => expect(chromeApi.sidePanel.open).toHaveBeenCalledWith({ windowId: 9 }));
  });

  it('returns false and sends no response for unknown or submit-like messages', () => {
    const { chromeApi } = createChrome();
    const service = createBackgroundService({ chromeApi, fetchImpl: vi.fn() });
    const sendResponse = vi.fn();

    expect(service.runtimeListener({ type: 'page.submit' }, {}, sendResponse)).toBe(false);
    expect(service.runtimeListener({ type: 'unknown' }, {}, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('returns true for supported async work and responds exactly once with stable errors', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const service = createBackgroundService({
      chromeApi,
      fetchImpl: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });

    const { response, sendResponse } = await callRuntime(
      service.runtimeListener,
      { type: 'connection.check' },
    );

    expect(sendResponse).toHaveBeenCalledOnce();
    expect(response).toEqual({
      ok: false,
      error: {
        message: 'Failed to fetch',
        status: null,
        code: 'network_error',
        retryable: true,
      },
    });
  });

  it('probes public health without auth and stays disconnected without a token', async () => {
    const { chromeApi } = createChrome();
    const fetchImpl = vi.fn(async () => jsonResponse({
      ok: true,
      app: 'resume-designer',
      version: '1.0.0',
    }));
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({ type: 'connection.check' })).resolves.toEqual({
      connected: false,
      health: { ok: true, app: 'resume-designer', version: '1.0.0' },
      resumes: [],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:17872/health');
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
  });

  it('trims and stores a pairing token, then proves health and authenticated resume access', async () => {
    const { chromeApi, getStoredToken } = createChrome();
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/health')) return jsonResponse({ ok: true });
      if (url.endsWith('/resumes')) return jsonResponse({ resumes: [{ id: 'resume-1' }] });
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'pairing.save',
      token: '  secret token  ',
    })).resolves.toEqual({
      connected: true,
      health: { ok: true },
      resumes: [{ id: 'resume-1' }],
    });

    expect(getStoredToken()).toBe('secret token');
    expect(chromeApi.storage.local.set).toHaveBeenCalledWith({ bridgeToken: 'secret token' });
    const resumeOptions = fetchImpl.mock.calls.find(([url]) => url.endsWith('/resumes'))[1];
    expect(new Headers(resumeOptions.headers).get('Authorization')).toBe('Bearer secret token');
  });

  it('rejects an empty pairing token before storage or network access', async () => {
    const { chromeApi } = createChrome();
    const fetchImpl = vi.fn();
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({ type: 'pairing.save', token: '   ' }))
      .rejects.toMatchObject({ code: 'not_paired', retryable: false });
    expect(chromeApi.storage.local.set).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the resumes bridge object unchanged', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async () => jsonResponse({
      resumes: [{ id: 'resume-1', name: 'Backend' }],
    }));
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({ type: 'resumes.list' })).resolves.toEqual({
      resumes: [{ id: 'resume-1', name: 'Backend' }],
    });
  });

  it('queries and injects the active HTTP(S) tab before an exact scan relay', async () => {
    const scanResult = {
      descriptors: [{ field_id: 'name' }],
      page: { company: 'Acme', title: 'Engineer' },
    };
    const { chromeApi } = createChrome({ contentResponse: scanResult });
    const service = createBackgroundService({ chromeApi, fetchImpl: vi.fn() });

    await expect(service.handleMessage({ type: 'page.scan' })).resolves.toEqual(scanResult);
    expect(chromeApi.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(chromeApi.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 17 },
      files: ['content.js'],
    });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(17, { type: 'content.scan' });
  });

  it('rejects known restricted pages before attempting injection', async () => {
    const { chromeApi } = createChrome({
      tab: { id: 17, windowId: 4, url: 'chrome://extensions' },
    });
    const service = createBackgroundService({ chromeApi, fetchImpl: vi.fn() });

    await expect(service.handleMessage({ type: 'page.scan' })).rejects.toMatchObject({
      code: 'restricted_page',
      retryable: false,
    });
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['missing active tab', null, null],
    ['missing activeTab URL grant', { id: 17, windowId: 4 }, null],
    ['injection rejection', { id: 17, windowId: 4, url: 'https://jobs.test' }, new Error('Cannot access contents')],
  ])('surfaces a recoverable lost-grant error for %s', async (_name, tab, injectionError) => {
    const { chromeApi } = createChrome({ tab });
    if (injectionError) chromeApi.scripting.executeScript.mockRejectedValue(injectionError);
    const service = createBackgroundService({ chromeApi, fetchImpl: vi.fn() });

    await expect(service.handleMessage({ type: 'page.scan' })).rejects.toMatchObject({
      message: expect.stringMatching(/click the extension toolbar button again on that page/i),
      code: 'active_tab_grant_lost',
      retryable: true,
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('surfaces a relay navigation race as a recoverable lost-grant error', async () => {
    const { chromeApi } = createChrome();
    chromeApi.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
    const service = createBackgroundService({ chromeApi, fetchImpl: vi.fn() });

    await expect(service.handleMessage({ type: 'page.scan' })).rejects.toMatchObject({
      code: 'active_tab_grant_lost',
      retryable: true,
    });
  });

  it('fetches the full selected resume before mapping with current profile and learned answers', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const descriptors = [{
      field_id: 'full-name',
      label: 'Full name',
      type: 'text',
      options: [],
      required: true,
    }];
    const fullResume = {
      id: 'resume-1',
      data: { name: 'Jane Applicant' },
      profile: { location: 'Portland' },
      learnedAnswers: [{ question: 'Notice?', answer: 'Two weeks' }],
    };
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/resumes/resume-1')) return jsonResponse(fullResume);
      if (url.endsWith('/ai/complete')) {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.messages[0].content);
        expect(context.resume).toEqual({
          data: fullResume.data,
          profile: fullResume.profile,
          learnedAnswers: fullResume.learnedAnswers,
        });
        expect(body.systemPrompt).toEqual(expect.any(String));
        return jsonResponse({
          text: JSON.stringify({
            fields: [{
              field_id: 'full-name',
              value: 'Jane Applicant',
              confidence: 1,
              source: 'resume',
            }],
            needs_human: [],
          }),
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'mapping.create',
      resumeId: 'resume-1',
      descriptors,
    })).resolves.toEqual({
      fields: [{
        field_id: 'full-name',
        value: 'Jane Applicant',
        confidence: 1,
        source: 'resume',
      }],
      needs_human: [],
    });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:17872/resumes/resume-1',
      'http://127.0.0.1:17872/ai/complete',
    ]);
  });

  it('fills reviewed fields without fetching a PDF when no resume marker exists', async () => {
    const fields = [{ field_id: 'name', value: 'Jane' }];
    const fillResult = { filled: ['name'], unfilled: [] };
    const { chromeApi } = createChrome({ contentResponse: fillResult });
    const fetchImpl = vi.fn();
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'page.fill',
      resumeId: 'resume-1',
      fields,
    })).resolves.toEqual(fillResult);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(17, {
      type: 'content.fill',
      payload: { fields },
    });
  });

  it('serializes PDF exports and relays each successful bridge PDF unchanged', async () => {
    const firstPdf = deferred();
    let pdfCalls = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (!url.endsWith('/pdf')) throw new Error(`Unexpected URL ${url}`);
      pdfCalls += 1;
      if (pdfCalls === 1) return firstPdf.promise;
      return jsonResponse({ filename: 'Second.pdf', pdfBase64: 'UERGMiA=' });
    });
    const { chromeApi } = createChrome({
      token: 'paired',
      contentResponse: { filled: ['resume-file'], unfilled: [] },
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    const first = service.handleMessage({
      type: 'page.fill', resumeId: 'resume-1', fields: PDF_FIELD,
    });
    const second = service.handleMessage({
      type: 'page.fill', resumeId: 'resume-2', fields: PDF_FIELD,
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    expect(fetchImpl.mock.calls[0][0]).toContain('/resumes/resume-1/pdf');
    firstPdf.resolve(jsonResponse({ filename: 'First.pdf', pdfBase64: 'UERGMSA=' }));
    await Promise.all([first, second]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toContain('/resumes/resume-2/pdf');
    expect(chromeApi.tabs.sendMessage.mock.calls.map(([, message]) => message)).toEqual([
      {
        type: 'content.fill',
        payload: {
          fields: PDF_FIELD,
          pdf: { filename: 'First.pdf', pdfBase64: 'UERGMSA=' },
        },
      },
      {
        type: 'content.fill',
        payload: {
          fields: PDF_FIELD,
          pdf: { filename: 'Second.pdf', pdfBase64: 'UERGMiA=' },
        },
      },
    ]);
  });

  it('does not poison the PDF queue after rejection and never relays the failed fill', async () => {
    const busyMessage = 'another PDF export is in progress — try again in a moment';
    let pdfCalls = 0;
    const fetchImpl = vi.fn(async () => {
      pdfCalls += 1;
      if (pdfCalls === 1) return jsonResponse({ error: busyMessage }, { status: 500 });
      return jsonResponse({ filename: 'Recovered.pdf', pdfBase64: 'UERG' });
    });
    const { chromeApi } = createChrome({ token: 'paired', contentResponse: { filled: [], unfilled: [] } });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    const outcomes = await Promise.allSettled([
      service.handleMessage({ type: 'page.fill', resumeId: 'resume-1', fields: PDF_FIELD }),
      service.handleMessage({ type: 'page.fill', resumeId: 'resume-2', fields: PDF_FIELD }),
    ]);

    expect(outcomes[0].status).toBe('rejected');
    expect(outcomes[0].reason).toBeInstanceOf(BridgeError);
    expect(outcomes[0].reason).toMatchObject({ code: 'pdf_busy', retryable: true });
    expect(outcomes[1].status).toBe('fulfilled');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledOnce();
    expect(chromeApi.tabs.sendMessage.mock.calls[0][1].payload.pdf.filename).toBe('Recovered.pdf');
  });

  it.each([
    [500, 'another PDF export is in progress — try again in a moment', 'pdf_busy'],
    [504, 'the app did not answer in time — is Resume Designer running and unlocked?', 'app_timeout'],
  ])('keeps a failed %s PDF export atomic with no page mutation', async (status, message, code) => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async () => jsonResponse({ error: message }, { status }));
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'page.fill', resumeId: 'resume-1', fields: PDF_FIELD,
    })).rejects.toMatchObject({ code, retryable: true });

    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('proxies only documented save-answer and application-log payload fields', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/profile/answers')) return jsonResponse({ answer: { id: 'answer-1' } }, { status: 201 });
      if (url.endsWith('/applications')) return jsonResponse({ application: { id: 'app-1' } }, { status: 201 });
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await service.handleMessage({
      type: 'answer.save',
      question: 'Notice period?',
      answer: 'Two weeks',
      ignored: 'do not send',
    });
    await service.handleMessage({
      type: 'application.log',
      variantId: 'resume-1',
      company: 'Acme',
      title: 'Engineer',
      notes: 'Referred',
      ignored: 'do not send',
    });

    expect(fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body))).toEqual([
      { question: 'Notice period?', answer: 'Two weeks' },
      { variantId: 'resume-1', company: 'Acme', title: 'Engineer', notes: 'Referred' },
    ]);
  });
});
