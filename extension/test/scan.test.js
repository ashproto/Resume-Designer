import { readFileSync } from 'node:fs';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import {
  FIELD_ID_ATTRIBUTE,
  scanForm,
  scrapePageContext,
} from '../src/content/scan.js';

const fixtureUrls = {
  greenhouse: 'https://job-boards.greenhouse.io/example/jobs/job-token',
  lever: 'https://jobs.lever.co/example/job-token/apply',
  ashby: 'https://jobs.ashbyhq.com/example/job-token/application',
};

function loadFixture(name) {
  const html = readFileSync(new URL(`./fixtures/${name}-form.html`, import.meta.url), 'utf8');
  return new JSDOM(html, { url: fixtureUrls[name] }).window.document;
}

describe('scanForm', () => {
  it.each(['hidden', 'inert', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"', 'style="visibility:collapse"'])('omits a file input inside an unavailable ancestor: %s', (attribute) => {
    const document = new JSDOM(`<form><div ${attribute}><label>Resume <input type="file" accept="application/pdf"></label></div></form>`).window.document;
    expect(scanForm(document)).toEqual([]);
    expect(document.querySelector('input').hasAttribute(FIELD_ID_ATTRIBUTE)).toBe(false);
  });

  it('honors inert on a file input itself while preserving direct hidden upload proxies', () => {
    const document = new JSDOM('<form><label>Inert resume <input type="file" inert></label><label>Resume <input type="file" hidden style="display:none" aria-hidden="true"></label></form>').window.document;
    expect(scanForm(document).map(({ label }) => label)).toEqual(['Resume']);
  });

  it('ignores read-only and hidden text controls while retaining identified hidden file inputs', () => {
    const document = new JSDOM(`<form>
      <label>Name <input></label>
      <label>Locked <input readonly value="fixed"></label>
      <div hidden><label>Internal <input></label></div>
      <div style="display:none"><label>Other step <textarea></textarea></label></div>
      <label>Unavailable <input aria-disabled="true"></label>
      <label>Resume <input type="file" style="display:none" accept=".pdf"></label>
    </form>`).window.document;
    expect(scanForm(document).map(({ label }) => label)).toEqual(['Name', 'Resume']);
  });

  it('omits disabled select choices and exposes native input constraints for grounded mapping', () => {
    const document = new JSDOM(`<form>
      <label>Email <input type="email" maxlength="100"></label>
      <label>Office <select><option disabled value="old">Closed</option><optgroup disabled><option value="other">Other</option></optgroup><option value="remote">Remote</option></select></label>
    </form>`).window.document;
    const [email, office] = scanForm(document);
    expect(email).toMatchObject({ inputType: 'email', maxLength: 100 });
    expect(office.options).toEqual([{ value: 'remote', label: 'Remote' }]);
  });

  it('uses the documented label precedence and required signals', () => {
    const document = new JSDOM(`
      <form>
        <label for="associated">Associated label</label>
        <input id="associated" name="associated_name" aria-label="ARIA label" placeholder="Placeholder" required>
        <input name="aria_name" aria-label="ARIA label" aria-labelledby="reference" placeholder="Placeholder" aria-required="true">
        <span id="reference">Referenced label</span>
        <input name="referenced_name" aria-labelledby="reference" placeholder="Placeholder">
        <input name="placeholder_name" placeholder="Placeholder label">
        <fieldset><legend>Legend label</legend><input type="text"></fieldset>
        <div><span>Nearby field label</span><input type="text"></div>
        <input name="fallback_name">
      </form>
    `).window.document;

    const descriptors = scanForm(document);

    expect(descriptors.map(({ label }) => label)).toEqual([
      'Associated label',
      'ARIA label',
      'Referenced label',
      'Placeholder label',
      'Legend label',
      'Nearby field label',
      'fallback_name',
    ]);
    expect(descriptors.map(({ required }) => required)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('scans Greenhouse fields in DOM order with select options and manual custom comboboxes', () => {
    const document = loadFixture('greenhouse');

    const descriptors = scanForm(document);

    expect(descriptors.map(({ label, type }) => [label, type])).toEqual([
      ['First Name', 'text'],
      ['Email', 'text'],
      ['Country', 'custom'],
      ['Favorite office', 'select'],
      ['Resume/CV', 'file'],
      ['Work authorization', 'radio'],
    ]);
    expect(descriptors.find(({ label }) => label === 'Favorite office')?.options).toEqual([
      { value: '', label: 'Select an office' },
      { value: 'nyc', label: 'New York' },
      { value: 'remote', label: 'Remote' },
    ]);
    expect(descriptors.find(({ label }) => label === 'Country')?.required).toBe(true);
    expect(descriptors.find(({ label }) => label === 'Resume/CV')?.required).toBe(true);
    const workAuthorization = descriptors.find(({ label }) => label === 'Work authorization');
    const authorizationControls = [...document.querySelectorAll('input[name="work_authorization"]')];
    expect(workAuthorization).toMatchObject({
      type: 'radio',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    });
    expect(authorizationControls.map((element) => (
      element.getAttribute(FIELD_ID_ATTRIBUTE)
    ))).toEqual([
      workAuthorization.field_id,
      workAuthorization.field_id,
    ]);
    expect(document.querySelector('#country-required-helper').hasAttribute(FIELD_ID_ATTRIBUTE)).toBe(false);
    expect(document.querySelector('#disabled-helper').hasAttribute(FIELD_ID_ATTRIBUTE)).toBe(false);
    expect(document.querySelector('#fieldset-disabled-helper').hasAttribute(FIELD_ID_ATTRIBUTE)).toBe(false);
    expect(document.querySelector('#hidden-helper').hasAttribute(FIELD_ID_ATTRIBUTE)).toBe(false);
  });

  it('groups same-name radios, repairs default values from labels, and keeps checkbox options independent', () => {
    const document = loadFixture('lever');

    const descriptors = scanForm(document);
    const radio = descriptors.find(({ type }) => type === 'radio');
    const checkboxes = descriptors.filter(({ type }) => type === 'checkbox');
    const radioElements = [...document.querySelectorAll('input[type="radio"]')];

    expect(radio).toMatchObject({
      label: 'Preferred schedule',
      type: 'radio',
      options: [
        { value: 'Remote', label: 'Remote' },
        { value: 'hybrid', label: 'Hybrid' },
      ],
      required: true,
    });
    expect(radioElements.map((element) => element.getAttribute(FIELD_ID_ATTRIBUTE))).toEqual([
      radio.field_id,
      radio.field_id,
    ]);
    expect(checkboxes.map(({ label }) => label)).toEqual([
      'Skills: JavaScript',
      'Skills: Accessibility',
    ]);
    expect(new Set(checkboxes.map(({ field_id }) => field_id)).size).toBe(2);
    expect(checkboxes.every(({ options }) => options.length === 0)).toBe(true);
  });

  it('does not merge Yes/No checkboxes owned by different forms', () => {
    const document = new JSDOM(`
      <form id="first"></form>
      <form id="second"></form>
      <fieldset>
        <legend>Work authorization</legend>
        <label><input form="first" type="checkbox" name="authorized" value="yes"> Yes</label>
        <label><input form="second" type="checkbox" name="authorized" value="no"> No</label>
      </fieldset>
    `).window.document;

    const descriptors = scanForm(document);

    expect(descriptors).toHaveLength(2);
    expect(descriptors.map(({ label, type }) => [label, type])).toEqual([
      ['Work authorization: Yes', 'checkbox'],
      ['Work authorization: No', 'checkbox'],
    ]);
    expect(new Set(descriptors.map(({ field_id }) => field_id)).size).toBe(2);
  });

  it('scopes named radio groups to form owners while keeping unnamed radios independent', () => {
    const document = new JSDOM(`
      <form id="first-form">
        <fieldset>
          <legend>First choice</legend>
          <label><input type="radio" name="choice" value="first-a"> First A</label>
          <label><input type="radio" name="choice" value="first-b"> First B</label>
          <label><input type="radio"> First unnamed</label>
        </fieldset>
      </form>
      <form id="second-form">
        <fieldset>
          <legend>Second choice</legend>
          <label><input type="radio" name="choice" value="second-a"> Second A</label>
          <label><input type="radio" name="choice" value="second-b"> Second B</label>
          <label><input type="radio"> Second unnamed</label>
        </fieldset>
      </form>
    `).window.document;

    const descriptors = scanForm(document).filter(({ type }) => type === 'radio');
    const firstNamed = [...document.querySelectorAll('#first-form input[name="choice"]')];
    const secondNamed = [...document.querySelectorAll('#second-form input[name="choice"]')];

    expect(descriptors.map(({ options }) => options.map(({ value }) => value))).toEqual([
      ['first-a', 'first-b'],
      ['First unnamed'],
      ['second-a', 'second-b'],
      ['Second unnamed'],
    ]);
    expect(firstNamed.map((element) => element.getAttribute(FIELD_ID_ATTRIBUTE))).toEqual([
      descriptors[0].field_id,
      descriptors[0].field_id,
    ]);
    expect(secondNamed.map((element) => element.getAttribute(FIELD_ID_ATTRIBUTE))).toEqual([
      descriptors[2].field_id,
      descriptors[2].field_id,
    ]);
    expect(new Set(descriptors.map(({ field_id }) => field_id)).size).toBe(4);
  });

  it('skips Ashby helper controls while retaining its labelled resume and custom fields', () => {
    const document = loadFixture('ashby');
    const helperFile = document.querySelector('input[type="file"]:not([id])');

    const descriptors = scanForm(document);

    expect(descriptors.filter(({ type }) => type === 'file')).toEqual([
      expect.objectContaining({ label: 'Resume', type: 'file' }),
    ]);
    expect(descriptors).toContainEqual(expect.objectContaining({
      label: 'Location',
      type: 'custom',
      required: true,
    }));
    expect(descriptors).toContainEqual(expect.objectContaining({
      label: 'Are you willing to travel?',
      type: 'custom',
    }));
    expect(helperFile.hasAttribute(FIELD_ID_ATTRIBUTE)).toBe(false);
    expect(descriptors.some(({ label }) => label === 'Yes' || label === 'No')).toBe(false);
  });

  it('does not treat an ordinary checkbox as button-backed due to unrelated Yes/No buttons', () => {
    const document = new JSDOM(`
      <form>
        <div class="application-section">
          <span>Send me updates</span>
          <input type="checkbox" name="updates" tabindex="-1">
          <div class="unrelated-actions">
            <button type="button">Yes</button>
            <button type="button">No</button>
          </div>
        </div>
      </form>
    `).window.document;

    expect(scanForm(document)).toEqual([
      expect.objectContaining({
        label: 'Send me updates',
        type: 'checkbox',
      }),
    ]);
  });

  it('never scans or marks password inputs', () => {
    const document = new JSDOM(`
      <form>
        <label>Email <input type="email" name="email"></label>
        <label>Password <input type="password" name="password" value="never expose this"></label>
      </form>
    `).window.document;
    const password = document.querySelector('input[type="password"]');

    expect(scanForm(document)).toEqual([
      expect.objectContaining({ label: 'Email', type: 'text' }),
    ]);
    expect(password.hasAttribute(FIELD_ID_ATTRIBUTE)).toBe(false);
  });

  it('reuses opaque field markers on an unchanged DOM', () => {
    const document = loadFixture('lever');

    const firstScan = scanForm(document);
    const firstMarkers = [...document.querySelectorAll(`[${FIELD_ID_ATTRIBUTE}]`)]
      .map((element) => element.getAttribute(FIELD_ID_ATTRIBUTE));
    const secondScan = scanForm(document);
    const secondMarkers = [...document.querySelectorAll(`[${FIELD_ID_ATTRIBUTE}]`)]
      .map((element) => element.getAttribute(FIELD_ID_ATTRIBUTE));

    expect(secondScan).toEqual(firstScan);
    expect(secondMarkers).toEqual(firstMarkers);
    expect(firstScan.every(({ field_id }) => typeof field_id === 'string' && field_id.length > 0)).toBe(true);
  });

  it('returns compact descriptors and option records that serialize without DOM or HTML', () => {
    const document = loadFixture('greenhouse');

    const descriptors = scanForm(document);
    const serialized = JSON.stringify(descriptors);

    expect(descriptors.every((descriptor) => (
      Object.keys(descriptor).filter((key) => !['sensitive', 'inputType', 'maxLength', 'accept'].includes(key)).join(',') === 'field_id,label,type,options,required'
    ))).toBe(true);
    expect(descriptors.flatMap(({ options }) => options).every((option) => (
      Object.keys(option).join(',') === 'value,label'
    ))).toBe(true);
    expect(JSON.parse(serialized)).toEqual(descriptors);
    expect(serialized).not.toContain('<input');
    expect(serialized).not.toContain('<select');
  });
});

describe('scrapePageContext', () => {
  it('prefers valid JobPosting JSON-LD metadata', () => {
    const document = new JSDOM(`
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "JobPosting",
          "title": "Staff Product Engineer",
          "hiringOrganization": { "name": "Example Greenhouse Company" },
          "description": "<p>Lead the <strong>product platform</strong>.</p><p>Ship accessible tools.</p>"
        }
      </script>
      <form><label>Secret answer <input value="never include this"></label></form>
    `, { url: fixtureUrls.greenhouse }).window.document;

    expect(scrapePageContext(document, fixtureUrls.greenhouse)).toEqual({
      company: 'Example Greenhouse Company',
      title: 'Staff Product Engineer',
      url: fixtureUrls.greenhouse,
      description: 'Lead the product platform. Ship accessible tools.',
      fingerprint: expect.any(String),
    });
    expect(scrapePageContext(document, fixtureUrls.greenhouse).description)
      .not.toContain('never include this');
  });

  it('ignores invalid JSON-LD and falls back conservatively to the heading and host', () => {
    const document = new JSDOM(`
      <title>Ignored document title</title>
      <script type="application/ld+json">{not valid json</script>
      <main><h1>  Platform   Engineer  </h1></main>
    `, { url: fixtureUrls.lever }).window.document;

    expect(scrapePageContext(document, fixtureUrls.lever)).toEqual({
      company: 'jobs.lever.co',
      title: 'Platform Engineer',
      url: fixtureUrls.lever,
      description: '',
      fingerprint: expect.any(String),
    });
  });

  it('retains only origin and path in the locally stored page URL and fingerprint', () => {
    const privateUrl = 'https://user:secret@jobs.example.com:8443/apply/role?token=private#step-two';
    const sanitizedUrl = 'https://jobs.example.com:8443/apply/role';
    const document = new JSDOM('<main><h1>Security Engineer</h1></main>', {
      url: privateUrl,
    }).window.document;

    const page = scrapePageContext(document, privateUrl);
    const sanitizedPage = scrapePageContext(document, sanitizedUrl);

    expect(page.url).toBe(sanitizedUrl);
    expect(page.url).not.toContain('user');
    expect(page.url).not.toContain('secret');
    expect(page.url).not.toContain('token');
    expect(page.fingerprint).toBe(sanitizedPage.fingerprint);
  });

  it('extracts plain text only from a known job-description container', () => {
    const document = new JSDOM(`
      <h1>Frontend Engineer</h1>
      <section data-testid="job-description-content">
        <h2>About the role</h2>
        <p>Build thoughtful interfaces.</p>
        <script>privateFormAnswer = 'do not send'</script>
      </section>
      <form><textarea>private application answer</textarea></form>
    `, { url: fixtureUrls.ashby }).window.document;

    const page = scrapePageContext(document, fixtureUrls.ashby);

    expect(page.description).toBe('About the role Build thoughtful interfaces.');
    expect(page.description).not.toContain('private');
    expect(page.fingerprint).toMatch(/^job-/);
  });

  it('bounds extracted job text without falling back to arbitrary page or form contents', () => {
    const longDescription = `Role ${'x'.repeat(70_000)}`;
    const document = new JSDOM(`
      <h1>Engineer</h1>
      <div id="job-description">${longDescription}</div>
      <form><input value="private-answer"></form>
    `, { url: fixtureUrls.lever }).window.document;

    const page = scrapePageContext(document, fixtureUrls.lever);

    expect(page.description.length).toBeLessThanOrEqual(65_536);
    expect(page.description.startsWith('Role ')).toBe(true);
    expect(page.description).not.toContain('private-answer');
  });
});
