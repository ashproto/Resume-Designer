import { JSDOM } from 'jsdom';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const INSTALL_MARKER = '__resumeDesignerCompanionContentInstalled';

let listener;
let addListener;

function installDocument(html, url = 'https://jobs.example.com/platform-engineer') {
  const document = new JSDOM(html, { url }).window.document;
  vi.stubGlobal('document', document);
  vi.stubGlobal('location', document.defaultView.location);
  return document;
}

function relay(message) {
  const sendResponse = vi.fn();
  const returnValue = listener(message, {}, sendResponse);

  return { returnValue, sendResponse, response: sendResponse.mock.calls[0]?.[0] };
}

beforeAll(async () => {
  Reflect.deleteProperty(globalThis, INSTALL_MARKER);
  addListener = vi.fn((registered) => {
    listener = registered;
  });
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener },
    },
  });

  await import('../src/content.js?content-test-first-install');
  await import('../src/content.js?content-test-second-install');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('content relay', () => {
  it('refuses a fill without the reviewed page context', () => {
    const document = installDocument('<form><label>Name <input value="original"></label></form>');
    const scan = relay({ type: 'content.scan' }).response;
    const response = relay({ type: 'content.fill', payload: { fields: [{ field_id: scan.descriptors[0].field_id, value: 'replacement' }] } }).response;
    expect(response.filled).toEqual([]);
    expect(response.unfilled[0].reason).toMatch(/review/i);
    expect(document.querySelector('input').value).toBe('original');
  });

  it('rejects a review after a single-page application changes the role', () => {
    const document = installDocument('<h1>Designer</h1><form><label>Name <input value="original"></label></form>');
    const scan = relay({ type: 'content.scan' }).response;
    document.querySelector('h1').textContent = 'Different job';
    const response = relay({ type: 'content.fill', payload: { reviewContext: scan, fields: [{ field_id: scan.descriptors[0].field_id, value: 'replacement' }] } }).response;
    expect(response.filled).toEqual([]);
    expect(document.querySelector('input').value).toBe('original');
  });

  it('leaves relabelled or duplicated controls untouched while filling unchanged reviewed fields', () => {
    const document = installDocument('<form><label id="label">Name <input value="original"></label><label>City <input value="original"></label><label>Portfolio <input value="original"></label></form>');
    const scan = relay({ type: 'content.scan' }).response;
    document.querySelector('#label').firstChild.textContent = 'Different question';
    const portfolio = document.querySelectorAll('input')[2];
    portfolio.after(portfolio.cloneNode(true));
    const response = relay({ type: 'content.fill', payload: { reviewContext: scan, fields: scan.descriptors.map(({ field_id }) => ({ field_id, value: 'replacement' })) } }).response;
    expect(response.filled).toEqual([scan.descriptors[1].field_id]);
    expect([...document.querySelectorAll('input')].map((input) => input.value)).toEqual(['original', 'replacement', 'original', 'original']);
  });

  it('installs exactly one runtime listener across repeated entry evaluation', () => {
    expect(addListener).toHaveBeenCalledOnce();
    expect(listener).toBeTypeOf('function');
  });

  it('routes content.scan to compact descriptors and page context', () => {
    const document = installDocument(`
      <main>
        <h1>Platform Engineer</h1>
        <section id="job-description"><p>Build reliable local-first software.</p></section>
        <form><label>Full name <input name="name" required></label></form>
      </main>
    `, 'https://jobs.example.com/platform-engineer?candidate=private#application');

    const { returnValue, sendResponse, response } = relay({ type: 'content.scan' });

    expect(returnValue).toBe(false);
    expect(sendResponse).toHaveBeenCalledOnce();
    expect(response).toEqual({
      descriptors: [
        {
          field_id: expect.any(String),
          label: 'Full name',
          type: 'text',
          options: [],
          required: true,
        },
      ],
      page: {
        company: 'jobs.example.com',
        title: 'Platform Engineer',
        url: 'https://jobs.example.com/platform-engineer',
        description: 'Build reliable local-first software.',
        fingerprint: expect.any(String),
      },
    });
    expect(document.querySelector('input').dataset.resumeDesignerFieldId).toBe(
      response.descriptors[0].field_id,
    );
  });

  it('routes content.fill to the pure fill engine and returns its result', () => {
    const document = installDocument(`
      <form>
        <label>Email <input type="email" required></label>
        <label>Has portfolio <input type="checkbox"></label>
      </form>
    `);
    const scan = relay({ type: 'content.scan' }).response;
    const [email, terms] = scan.descriptors;
    const { returnValue, sendResponse, response } = relay({
      type: 'content.fill',
      payload: {
        reviewContext: scan,
        fields: [
          { field_id: email.field_id, value: 'ada@example.com' },
          { field_id: terms.field_id, value: 'true' },
        ],
      },
    });

    expect(returnValue).toBe(false);
    expect(sendResponse).toHaveBeenCalledOnce();
    expect(response).toEqual({ filled: [email.field_id, terms.field_id], unfilled: [] });
    expect(document.querySelector('input[type="email"]').value).toBe('ada@example.com');
    expect(document.querySelector('input[type="checkbox"]').checked).toBe(true);
  });

  it('forwards the optional PDF payload inside the content.fill envelope', () => {
    const document = installDocument(`
      <form><label>Resume <input type="file" accept="application/pdf"></label></form>
    `);
    const input = document.querySelector('input');
    const files = [];

    Object.defineProperty(input, 'files', {
      configurable: true,
      get: () => files,
      set: (assigned) => {
        files.splice(0, files.length, ...assigned);
      },
    });
    document.defaultView.DataTransfer = class DataTransfer {
      constructor() {
        this.items = { add: (file) => this.files.push(file) };
        this.files = [];
      }
    };

    const scan = relay({ type: 'content.scan' }).response;
    const fileField = scan.descriptors[0];
    const response = relay({
      type: 'content.fill',
      payload: {
        fields: [{ field_id: fileField.field_id, value: '__resume_pdf__' }],
        reviewContext: scan,
        pdf: {
          filename: 'Platform-Engineer.pdf',
          pdfBase64: Buffer.from('%PDF relay').toString('base64'),
        },
      },
    }).response;

    expect(response).toEqual({ filled: [fileField.field_id], unfilled: [] });
    expect(input.files).toHaveLength(1);
    expect(input.files[0]).toMatchObject({
      name: 'Platform-Engineer.pdf',
      type: 'application/pdf',
    });
  });

  it('ignores submit-shaped and unrelated messages without touching the page', () => {
    const document = installDocument(`
      <form>
        <label>Name <input></label>
        <button type="submit">Submit application</button>
      </form>
    `);
    const form = document.querySelector('form');
    const button = document.querySelector('button');
    const submitSpy = vi.fn();
    const requestSubmitSpy = vi.fn();
    const submitEventSpy = vi.fn();
    const clickSpy = vi.spyOn(button, 'click');

    form.submit = submitSpy;
    form.requestSubmit = requestSubmitSpy;
    form.addEventListener('submit', submitEventSpy);

    for (const type of ['content.submit', 'unrelated']) {
      const { returnValue, sendResponse } = relay({ type });

      expect(returnValue).toBe(false);
      expect(sendResponse).not.toHaveBeenCalled();
    }

    expect(submitSpy).not.toHaveBeenCalled();
    expect(requestSubmitSpy).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
    expect(submitEventSpy).not.toHaveBeenCalled();
  });
});
