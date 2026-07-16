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
      ['Work authorization: Yes', 'checkbox'],
      ['Work authorization: No', 'checkbox'],
    ]);
    expect(descriptors.find(({ label }) => label === 'Favorite office')?.options).toEqual([
      { value: '', label: 'Select an office' },
      { value: 'nyc', label: 'New York' },
      { value: 'remote', label: 'Remote' },
    ]);
    expect(descriptors.find(({ label }) => label === 'Country')?.required).toBe(true);
    expect(descriptors.find(({ label }) => label === 'Resume/CV')?.required).toBe(true);
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

  it('skips Ashby helper controls while retaining its labelled resume and descriptor-only custom field', () => {
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
      type: 'checkbox',
    }));
    expect(helperFile.hasAttribute(FIELD_ID_ATTRIBUTE)).toBe(false);
    expect(descriptors.some(({ label }) => label === 'Yes' || label === 'No')).toBe(false);
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
      Object.keys(descriptor).join(',') === 'field_id,label,type,options,required'
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
    const document = loadFixture('greenhouse');

    expect(scrapePageContext(document, fixtureUrls.greenhouse)).toEqual({
      company: 'Example Greenhouse Company',
      title: 'Staff Product Engineer',
      url: fixtureUrls.greenhouse,
    });
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
    });
  });
});
