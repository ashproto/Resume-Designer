import { describe, expect, it, vi } from 'vitest';

import { BridgeError, REQUIRED_CAPABILITIES } from '../src/bridgeClient.js';
import { createBackgroundService } from '../src/background.js';

const HEALTH = {
  ok: true,
  app: 'resume-designer',
  version: '1.0.0',
  protocolVersion: 2,
  capabilities: [...REQUIRED_CAPABILITIES],
};

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
  consent = true,
  legacyLocalToken = '',
  pendingApplicationRequest = null,
  tab = { id: 17, windowId: 4, url: 'https://jobs.example.test/apply' },
  contentResponse,
} = {}) {
  let storedConsent = consent ? 1 : null;
  let storedToken = token;
  let storedLegacyToken = legacyLocalToken;
  let storedApplicationRequest = pendingApplicationRequest;
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
      id: 'a'.repeat(32),
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
        get: vi.fn(async () => ({ bridgeToken: storedLegacyToken, privacyConsentVersion: storedConsent })),
        set: vi.fn(async (value) => {
          if ('bridgeToken' in value) storedLegacyToken = value.bridgeToken;
          if ('privacyConsentVersion' in value) storedConsent = value.privacyConsentVersion;
        }),
        setAccessLevel: vi.fn(async () => undefined),
        remove: vi.fn(async (key) => {
          if (key === 'bridgeToken') storedLegacyToken = '';
          if (key === 'privacyConsentVersion') storedConsent = null;
        }),
      },
      session: {
        remove: vi.fn(async (key) => { if (key === 'pendingApplicationRequest') storedApplicationRequest = null; }),
        get: vi.fn(async () => ({ bridgeToken: storedToken, pendingApplicationRequest: storedApplicationRequest })),
        set: vi.fn(async (value) => {
          if ('bridgeToken' in value) storedToken = value.bridgeToken;
          if ('pendingApplicationRequest' in value) storedApplicationRequest = value.pendingApplicationRequest;
        }),
        setAccessLevel: vi.fn(async () => undefined),
      },
    },
    tabs: {
      create: vi.fn(async ({ url }) => ({ id: 99, url })),
      query: vi.fn(async () => (tab ? [tab] : [])),
      sendMessage: vi.fn(async (_tabId, message) => (
        typeof contentResponse === 'function' ? contentResponse(message) : contentResponse
      )),
    },
  };

  return {
    chromeApi,
    listeners,
    getStoredToken: () => storedToken,
    getLegacyLocalToken: () => storedLegacyToken,
  };
}

async function callRuntime(listener, message) {
  const sendResponse = vi.fn();
  expect(listener(message, {}, sendResponse)).toBe(true);
  await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
  return { response: sendResponse.mock.calls[0][0], sendResponse };
}

const REVIEW_CONTEXT = { page: { tabId: 17, url: 'https://jobs.example.test/apply', tabUrl: 'https://jobs.example.test/apply' }, descriptors: [] };
const PDF_FIELD = [{ field_id: 'resume-file', value: '__resume_pdf__' }];

