import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { FIELD_ID_ATTRIBUTE, scanForm, scrapePageContext } from '../src/content/scan.js';

describe('education fields revealed by a degree selection', () => {
  it('discovers school and major after they become visible, preserving existing field identity', () => {
    // Avature's public Intuit application uses these structures: degree is
    // visible immediately; school and major are conditional on its selection.
    const document = new JSDOM(`<form>
      <label for="degree">Degree</label><select id="degree"><option>Bachelor's Degree</option></select>
      <div id="school-field" hidden><label id="school-label" for="school">University/School<span aria-hidden="true">Select an option</span></label>
        <div class="AutocompleteSelectFieldUIWidget"><select id="school" aria-hidden="true"><option></option></select>
          <span class="select2-container"><span role="combobox" aria-labelledby="school-label"><input class="select2-search__field" aria-label="Search"></span></span>
        </div>
      </div>
      <div id="major-field" hidden><label for="major">Major</label><input id="major" type="hidden" data-hiddentype="text"></div>
    </form>`).window.document;
    const initial = scanForm(document);
    expect(initial.map(field => field.label)).toEqual(['Degree']);
    document.getElementById('school-field').hidden = false;
    document.getElementById('major-field').hidden = false;
    document.getElementById('major').type = 'text';
    const revealed = scanForm(document);
    expect(revealed.map(({ label, type }) => [label, type])).toEqual([
      ['Degree', 'select'], ['University/School', 'custom'], ['Major', 'text'],
    ]);
    expect(revealed[0].field_id).toBe(initial[0].field_id);
    expect(document.querySelector('.select2-search__field').hasAttribute(FIELD_ID_ATTRIBUTE)).toBe(false);
    expect(document.getElementById('school').hasAttribute(FIELD_ID_ATTRIBUTE)).toBe(false);
  });

  it('detects a visible legacy Select2 widget as one manual field without treating search as an answer', () => {
    const document = new JSDOM(`<form><div><label>University/School</label><div class="select2-container"><input class="select2-input" placeholder="Search"></div></div><div class="select2-drop"><input class="select2-input"></div></form>`).window.document;
    expect(scanForm(document).map(({ label, type }) => [label, type])).toEqual([['University/School', 'custom']]);
  });
});

describe('readable captured job context', () => {
  it('captures multiple locations and remote work while preserving readable description blocks', () => {
    const document = new JSDOM(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting', title: 'Engineer', hiringOrganization: { name: 'Example' }, jobLocationType: 'TELECOMMUTE',
      jobLocation: [
        { address: { addressLocality: 'Irvine', addressRegion: 'CA', addressCountry: 'US' } },
        { address: { addressLocality: 'San Diego', addressRegion: 'CA', addressCountry: { name: 'US' } } },
      ],
      description: '<h2>About the role</h2><p>Build useful tools.</p><ul><li>Work with design.</li><li>Improve accessibility.</li></ul><form>Private answer</form>',
    })}</script>`).window.document;
    const context = scrapePageContext(document, 'https://example.com/job');
    expect(context.locations).toEqual(['Remote', 'Irvine, CA, US', 'San Diego, CA, US']);
    expect(context.description).toBe('About the role\n\nBuild useful tools.\n\n• Work with design.\n• Improve accessibility.');
    expect(context.description).not.toContain('Private');
  });

  it('uses a known location container and excludes hidden or form content', () => {
    const document = new JSDOM('<h1>Engineer</h1><div class="job-location">Irvine, CA</div><div class="job-location" hidden>Old location</div><form><div class="job-location">Private answer</div></form>').window.document;
    expect(scrapePageContext(document, 'https://example.com/job').locations).toEqual(['Irvine, CA']);
  });
});
