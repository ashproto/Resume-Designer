import { describe, expect, it } from 'vitest';
import { renderResumeForLayout } from '../src/renderer.js';

const LAYOUTS = [
  'sidebar', 'stacked', 'stacked-vertical', 'right-sidebar', 'compact',
  'executive', 'classic', 'classic-featured', 'modern', 'timeline', 'creative',
];
const LEGACY_TYPES = ['text', 'paragraph', 'list', 'skills', 'highlights', 'custom', null, undefined];

function resume(section) {
  return {
    name: 'Ada', contact: {},
    sections: [
      { title: 'Existing list', type: 'list', content: ['Existing item'] },
      section,
    ],
  };
}

function render(data, layout) {
  const host = document.createElement('div');
  host.innerHTML = renderResumeForLayout(data, layout);
  return host;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe.each(LAYOUTS)('legacy string sections in %s', (layout) => {
  it('renders prose without splitting lines or bullets and preserves the scalar edit path', () => {
    const content = 'First line • still prose\n- Second line\n\nFinal line';
    for (const type of LEGACY_TYPES) {
      for (const area of ['sidebar', 'main']) {
        const data = deepFreeze(resume({ title: 'About', type, area, content }));
        const before = JSON.stringify(data);
        const host = render(data, layout);
        const fields = host.querySelectorAll('[data-editable="sections[1].content"]');
        expect(fields.length, `${String(type)} / ${area}`).toBe(1);
        const field = fields[0];
        expect(field.tagName).toBe('P');
        expect(field.classList.contains('section-paragraph')).toBe(true);
        expect(field.dataset.multiline).toBe('true');
        expect(field.style.whiteSpace).toBe('pre-wrap');
        expect(field.textContent).toBe(content);
        expect(field.querySelector('.highlight-bullet, .skill-tag, .skill-tag-inline')).toBeNull();
        expect(host.querySelector('[data-editable^="sections[1].content["]')).toBeNull();
        expect(host.querySelector('[data-editable="sections[0].content[0]"]').textContent).toBe('Existing item');
        expect(JSON.stringify(data)).toBe(before);
      }
    }
  });

  it('escapes literal HTML while preserving existing inline markdown formatting', () => {
    const host = render(resume({
      title: 'About', type: 'text',
      content: '<img src=x onerror="alert(1)"> & <script>alert(2)</script> **bold** ++underlined++',
    }), layout);
    const field = host.querySelector('[data-editable="sections[1].content"]');
    expect(field).not.toBeNull();
    expect(field.querySelector('img, script')).toBeNull();
    expect(field.textContent).toBe('<img src=x onerror="alert(1)"> & <script>alert(2)</script> bold underlined');
    expect(field.querySelector('strong').textContent).toBe('bold');
    expect(field.querySelector('u').textContent).toBe('underlined');
  });

  it('keeps an empty string editable and never mutates the source or unknown metadata', () => {
    const data = deepFreeze(resume({
      title: 'About', type: 'custom', content: '',
      futureMetadata: { revision: 3, labels: ['keep me'] },
    }));
    const before = JSON.stringify(data);
    const host = render(data, layout);
    const field = host.querySelector('[data-editable="sections[1].content"]');
    expect(field).not.toBeNull();
    expect(field.textContent).toBe('');
    expect(field.dataset.multiline).toBe('true');
    expect(JSON.stringify(data)).toBe(before);
    expect(data.sections[1].type).toBe('custom');
  });

  it('retains indexed editing and existing display behavior for arrays', () => {
    for (const type of LEGACY_TYPES) {
      const host = render(resume({ title: 'Array section', type, content: ['One • Two', 'Three'] }), layout);
      expect(host.querySelector('[data-editable="sections[1].content"]')).toBeNull();
      const first = host.querySelector('[data-editable="sections[1].content[0]"]');
      const second = host.querySelector('[data-editable="sections[1].content[1]"]');
      expect(first).not.toBeNull();
      expect(second.textContent).toBe('Three');
      if (type === 'paragraph') {
        expect(first.textContent).toBe('One • Two');
        expect(first.querySelector('.highlight-bullet')).toBeNull();
      } else if (type === 'skills') {
        expect(first.querySelectorAll('.skill-tag, .skill-tag-inline')).toHaveLength(2);
      } else {
        expect(first.querySelectorAll('.highlight-bullet')).toHaveLength(2);
      }
    }
  });
});
