import { describe, expect, it } from 'vitest';
import { renderResumeForLayout } from '../src/renderer.js';
import { assertResumeData } from '../src/resumeValidation.js';

const LAYOUTS = [
  'sidebar', 'stacked', 'stacked-vertical', 'right-sidebar', 'compact',
  'executive', 'classic', 'classic-featured', 'modern', 'timeline', 'creative',
];

function rendersSectionId(layout, area) {
  return ['stacked', 'stacked-vertical'].includes(layout)
    || (area === 'sidebar' && !['classic', 'classic-featured', 'creative'].includes(layout));
}

function render(id, layout, area, type) {
  const data = {
    name: 'Safe test', contact: {},
    sections: [{ id, title: 'Section', area, type, content: ['Original item'] }],
  };
  assertResumeData(data, { requireIdentity: true });
  const before = JSON.stringify(data);
  const host = document.createElement('div');
  host.innerHTML = renderResumeForLayout(data, layout);
  expect(JSON.stringify(data)).toBe(before);
  return host;
}

describe.each(LAYOUTS)('section ID escaping in %s', (layout) => {
  it.each([
    ['nodes', 'section"><span data-injected-marker="section-id">marker</span><div data-remainder="'],
    ['attributes', 'section" data-injected-attribute="confirmed'],
  ])('keeps imported IDs from creating DOM %s', (_kind, id) => {
    for (const area of ['main', 'sidebar']) {
      for (const type of ['list', 'skills']) {
        const host = render(id, layout, area, type);
        expect(host.querySelector('[data-injected-marker], [data-injected-attribute], [data-remainder]')).toBeNull();
        const sections = host.querySelectorAll('[data-section-id]');
        expect(sections.length).toBe(rendersSectionId(layout, area) ? 1 : 0);
        for (const section of sections) expect(section.dataset.sectionId).toBe(id);
      }
    }
  });

  it('round-trips punctuation and preserves the existing index fallback', () => {
    for (const area of ['main', 'sidebar']) {
      for (const type of ['list', 'skills']) {
        for (const id of ['A & B "quoted" <literal> \'apostrophe\'', '', undefined]) {
          const host = render(id, layout, area, type);
          const sections = host.querySelectorAll('[data-section-id]');
          expect(sections.length).toBe(rendersSectionId(layout, area) ? 1 : 0);
          for (const section of sections) expect(section.dataset.sectionId).toBe(id || '0');
        }
      }
    }
  });
});