describe('createBackgroundService', () => {
  it('installs once, restricts session storage, and purges legacy local tokens without migration', async () => {
    const {
      chromeApi, listeners, getStoredToken, getLegacyLocalToken,
    } = createChrome({ legacyLocalToken: 'legacy-secret' });
    const service = createBackgroundService({ chromeApi, fetchImpl: vi.fn() });

    service.install();
    service.install();

    expect(chromeApi.action.onClicked.addListener).toHaveBeenCalledOnce();
    expect(chromeApi.runtime.onMessage.addListener).toHaveBeenCalledOnce();
    expect(chromeApi.storage.session.setAccessLevel).toHaveBeenCalledOnce();
    expect(chromeApi.storage.session.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    expect(chromeApi.storage.local.remove).toHaveBeenCalledOnce();
    expect(chromeApi.storage.local.remove).toHaveBeenCalledWith('bridgeToken');
    expect(chromeApi.storage.local.get).not.toHaveBeenCalled();
    expect(chromeApi.storage.local.set).not.toHaveBeenCalled();
    expect(getLegacyLocalToken()).toBe('');
    expect(getStoredToken()).toBe('');
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
    const fetchImpl = vi.fn(async () => jsonResponse(HEALTH));
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({ type: 'connection.check' })).resolves.toEqual({
      connected: false,
      health: HEALTH,
      profileId: null,
      profileContextId: null,
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
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      if (url.endsWith('/resumes')) {
        return jsonResponse({
          profileId: 'profile-1', profileContextId: 'context-1', resumes: [{ id: 'resume-1' }],
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'pairing.save',
      token: '  secret token  ',
    })).resolves.toEqual({
      connected: true,
      health: HEALTH,
      profileId: 'profile-1',
      profileContextId: 'context-1',
      resumes: [{ id: 'resume-1' }],
    });

    expect(getStoredToken()).toBe('secret token');
    expect(chromeApi.storage.session.set).toHaveBeenCalledWith({ bridgeToken: 'secret token' });
    const resumeOptions = fetchImpl.mock.calls.find(([url]) => url.endsWith('/resumes'))[1];
    expect(new Headers(resumeOptions.headers).get('Authorization')).toBe('Bearer secret token');
  });

  it('rejects an empty pairing token before storage or network access', async () => {
    const { chromeApi } = createChrome();
    const fetchImpl = vi.fn();
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({ type: 'pairing.save', token: '   ' }))
      .rejects.toMatchObject({ code: 'not_paired', retryable: false });
    expect(chromeApi.storage.session.set).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('validates a manual token before storage and preserves the previous token on rejection', async () => {
    const { chromeApi, getStoredToken } = createChrome({ token: 'still-valid' });
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer invalid-new-token');
      return jsonResponse({ error: 'invalid token' }, { status: 401 });
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'pairing.save', token: ' invalid-new-token ',
    })).rejects.toMatchObject({ code: 'unauthorized' });

    expect(getStoredToken()).toBe('still-valid');
    expect(chromeApi.storage.session.set).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:17872/health',
      'http://127.0.0.1:17872/resumes',
    ]);
  });

  it('never reports connected or stores a token for a malformed authenticated context', async () => {
    const { chromeApi } = createChrome();
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      return jsonResponse({ profileId: null, profileContextId: '', resumes: {} });
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'pairing.save', token: 'candidate-token',
    })).rejects.toMatchObject({ code: 'invalid_response', retryable: true });
    expect(chromeApi.storage.session.set).not.toHaveBeenCalled();
  });

  it('connects to an already-running paired app without launching or requesting approval', async () => {
    const { chromeApi } = createChrome({ token: 'stored-secret' });
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/health')) {
        expect(new Headers(options.headers).has('Authorization')).toBe(false);
        return jsonResponse(HEALTH);
      }
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer stored-secret');
      return jsonResponse({
        profileId: 'profile-1', profileContextId: 'context-1', resumes: [],
      });
    });
    const service = createBackgroundService({
      chromeApi,
      fetchImpl,
      waitImpl: vi.fn(async () => undefined),
      pollAttempts: 2,
    });

    await expect(service.handleMessage({ type: 'app.open' })).resolves.toMatchObject({
      connected: true,
      profileContextId: 'context-1',
    });

    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/pairing/claim'))).toBe(false);
  });

  it('pairs automatically with a verifier challenge, then verifies the claimed token before storage', async () => {
    const { chromeApi, getStoredToken } = createChrome();
    let claimCalls = 0;
    const waitImpl = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/pairing/claim')) {
        claimCalls += 1;
        const claim = JSON.parse(options.body);
        expect(claim.requestId).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
        expect(claim.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
        if (claimCalls === 1) {
          return jsonResponse({ error: 'pending', code: 'pairing_pending' }, { status: 425 });
        }
        return jsonResponse({ token: 'claimed-secret' });
      }
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer claimed-secret');
      return jsonResponse({
        profileId: 'profile-1', profileContextId: 'context-1', resumes: [],
      });
    });
    const service = createBackgroundService({
      chromeApi,
      fetchImpl,
      waitImpl,
      pollAttempts: 3,
      randomBytesImpl: (length) => new Uint8Array(length).fill(7),
    });

    await expect(service.handleMessage({ type: 'app.open' })).resolves.toMatchObject({
      connected: true,
      profileId: 'profile-1',
    });

    const launchUrl = new URL(chromeApi.tabs.create.mock.calls[0][0].url);
    expect(launchUrl.hostname).toBe('companion');
    expect(chromeApi.tabs.create.mock.calls[0][0].active).toBe(true);
    expect(launchUrl.pathname).toBe('/pair');
    expect(launchUrl.searchParams.get('protocolVersion')).toBe('2');
    expect(launchUrl.searchParams.get('challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(launchUrl.href).not.toContain('claimed-secret');
    expect(getStoredToken()).toBe('claimed-secret');
    expect(chromeApi.storage.session.set).toHaveBeenCalledTimes(1);
    expect(waitImpl).toHaveBeenCalledTimes(1);
  });

  it('starts challenge pairing for a running app only after a 401', async () => {
    const { chromeApi, getStoredToken } = createChrome({ token: 'expired-secret' });
    let resumeCalls = 0;
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      if (url.endsWith('/pairing/claim')) return jsonResponse({ token: 'replacement-secret' });
      resumeCalls += 1;
      const auth = new Headers(options.headers).get('Authorization');
      if (resumeCalls === 1) {
        expect(auth).toBe('Bearer expired-secret');
        return jsonResponse({ error: 'expired' }, { status: 401 });
      }
      expect(auth).toBe('Bearer replacement-secret');
      return jsonResponse({
        profileId: 'profile-1', profileContextId: 'context-1', resumes: [],
      });
    });
    const service = createBackgroundService({
      chromeApi,
      fetchImpl,
      waitImpl: vi.fn(async () => undefined),
      pollAttempts: 2,
      randomBytesImpl: (length) => new Uint8Array(length).fill(9),
    });

    await service.handleMessage({ type: 'app.open' });

    expect(chromeApi.tabs.create).toHaveBeenCalledOnce();
    expect(chromeApi.tabs.create.mock.calls[0][0].url).toContain('/pair?');
    expect(getStoredToken()).toBe('replacement-secret');
  });

  it('bounds app launch polling and surfaces a dedicated launch failure', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const waitImpl = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const service = createBackgroundService({
      chromeApi, fetchImpl, waitImpl, pollAttempts: 3,
    });

    await expect(service.handleMessage({ type: 'app.open' })).rejects.toMatchObject({
      code: 'launch_failed',
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(waitImpl).toHaveBeenCalledTimes(2);
  });

  it('returns the resumes bridge object unchanged', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async () => jsonResponse({
      profileId: 'profile-1',
      profileContextId: 'context-1',
      resumes: [{ id: 'resume-1', name: 'Backend' }],
    }));
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({ type: 'resumes.list' })).resolves.toEqual({
      profileId: 'profile-1',
      profileContextId: 'context-1',
      resumes: [{ id: 'resume-1', name: 'Backend' }],
    });
  });

  it.each([
    ['mapping', {
      type: 'mapping.create', profileContextId: 'context-old', resumeId: 'resume-1', descriptors: [],
    }],
    ['non-PDF fill', {
      type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-old', resumeId: 'resume-1',
      fields: [{ field_id: 'name', value: 'Jane' }],
    }],
    ['missing-context fill', {
      type: 'page.fill', reviewContext: REVIEW_CONTEXT, resumeId: 'resume-1',
      fields: [{ field_id: 'name', value: 'Jane' }],
    }],
    ['answer save', {
      type: 'answer.save', profileContextId: 'context-old', question: 'Notice?', answer: 'Two weeks',
    }],
    ['application log', {
      type: 'application.log', profileContextId: 'context-old', variantId: 'resume-1',
      company: 'Acme', title: 'Engineer',
    }],
  ])('blocks stale-profile %s before any side effect', async (_name, message) => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/resumes')) {
        return jsonResponse({
          profileId: 'profile-1', profileContextId: 'context-new', resumes: [{ id: 'resume-2' }],
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage(message)).rejects.toMatchObject({
      code: 'profile_changed',
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('queries and injects the active HTTPS tab before an exact scan relay', async () => {
    const scanResult = {
      descriptors: [{ field_id: 'name' }],
      page: { company: 'Acme', title: 'Engineer', url: 'https://jobs.example.test/apply' },
    };
    const { chromeApi } = createChrome({ contentResponse: scanResult });
    const service = createBackgroundService({ chromeApi, fetchImpl: vi.fn() });

    await expect(service.handleMessage({ type: 'page.scan' })).resolves.toEqual({ ...scanResult, page: { ...scanResult.page, tabId: 17, tabUrl: 'https://jobs.example.test/apply' } });
    expect(chromeApi.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(chromeApi.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 17 },
      files: ['content.js'],
    });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(17, { type: 'content.scan' });
  });

  it.each([
    'http://localhost:8765/greenhouse-form.html',
    'http://127.0.0.1:8765/greenhouse-form.html',
    'http://[::1]:8765/greenhouse-form.html',
  ])('allows loopback HTTP fixtures at %s', async (url) => {
    const scanResult = { descriptors: [], page: { url } };
    const { chromeApi } = createChrome({
      tab: { id: 17, windowId: 4, url },
      contentResponse: scanResult,
    });
    const service = createBackgroundService({ chromeApi, fetchImpl: vi.fn() });

    await expect(service.handleMessage({ type: 'page.scan' })).resolves.toEqual({ ...scanResult, page: { ...scanResult.page, tabId: 17, tabUrl: url } });
    expect(chromeApi.scripting.executeScript).toHaveBeenCalledOnce();
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledOnce();
  });

  it('rejects non-loopback HTTP application pages before attempting injection', async () => {
    const { chromeApi } = createChrome({
      tab: { id: 17, windowId: 4, url: 'http://jobs.example.test/apply' },
    });
    const service = createBackgroundService({ chromeApi, fetchImpl: vi.fn() });

    await expect(service.handleMessage({ type: 'page.scan' })).rejects.toMatchObject({
      code: 'restricted_page',
      retryable: false,
    });
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
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
      profileId: 'profile-1',
      profileContextId: 'context-1',
      id: 'resume-1',
      data: { name: 'Jane Applicant' },
      profile: { location: 'Portland' },
      learnedAnswers: [{ question: 'Notice?', answer: 'Two weeks' }],
    };
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/resumes')) {
        return jsonResponse({
          profileId: 'profile-1', profileContextId: 'context-1', resumes: [{ id: 'resume-1' }],
        });
      }
      if (url.endsWith('/resumes/resume-1')) return jsonResponse(fullResume);
      if (url.endsWith('/ai/complete')) {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.messages[0].content);
        expect(context.resume).toEqual({
          data: fullResume.data,
          profile: fullResume.profile,
          learnedAnswers: fullResume.learnedAnswers,
        });
        expect(body.profileContextId).toBe('context-1');
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
      profileContextId: 'context-1',
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
      'http://127.0.0.1:17872/resumes',
      'http://127.0.0.1:17872/resumes/resume-1',
      'http://127.0.0.1:17872/ai/complete',
      'http://127.0.0.1:17872/resumes',
    ]);
  });

  it('drops a completed mapping if the active profile changed while AI was running', async () => {
    let contextChecks = 0;
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/resumes')) {
        contextChecks += 1;
        return jsonResponse({
          profileId: 'profile-1',
          profileContextId: contextChecks === 1 ? 'context-1' : 'context-2',
          resumes: [],
        });
      }
      if (url.endsWith('/resumes/resume-1')) {
        return jsonResponse({
          profileId: 'profile-1', profileContextId: 'context-1',
          id: 'resume-1', data: { name: 'Jane' }, profile: {}, learnedAnswers: [],
        });
      }
      if (url.endsWith('/ai/complete')) {
        return jsonResponse({ text: JSON.stringify({ fields: [], needs_human: [] }) });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'mapping.create',
      profileContextId: 'context-1',
      resumeId: 'resume-1',
      descriptors: [],
    })).rejects.toMatchObject({ code: 'profile_changed', retryable: true });
    expect(contextChecks).toBe(2);
  });

  it('rejects a resume detail from another context before sending it to AI', async () => {
    let aiCalls = 0;
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/resumes')) {
        return jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] });
      }
      if (url.endsWith('/resumes/resume-1')) {
        return jsonResponse({
          profileId: 'profile-2', profileContextId: 'context-2',
          id: 'resume-1', data: { name: 'Other profile' }, profile: {}, learnedAnswers: [],
        });
      }
      if (url.endsWith('/ai/complete')) {
        aiCalls += 1;
        return jsonResponse({ text: JSON.stringify({ fields: [], needs_human: [] }) });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'mapping.create', profileContextId: 'context-1',
      resumeId: 'resume-1', descriptors: [],
    })).rejects.toMatchObject({ code: 'profile_changed' });
    expect(aiCalls).toBe(0);
  });

  it('reclassifies a reload-induced resume 404 as a profile change', async () => {
    let contextChecks = 0;
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/resumes')) {
        contextChecks += 1;
        return jsonResponse({
          profileId: 'profile-1',
          profileContextId: contextChecks === 1 ? 'context-1' : 'context-2',
          resumes: [],
        });
      }
      if (url.endsWith('/resumes/resume-1')) {
        return jsonResponse({ error: 'no resume with id resume-1' }, { status: 404 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'mapping.create', profileContextId: 'context-1',
      resumeId: 'resume-1', descriptors: [],
    })).rejects.toMatchObject({ code: 'profile_changed' });
    expect(contextChecks).toBe(2);
  });

  it('fills reviewed fields without fetching a PDF when no resume marker exists', async () => {
    const fields = [{ field_id: 'name', value: 'Jane' }];
    const fillResult = { filled: ['name'], unfilled: [] };
    const { chromeApi } = createChrome({ token: 'paired', contentResponse: fillResult });
    const fetchImpl = vi.fn(async () => jsonResponse({
      profileId: 'profile-1', profileContextId: 'context-1', resumes: [{ id: 'resume-1' }],
    }));
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'page.fill', reviewContext: REVIEW_CONTEXT,
      profileContextId: 'context-1',
      resumeId: 'resume-1',
      fields,
    })).resolves.toEqual(fillResult);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([url]) => (
      url === 'http://127.0.0.1:17872/resumes'
    ))).toBe(true);
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(17, {
      type: 'content.fill',
      payload: { fields, reviewContext: REVIEW_CONTEXT },
    });
  });

  it('rechecks context after delayed injection and blocks the fill relay', async () => {
    const injection = deferred();
    let contextChecks = 0;
    const { chromeApi } = createChrome({
      token: 'paired', contentResponse: { filled: ['name'], unfilled: [] },
    });
    chromeApi.scripting.executeScript.mockReturnValue(injection.promise);
    const fetchImpl = vi.fn(async () => {
      contextChecks += 1;
      return jsonResponse({
        profileId: 'profile-1',
        profileContextId: contextChecks === 1 ? 'context-1' : 'context-2',
        resumes: [],
      });
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });
    const fill = service.handleMessage({
      type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-1', resumeId: 'resume-1',
      fields: [{ field_id: 'name', value: 'Jane' }],
    });

    await vi.waitFor(() => expect(chromeApi.scripting.executeScript).toHaveBeenCalledOnce());
    injection.resolve([]);
    await expect(fill).rejects.toMatchObject({ code: 'profile_changed' });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('serializes PDF exports and relays each successful bridge PDF unchanged', async () => {
    const firstPdf = deferred();
    let pdfCalls = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/resumes')) {
        return jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] });
      }
      if (!url.endsWith('/pdf')) throw new Error(`Unexpected URL ${url}`);
      pdfCalls += 1;
      if (pdfCalls === 1) return firstPdf.promise;
      return jsonResponse({
        profileId: 'profile-1', profileContextId: 'context-1',
        filename: 'Second.pdf', pdfBase64: 'UERGMiA=',
      });
    });
    const { chromeApi } = createChrome({
      token: 'paired',
      contentResponse: { filled: ['resume-file'], unfilled: [] },
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    const first = service.handleMessage({
      type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-1', resumeId: 'resume-1', fields: PDF_FIELD,
    });
    const second = service.handleMessage({
      type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-1', resumeId: 'resume-2', fields: PDF_FIELD,
    });

    await vi.waitFor(() => expect(pdfCalls).toBe(1));
    expect(fetchImpl.mock.calls.find(([url]) => url.endsWith('/pdf'))[0])
      .toContain('/resumes/resume-1/pdf');
    firstPdf.resolve(jsonResponse({
      profileId: 'profile-1', profileContextId: 'context-1',
      filename: 'First.pdf', pdfBase64: 'UERGMSA=',
    }));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.attachments).toEqual([{
      field_id: 'resume-file', filename: 'First.pdf',
    }]);
    expect(secondResult.attachments).toEqual([{
      field_id: 'resume-file', filename: 'Second.pdf',
    }]);

    expect(pdfCalls).toBe(2);
    expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('/pdf'))[1][0])
      .toContain('/resumes/resume-2/pdf');
    expect(chromeApi.tabs.sendMessage.mock.calls.map(([, message]) => message)).toEqual([
      {
        type: 'content.fill',
        payload: {
          fields: PDF_FIELD,
          reviewContext: REVIEW_CONTEXT,
          pdf: { filename: 'First.pdf', pdfBase64: 'UERGMSA=' },
        },
      },
      {
        type: 'content.fill',
        payload: {
          fields: PDF_FIELD,
          reviewContext: REVIEW_CONTEXT,
          pdf: { filename: 'Second.pdf', pdfBase64: 'UERGMiA=' },
        },
      },
    ]);
  });

  it('reports no PDF attachment unless the content script confirms that exact file field', async () => {
    const { chromeApi } = createChrome({
      token: 'paired',
      contentResponse: {
        filled: ['name'],
        unfilled: [{ field_id: 'resume-file', reason: 'Browser rejected the file' }],
      },
    });
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/resumes')) {
        return jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] });
      }
      return jsonResponse({
        profileId: 'profile-1', profileContextId: 'context-1',
        filename: 'Resume.pdf', pdfBase64: 'UERG',
      });
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-1', resumeId: 'resume-1',
      fields: [{ field_id: 'name', value: 'Jane' }, ...PDF_FIELD],
    })).resolves.toMatchObject({ attachments: [] });
  });

  it('rechecks queued PDF work and drops a stale fill when the profile changes in line', async () => {
    const firstPdf = deferred();
    let contextChecks = 0;
    let pdfCalls = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/resumes')) {
        contextChecks += 1;
        return jsonResponse({
          profileId: 'profile-1',
          profileContextId: contextChecks <= 3 ? 'context-1' : 'context-2',
          resumes: [],
        });
      }
      if (url.endsWith('/pdf')) {
        pdfCalls += 1;
        if (pdfCalls === 1) return firstPdf.promise;
        return jsonResponse({
          profileId: 'profile-1', profileContextId: 'context-2',
          filename: 'Stale.pdf', pdfBase64: 'UERG',
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const { chromeApi } = createChrome({
      token: 'paired',
      contentResponse: { filled: ['resume-file'], unfilled: [] },
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    const first = service.handleMessage({
      type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-1', resumeId: 'resume-1', fields: PDF_FIELD,
    });
    const second = service.handleMessage({
      type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-1', resumeId: 'resume-2', fields: PDF_FIELD,
    });
    await vi.waitFor(() => expect(pdfCalls).toBe(1));
    firstPdf.resolve(jsonResponse({
      profileId: 'profile-1', profileContextId: 'context-1',
      filename: 'Current.pdf', pdfBase64: 'UERG',
    }));

    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes[0].status).toBe('fulfilled');
    expect(outcomes[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'profile_changed', retryable: true },
    });
    expect(pdfCalls).toBe(1);
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledOnce();
  });

  it('rejects a PDF response labelled with another profile context', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/resumes')) {
        return jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] });
      }
      if (url.endsWith('/pdf')) {
        return jsonResponse({
          profileId: 'profile-2', profileContextId: 'context-2',
          filename: 'Other.pdf', pdfBase64: 'UERG',
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-1',
      resumeId: 'resume-1', fields: PDF_FIELD,
    })).rejects.toMatchObject({ code: 'profile_changed' });
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('does not poison the PDF queue after rejection and never relays the failed fill', async () => {
    const busyMessage = 'another PDF export is in progress — try again in a moment';
    let pdfCalls = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/resumes')) {
        return jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] });
      }
      pdfCalls += 1;
      if (pdfCalls === 1) return jsonResponse({ error: busyMessage }, { status: 500 });
      return jsonResponse({
        profileId: 'profile-1', profileContextId: 'context-1',
        filename: 'Recovered.pdf', pdfBase64: 'UERG',
      });
    });
    const { chromeApi } = createChrome({ token: 'paired', contentResponse: { filled: [], unfilled: [] } });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    const outcomes = await Promise.allSettled([
      service.handleMessage({
        type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-1', resumeId: 'resume-1', fields: PDF_FIELD,
      }),
      service.handleMessage({
        type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-1', resumeId: 'resume-2', fields: PDF_FIELD,
      }),
    ]);

    expect(outcomes[0].status).toBe('rejected');
    expect(outcomes[0].reason).toBeInstanceOf(BridgeError);
    expect(outcomes[0].reason).toMatchObject({ code: 'pdf_busy', retryable: true });
    expect(outcomes[1].status).toBe('fulfilled');
    expect(pdfCalls).toBe(2);
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledOnce();
    expect(chromeApi.tabs.sendMessage.mock.calls[0][1].payload.pdf.filename).toBe('Recovered.pdf');
  });

  it.each([
    [500, 'another PDF export is in progress — try again in a moment', 'pdf_busy'],
    [504, 'the app did not answer in time — is On Paper running and unlocked?', 'app_timeout'],
  ])('keeps a failed %s PDF export atomic with no page mutation', async (status, message, code) => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/resumes')) {
        return jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] });
      }
      return jsonResponse({ error: message }, { status });
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-1', resumeId: 'resume-1', fields: PDF_FIELD,
    })).rejects.toMatchObject({ code, retryable: true });

    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('proxies only documented save-answer and application-log payload fields', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/resumes')) {
        return jsonResponse({
          profileId: 'profile-1', profileContextId: 'context-1', resumes: [{ id: 'resume-1' }],
        });
      }
      if (url.endsWith('/profile/answers')) return jsonResponse({ answer: { id: 'answer-1' } }, { status: 201 });
      if (url.endsWith('/applications')) return jsonResponse({ application: { id: 'app-1' } }, { status: 201 });
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await service.handleMessage({
      type: 'answer.save',
      profileContextId: 'context-1',
      question: 'Notice period?',
      answer: 'Two weeks',
      ignored: 'do not send',
    });
    await service.handleMessage({
      type: 'application.log',
      profileContextId: 'context-1',
      variantId: 'resume-1',
      company: 'Acme',
      title: 'Engineer',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      notes: 'Referred',
      ignored: 'do not send',
    });

    expect(fetchImpl.mock.calls
      .filter(([, options]) => options.body)
      .map(([, options]) => JSON.parse(options.body))).toEqual([
      { profileContextId: 'context-1', question: 'Notice period?', answer: 'Two weeks' },
      {
        profileContextId: 'context-1', variantId: 'resume-1', company: 'Acme',
        title: 'Engineer', requestId: '550e8400-e29b-41d4-a716-446655440000', notes: 'Referred',
      },
    ]);
  });

  it('treats an atomically guarded application log response as definitive', async () => {
    let contextChecks = 0;
    const { chromeApi } = createChrome({ token: 'paired' });
    const application = { id: 'app-1' };
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/resumes')) {
        contextChecks += 1;
        return jsonResponse({
          profileId: 'profile-1',
          profileContextId: contextChecks === 1 ? 'context-1' : 'context-2',
          resumes: [{ id: 'resume-1' }],
        });
      }
      if (url.endsWith('/applications')) {
        return jsonResponse({ application }, { status: 201 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'application.log',
      profileContextId: 'context-1',
      variantId: 'resume-1',
      company: 'Acme',
      title: 'Engineer',
    })).resolves.toEqual({ application });
    expect(contextChecks).toBe(1);
  });

  it('proxies job-fit analysis with exact fields and rechecks the profile context', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const analysis = { score: 84, summary: 'Strong fit', strengths: [], gaps: [] };
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/resumes')) {
        return jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] });
      }
      if (url.endsWith('/ai/job-fit')) {
        expect(JSON.parse(options.body)).toEqual({
          profileContextId: 'context-1',
          resumeId: 'resume-1',
          job: { url: 'https://jobs.test/1', description: 'Build products' },
          model: 'provider/chosen',
        });
        return jsonResponse({
          profileId: 'profile-1', profileContextId: 'context-1', resumeId: 'resume-1', analysis,
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'job.fit.analyze',
      profileContextId: 'context-1',
      resumeId: 'resume-1',
      job: { url: 'https://jobs.test/1', description: 'Build products' },
          model: 'provider/chosen',
      ignored: 'do not send',
    })).resolves.toMatchObject({ analysis });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:17872/resumes',
      'http://127.0.0.1:17872/ai/job-fit',
      'http://127.0.0.1:17872/resumes',
    ]);
  });

  it('proxies idempotent tailored-resume creation without retrying a committed mutation', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const resume = { id: 'companion-new', name: 'Tailored Resume' };
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/resumes')) {
        return jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] });
      }
      if (url.endsWith('/ai/tailored-resume')) {
        expect(JSON.parse(options.body)).toEqual({
          profileContextId: 'context-1',
          resumeId: 'resume-1',
          requestId: 'request-uuid',
          job: { description: 'Build products' },
          model: 'provider/chosen',
        });
        return jsonResponse({
          profileId: 'profile-1', profileContextId: 'context-1', created: true, resume,
        }, { status: 201 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });

    await expect(service.handleMessage({
      type: 'resume.tailor',
      profileContextId: 'context-1',
      resumeId: 'resume-1',
      requestId: 'request-uuid',
      job: { description: 'Build products' },
          model: 'provider/chosen',
    })).resolves.toMatchObject({ created: true, resume });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:17872/resumes',
      'http://127.0.0.1:17872/ai/tailored-resume',
    ]);
  });
});


