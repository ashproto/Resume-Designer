import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createBackgroundService } from '../src/background.js';

let contentListener;
beforeAll(async () => {
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: (listener) => { contentListener = listener; } } } });
  await import('../src/content.js?background-content-integration');
});
afterAll(() => vi.unstubAllGlobals());

function application(url) {
  const dom = new JSDOM('<h1>Product Designer</h1><section id="job-description">Build accessible tools.</section><form><label>Full name <input name="name"></label></form>', { url });
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('location', dom.window.location);
  const tab = { id: 17, url };
  const sendMessage = vi.fn(async (_tabId, message) => {
    let response;
    contentListener(message, {}, (value) => { response = value; });
    return response;
  });
  const chromeApi = {
    storage: {
      local: { get: async () => ({ privacyConsentVersion: 1 }) },
      session: { get: async () => ({ bridgeToken: 'synthetic-token' }) },
    },
    tabs: { query: async () => [tab], sendMessage },
    scripting: { executeScript: async () => [] },
  };
  const service = createBackgroundService({ chromeApi, fetchImpl: async () => new Response(JSON.stringify({ profileId: 'profile', profileContextId: 'context', resumes: [] })) });
  return { dom, tab, service, sendMessage };
}

describe('background and content review URL agreement', () => {
  it.each([
    'https://jobs.example.com/apply?job=123&candidate=private',
    'https://jobs.example.com/apply#application',
    'https://jobs.example.com/apply?job=123#application',
  ])('fills an unchanged reviewed application at %s', async (url) => {
    const { dom, service } = application(url);
    const reviewContext = await service.handleMessage({ type: 'page.scan' });
    const fieldId = reviewContext.descriptors[0].field_id;
    const result = await service.handleMessage({ type: 'page.fill', profileContextId: 'context', resumeId: 'resume', reviewContext,
      fields: [{ field_id: fieldId, value: 'Jordan Lee' }] });
    expect(result.filled).toEqual([fieldId]);
    expect(dom.window.document.querySelector('input').value).toBe('Jordan Lee');
    expect(reviewContext.page.url).toBe('https://jobs.example.com/apply');
    expect(reviewContext.page.tabUrl).toBe(url);
  });

  it.each([
    'https://jobs.example.com/apply?job=456#application',
    'https://jobs.example.com/apply?job=123#different-form',
  ])('blocks a changed raw tab URL even if sanitized job context is identical: %s', async (nextUrl) => {
    const { dom, tab, service, sendMessage } = application('https://jobs.example.com/apply?job=123#application');
    const reviewContext = await service.handleMessage({ type: 'page.scan' });
    tab.url = nextUrl;
    dom.reconfigure({ url: nextUrl });
    await expect(service.handleMessage({ type: 'page.fill', profileContextId: 'context', resumeId: 'resume', reviewContext,
      fields: [{ field_id: reviewContext.descriptors[0].field_id, value: 'Jordan Lee' }] }))
      .rejects.toMatchObject({ code: 'stale_review' });
    expect(dom.window.document.querySelector('input').value).toBe('');
    expect(sendMessage.mock.calls.some(([, message]) => message.type === 'content.fill')).toBe(false);
  });
});
