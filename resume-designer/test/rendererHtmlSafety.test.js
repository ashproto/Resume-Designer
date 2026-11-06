import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderResumeForLayout } from '../src/renderer.js';
import { assertResumeData } from '../src/resumeValidation.js';

const LAYOUTS = ['sidebar', 'stacked', 'stacked-vertical', 'right-sidebar', 'compact', 'executive', 'classic', 'classic-featured', 'modern', 'timeline', 'creative'];
const MODES = LAYOUTS.flatMap(layout => [false, true].map(structured => ({ layout, structured })));

function resume(bullet, id, structured) {
  return {
    name: 'Synthetic safety test', tagline: '', contact: {}, summary: '', sections: [], tools: '', education: [],
    experience: [{ id, title: 'Role', company: 'Example', dates: '2020', bullets: [bullet] }],
    ...(structured ? { sectionLayout: { main: [{ key: 'experience' }], sidebar: [] } } : {}),
  };
}

// A detached template is inert: no handlers are invoked or resources loaded.
function render(bullet, id, layout, structured) {
  const data = resume(bullet, id, structured);
  assertResumeData(data, { requireIdentity: true });
  const before = JSON.stringify(data);
  const template = document.createElement('template');
  template.innerHTML = renderResumeForLayout(data, layout);
  expect(JSON.stringify(data)).toBe(before);
  return template.content;
}

describe.each(MODES)('resume HTML safety in $layout (structured=$structured)', ({ layout, structured }) => {
  it('keeps arbitrary markup and attributed tags inert beside valid legacy formatting', () => {
    const host = render('<strong>Supported</strong><span data-injected-marker="bullet">Untrusted</span><u data-injected-attribute="confirmed">Attributed</u>', 'safe-id', layout, structured);
    expect(host.querySelector('[data-injected-marker], [data-injected-attribute]')).toBeNull();
    const bullet = host.querySelector('.experience-bullets li');
    expect(bullet.querySelector('strong').textContent).toBe('Supported');
    expect(bullet.textContent).toContain('Untrusted');
    expect(bullet.textContent).toContain('Attributed');
  });

  it.each([
    'role"><span data-injected-marker="experience-id">Untrusted</span><div data-remainder="',
    'role" data-injected-attribute="confirmed',
  ])('keeps experience IDs in their attribute context: %s', (id) => {
    const host = render('Normal content', id, layout, structured);
    expect(host.querySelector('[data-injected-marker], [data-injected-attribute], [data-remainder]')).toBeNull();
    const items = host.querySelectorAll('[data-experience-id]');
    expect(items).toHaveLength(1);
    expect(items[0].dataset.experienceId).toBe(id);
  });

  it('preserves nested legacy emphasis and existing named and numeric entities', () => {
    const host = render('Legacy <strong>A &amp; B <em>deep &lt;literal&gt; &#x26; &#38; &quot;quoted&quot; &apos;single&apos; &copy;</em></strong> <u>under</u>', 'safe-id', layout, structured);
    const bullet = host.querySelector('.experience-bullets li');
    expect(bullet.querySelector('strong em')).not.toBeNull();
    expect(bullet.querySelector('u').textContent).toBe('under');
    expect(bullet.querySelector('literal')).toBeNull();
    expect(bullet.textContent).toBe('Legacy A & B deep <literal> & & "quoted" \'single\' © under');
  });

  it('preserves Markdown formatting and escaping in ordinary text', () => {
    const host = render('**Bold** _italic_ ++under++ & <not-a-tag>', 'A & B "quoted" <literal>', layout, structured);
    const bullet = host.querySelector('.experience-bullets li');
    expect(bullet.querySelector('strong').textContent).toBe('Bold');
    expect(bullet.querySelector('em').textContent).toBe('italic');
    expect(bullet.querySelector('u').textContent).toBe('under');
    expect(bullet.querySelector('not-a-tag')).toBeNull();
    expect(bullet.textContent).toBe('Bold italic under & <not-a-tag>');
    expect(host.querySelector('[data-experience-id]').dataset.experienceId).toBe('A & B "quoted" <literal>');
  });

  it('preserves mixed-case bare tags when legacy HTML formatting is already present', () => {
    const host = render('<strong>Lead</strong> <EM>italic <U>under</U></EM>', 'safe-id', layout, structured);
    const bullet = host.querySelector('.experience-bullets li');
    const under = bullet.querySelector('em u');
    expect(under).not.toBeNull();
    expect(under.textContent).toBe('under');
    expect(bullet.textContent).toBe('Lead italic under');
  });
});

it('keeps the renderer safe and usable in a pure Node consumer without a DOM', () => {
  const file = pathToFileURL(resolve('src/renderer.js')).href;
  const data = resume('<strong>Safe</strong><span data-injected-marker="pure">Untrusted</span>', 'safe-id', false);
  const script = [
    'import assert from "node:assert/strict";',
    'import { renderResumeForLayout } from ' + JSON.stringify(file) + ';',
    'assert.equal(typeof globalThis.document, "undefined");',
    'const html = renderResumeForLayout(' + JSON.stringify(data) + ', "sidebar");',
    'assert.ok(html.includes("<strong>Safe</strong>"));',
    'assert.ok(!html.includes("<span data-injected-marker"));',
    'console.log("pure-safe");',
  ].join('\n');
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim()).toBe('pure-safe');
});