describe('privacy consent and disconnection', () => {
  it('blocks all processing before explicit consent, including page scanning and reading resumes', async () => {
    const { chromeApi } = createChrome({ consent: false });
    const fetchImpl = vi.fn();
    const service = createBackgroundService({ chromeApi, fetchImpl });
    expect(await service.handleMessage({ type: 'privacy.status' })).toEqual({ accepted: false });
    for (const type of ['connection.check', 'app.open', 'ai.models', 'page.scan', 'mapping.create', 'page.fill', 'answer.save']) {
      await expect(service.handleMessage({ type })).rejects.toMatchObject({ code: 'consent_required' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    await expect(service.handleMessage({ type: 'privacy.accept' })).rejects.toMatchObject({ code: 'consent_required' });
    expect(await service.handleMessage({ type: 'privacy.accept', accepted: true })).toEqual({ accepted: true });
    expect(await service.handleMessage({ type: 'privacy.status' })).toEqual({ accepted: true });
  });

  it('revokes app access before forgetting the session and consent', async () => {
    const { chromeApi, getStoredToken } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async (url) => jsonResponse(url.endsWith('/health') ? HEALTH : { ok: true }));
    const service = createBackgroundService({ chromeApi, fetchImpl });
    expect(await service.handleMessage({ type: 'pairing.disconnect' })).toEqual({ disconnected: true, revoked: true });
    expect(fetchImpl.mock.calls[1][0]).toMatch(/\/pairing\/revoke$/);
    expect(new Headers(fetchImpl.mock.calls[1][1].headers).get('Authorization')).toBe('Bearer paired');
    expect(getStoredToken()).toBe('');
    expect(await service.handleMessage({ type: 'privacy.status' })).toEqual({ accepted: false });
  });

  it('forgets this browser honestly when the desktop cannot revoke', async () => {
    const { chromeApi, getStoredToken } = createChrome({ token: 'paired' });
    const service = createBackgroundService({ chromeApi, fetchImpl: vi.fn(async () => { throw new Error('offline'); }) });
    expect(await service.handleMessage({ type: 'pairing.disconnect' })).toEqual({ disconnected: true, revoked: false });
    expect(getStoredToken()).toBe('');
    expect(await service.handleMessage({ type: 'privacy.status' })).toEqual({ accepted: false });
  });

  it('does not claim app-wide revocation when this browser has no token', async () => {
    const { chromeApi } = createChrome();
    const fetchImpl = vi.fn();
    const service = createBackgroundService({ chromeApi, fetchImpl });
    expect(await service.handleMessage({ type: 'pairing.disconnect' }))
      .toEqual({ disconnected: true, revoked: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['pairing.save', 'app.open'])('does not restore a pending %s token after another panel disconnects', async (type) => {
    const verification = deferred();
    const { chromeApi, getStoredToken } = createChrome();
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      if (url.endsWith('/pairing/claim')) return jsonResponse({ token: 'late-token' });
      if (url.endsWith('/resumes')) return verification.promise;
      throw new Error(`Unexpected URL ${url}`);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl, pollAttempts: 1 });
    const pending = service.handleMessage({ type, token: 'late-token' });
    await vi.waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/resumes'))).toBe(true));
    await service.handleMessage({ type: 'pairing.disconnect' });
    verification.resolve(jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] }));
    await expect(pending).rejects.toMatchObject({ code: type === 'app.open' ? 'pairing_cancelled' : 'not_paired' });
    expect(getStoredToken()).toBe('');
  });

  it('cancels a fill paused at injection as soon as another panel starts disconnecting', async () => {
    const injection = deferred();
    const revocation = deferred();
    const { chromeApi } = createChrome({ token: 'paired' });
    chromeApi.scripting.executeScript.mockReturnValue(injection.promise);
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      if (url.endsWith('/pairing/revoke')) return revocation.promise;
      return jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] });
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });
    const fill = service.handleMessage({
      type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-1', resumeId: 'resume-1',
      fields: [{ field_id: 'name', value: 'Jane' }],
    });
    await vi.waitFor(() => expect(chromeApi.scripting.executeScript).toHaveBeenCalledOnce());
    const disconnect = service.handleMessage({ type: 'pairing.disconnect' });
    injection.resolve([]);
    await expect(fill).rejects.toMatchObject({ code: 'not_paired' });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    revocation.resolve(jsonResponse({ ok: true }));
    await disconnect;
  });

  it('drops a pending PDF fill even if another panel reconnects before export finishes', async () => {
    const pdf = deferred();
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      if (url.endsWith('/pairing/revoke')) return jsonResponse({ ok: true });
      if (url.endsWith('/pdf')) return pdf.promise;
      return jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] });
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });
    const fill = service.handleMessage({
      type: 'page.fill', reviewContext: REVIEW_CONTEXT, profileContextId: 'context-1', resumeId: 'resume-1', fields: PDF_FIELD,
    });
    await vi.waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/pdf'))).toBe(true));
    await service.handleMessage({ type: 'pairing.disconnect' });
    await service.handleMessage({ type: 'privacy.accept', accepted: true });
    await chromeApi.storage.session.set({ bridgeToken: 'new-session' });
    pdf.resolve(jsonResponse({
      profileId: 'profile-1', profileContextId: 'context-1', filename: 'Resume.pdf', pdfBase64: 'UERG',
    }));
    await expect(fill).rejects.toMatchObject({ code: 'not_paired' });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('never saves sensitive answers through a crafted runtime request', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn();
    const service = createBackgroundService({ chromeApi, fetchImpl });
    await expect(service.handleMessage({ type: 'answer.save', question: 'Do you have a disability?', answer: 'Yes' })).rejects.toMatchObject({ code: 'sensitive_field' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});


describe('AI model and narrative context transport', () => {
  it('reads the model catalog through the authenticated loopback bridge', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const catalog = { models: [{id: 'provider/chosen', name: 'Chosen'}], defaults: {mapping: 'provider/chosen'} };
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe('http://127.0.0.1:17872/ai/models');
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer paired');
      return jsonResponse(catalog);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });
    expect(await service.handleMessage({type: 'ai.models'})).toEqual(catalog);
  });

  it('carries job context and an explicit model into the actual mapping AI request', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const job = {company: 'Fieldwork', title: 'Designer', description: 'Accessible collaboration tools.'};
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/resumes')) return jsonResponse({profileId: 'profile', profileContextId: 'context', resumes: []});
      if (url.endsWith('/resumes/resume')) return jsonResponse({profileId: 'profile', profileContextId: 'context', data: {summary: 'Product designer.'}});
      if (url.endsWith('/ai/complete')) {
        const body = JSON.parse(options.body);
        expect(body.model).toBe('provider/chosen');
        expect(JSON.parse(body.messages[0].content).job).toEqual(job);
        return jsonResponse({text: JSON.stringify({fields: [{field_id: 'motivation', value: 'I am interested in applying my product design experience to accessible collaboration tools.', confidence: 0.8, source: 'draft'}], needs_human: []})});
      }
      throw new Error('Unexpected request');
    });
    const service = createBackgroundService({chromeApi, fetchImpl});
    const result = await service.handleMessage({type: 'mapping.create', profileContextId: 'context', resumeId: 'resume', descriptors: [{field_id: 'motivation', type: 'textarea', label: 'What interests you about this role?'}], job, model: 'provider/chosen'});
    expect(result.fields[0].source).toBe('draft');
  });
});

 describe('connection recovery and cancellation', () => {
  const warmHealth = { ...HEALTH, capabilities: [...HEALTH.capabilities, 'pairing.request'] };
  const context = { profileId: 'profile-1', profileContextId: 'context-1', resumes: [] };

  it('pairs with a running app through native approval without relying on the OS URL handler', async () => {
    const { chromeApi, getStoredToken } = createChrome();
    let request;
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/health')) return jsonResponse(warmHealth);
      if (url.endsWith('/pairing/request')) {
        request = JSON.parse(options.body);
        expect(request.clientId).toBe('a'.repeat(32));
        expect(request.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(request).not.toHaveProperty('verifier');
        return jsonResponse({ pending: true }, { status: 202 });
      }
      if (url.endsWith('/pairing/claim')) {
        expect(JSON.parse(options.body).requestId).toBe(request.requestId);
        return jsonResponse({ token: 'approved-token' });
      }
      return jsonResponse(context);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });
    expect(await service.handleMessage({ type: 'app.open' })).toMatchObject({ connected: true });
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
    expect(getStoredToken()).toBe('approved-token');
  });

  it('cancels pending approval immediately and keeps manual pairing safe from late completion', async () => {
    const { chromeApi, getStoredToken } = createChrome();
    const claim = deferred();
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/health')) return jsonResponse(warmHealth);
      if (url.endsWith('/pairing/request')) return jsonResponse({ pending: true }, { status: 202 });
      if (url.endsWith('/pairing/claim')) return claim.promise;
      return jsonResponse(context);
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });
    const opening = service.handleMessage({ type: 'app.open' });
    const rejected = expect(opening).rejects.toMatchObject({ code: 'pairing_cancelled' });
    await vi.waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/pairing/claim'))).toBe(true));
    expect(await service.handleMessage({ type: 'pairing.cancel' })).toEqual({ cancelled: true });
    await rejected;
    await service.handleMessage({ type: 'pairing.save', token: 'manual-token' });
    claim.resolve(jsonResponse({ token: 'late-auto-token' }));
    await Promise.resolve();
    expect(getStoredToken()).toBe('manual-token');
    expect(await service.handleMessage({ type: 'privacy.status' })).toEqual({ accepted: true });
  });

  it('bounds the full opening attempt even if launching the app never resolves', async () => {
    vi.useFakeTimers();
    try {
      const { chromeApi } = createChrome();
      chromeApi.tabs.create.mockImplementation(() => new Promise(() => {}));
      const fetchImpl = vi.fn(async () => { throw new TypeError('offline'); });
      const service = createBackgroundService({ chromeApi, fetchImpl, openingTimeoutMs: 25 });
      const opening = service.handleMessage({ type: 'app.open' });
      const rejected = expect(opening).rejects.toMatchObject({ code: 'launch_failed' });
      await vi.advanceTimersByTimeAsync(25);
      await rejected;
    } finally { vi.useRealTimers(); }
  });

  it('distinguishes a missing OS delivery from a native approval that expired', async () => {
    for (const pending of [false, true]) {
      const { chromeApi } = createChrome();
      const service = createBackgroundService({ chromeApi, pollAttempts: 1, fetchImpl: async (url) => (
        url.endsWith('/health') ? jsonResponse(HEALTH) : jsonResponse({ code: pending ? 'pairing_pending' : 'pairing_not_found' }, { status: pending ? 425 : 404 })
      ) });
      await expect(service.handleMessage({ type: 'app.open' })).rejects.toMatchObject({ code: pending ? 'pairing_timeout' : 'pairing_not_received' });
    }
  });
});

 describe('reviewed application tab binding', () => {
  const contextResponse = () => jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] });
  it('rejects missing review context before exporting or sending field values', async () => {
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(contextResponse);
    const service = createBackgroundService({ chromeApi, fetchImpl });
    await expect(service.handleMessage({ type: 'page.fill', profileContextId: 'context-1', fields: PDF_FIELD }))
      .rejects.toMatchObject({ code: 'stale_review' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a switch to another tab with the same URL before exporting the PDF', async () => {
    const { chromeApi } = createChrome({ token: 'paired', tab: { id: 18, url: REVIEW_CONTEXT.page.url } });
    const fetchImpl = vi.fn(contextResponse);
    const service = createBackgroundService({ chromeApi, fetchImpl });
    await expect(service.handleMessage({ type: 'page.fill', profileContextId: 'context-1', fields: PDF_FIELD, reviewContext: REVIEW_CONTEXT }))
      .rejects.toMatchObject({ code: 'stale_review' });
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/pdf'))).toBe(false);
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('never sends a PDF or answers to a tab selected while the PDF was exporting', async () => {
    const pdf = deferred();
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async (url) => url.endsWith('/pdf') ? pdf.promise : contextResponse());
    const service = createBackgroundService({ chromeApi, fetchImpl });
    const fill = service.handleMessage({ type: 'page.fill', profileContextId: 'context-1', resumeId: 'resume-1', fields: PDF_FIELD, reviewContext: REVIEW_CONTEXT });
    await vi.waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/pdf'))).toBe(true));
    chromeApi.tabs.query.mockResolvedValue([{ id: 18, url: REVIEW_CONTEXT.page.url }]);
    pdf.resolve(jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', filename: 'Resume.pdf', pdfBase64: 'UERG' }));
    await expect(fill).rejects.toMatchObject({ code: 'stale_review' });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('rechecks the original URL after delayed content injection', async () => {
    const injection = deferred();
    const { chromeApi } = createChrome({ token: 'paired' });
    chromeApi.scripting.executeScript.mockReturnValue(injection.promise);
    const service = createBackgroundService({ chromeApi, fetchImpl: async () => contextResponse() });
    const fill = service.handleMessage({ type: 'page.fill', profileContextId: 'context-1', fields: [{field_id:'name',value:'Jane'}], reviewContext: REVIEW_CONTEXT });
    await vi.waitFor(() => expect(chromeApi.scripting.executeScript).toHaveBeenCalledOnce());
    chromeApi.tabs.query.mockResolvedValue([{ id: 17, url: 'https://jobs.example.test/another-role' }]);
    injection.resolve([]);
    await expect(fill).rejects.toMatchObject({ code: 'stale_review' });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });
});

 describe('native pairing protocol integration', () => {
  it('completes the real challenge, native approval, and one-time proof flow without a deep link', async () => {
    const { createBridgeRouter } = await import('../../resume-designer/src/bridgeRoutes.js');
    const { createCompanionPairing } = await import('../../resume-designer/src/companionPairing.js');
    const approval = deferred();
    const nextPoll = deferred();
    const ensureToken = vi.fn(() => 'native-install-token');
    const pairing = createCompanionPairing({ confirmPairing: () => approval.promise, ensureToken });
    const router = createBridgeRouter({ version: '1.0.0', profileId: 'profile-1', profileContextId: 'context-1',
      getToken: () => 'native-install-token', getVariants: () => ({}), requestPairing: pairing.request, claimPairing: pairing.claim });
    const { chromeApi, getStoredToken } = createChrome();
    chromeApi.runtime.id = 'keggfbelidgpjiapcbgkjidenhdjmega';
    const fetchImpl = vi.fn(async (url, options) => {
      // Rust derives the claim client ID from the validated browser Origin.
      const body = url.endsWith('/pairing/claim')
        ? JSON.stringify({ ...JSON.parse(options.body), clientId: chromeApi.runtime.id })
        : options.body;
      const response = await router({ method: options.method, path: new URL(url).pathname,
        authorization: options.headers.get('Authorization'), body });
      return jsonResponse(response.body, { status: response.status });
    });
    const service = createBackgroundService({ chromeApi, fetchImpl, waitImpl: () => nextPoll.promise, pollAttempts: 3 });
    const operation = service.handleMessage({ type: 'app.open' });
    await vi.waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/pairing/claim'))).toBe(true));
    expect(ensureToken).not.toHaveBeenCalled();
    expect(getStoredToken()).toBe('');
    approval.resolve(true);
    await Promise.resolve();
    nextPoll.resolve();
    expect(await operation).toMatchObject({ connected: true, profileContextId: 'context-1' });
    expect(ensureToken).toHaveBeenCalledOnce();
    expect(getStoredToken()).toBe('native-install-token');
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
  });
});


describe('disconnecting pending profile mutations', () => {
  const mutations = [
    ['answer.save', '/profile/answers', { question: 'Notice period?', answer: 'Two weeks' }],
    ['application.log', '/applications', { variantId: 'resume-1', company: 'Example' }],
    ['resume.tailor', '/ai/tailored-resume', { resumeId: 'resume-1', requestId: 'request-id', job: { description: 'Build products' } }],
  ];

  it.each(mutations)('does not send %s after disconnect during its profile preflight', async (type, path, payload) => {
    const preflight = deferred();
    const { chromeApi } = createChrome({ token: 'paired' });
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      if (url.endsWith('/pairing/revoke')) return jsonResponse({ ok: true });
      if (url.endsWith('/resumes')) return preflight.promise;
      return jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1' });
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });
    const operation = service.handleMessage({ type, profileContextId: 'context-1', ...payload });
    const outcome = operation.catch((error) => error);
    await vi.waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/resumes'))).toBe(true));
    await service.handleMessage({ type: 'pairing.disconnect' });
    await service.handleMessage({ type: 'privacy.accept', accepted: true });
    await chromeApi.storage.session.set({ bridgeToken: 'new-session' });
    preflight.resolve(jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] }));
    expect(await outcome).toMatchObject({ code: 'not_paired', retryable: false });
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith(path))).toBe(false);
  });

  it.each(mutations)('aborts in-flight %s when another panel disconnects', async (type, path, payload) => {
    const response = deferred();
    const { chromeApi } = createChrome({ token: 'paired' });
    let requestSignal;
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/health')) return jsonResponse(HEALTH);
      if (url.endsWith('/pairing/revoke')) return jsonResponse({ ok: true });
      if (url.endsWith(path)) { requestSignal = options.signal; return response.promise; }
      return jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', resumes: [] });
    });
    const service = createBackgroundService({ chromeApi, fetchImpl });
    const operation = service.handleMessage({ type, profileContextId: 'context-1', ...payload });
    const outcome = operation.catch((error) => error);
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await service.handleMessage({ type: 'pairing.disconnect' });
    response.resolve(jsonResponse({ profileId: 'profile-1', profileContextId: 'context-1', created: true }));
    expect(requestSignal.aborted).toBe(true);
    expect(await outcome).toMatchObject({ code: 'not_paired', retryable: false });
  });
});


it('purges pending application identity on disconnect', async () => {
  const { chromeApi } = createChrome({ token: 'paired', pendingApplicationRequest: { profileId: 'profile-old', fingerprint: 'opaque-hash', requestId: '550e8400-e29b-41d4-a716-446655440000' } });
  const fetchImpl = vi.fn(async (url) => {
    if (url.endsWith('/health')) return jsonResponse(HEALTH);
    if (url.endsWith('/resumes')) return jsonResponse({ profileId: 'profile-new', profileContextId: 'context-new', resumes: [] });
    if (url.endsWith('/pairing/revoke')) return jsonResponse({ ok: true });
    throw new Error(`Unexpected URL ${url}`);
  });
  const service = createBackgroundService({ chromeApi, fetchImpl });
  await service.handleMessage({ type: 'pairing.disconnect' });
  expect((await chromeApi.storage.session.get('pendingApplicationRequest')).pendingApplicationRequest).toBeNull();
});
