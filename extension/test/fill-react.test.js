/* @vitest-environment jsdom */

import { act, createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fillForm } from '../src/content/fill.js';
import { scanForm } from '../src/content/scan.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function ControlledForm({ portfolio = false, schedule = '', choice = '' }) {
  const [values, setValues] = useState({ portfolio, schedule, choice });
  const [changes, setChanges] = useState({});
  const [tick, setTick] = useState(0);
  const [submissions, setSubmissions] = useState(0);
  const update = (name, value) => {
    setValues((previous) => ({ ...previous, [name]: value }));
    setChanges((previous) => ({ ...previous, [name]: (previous[name] || 0) + 1 }));
  };
  return h('form', { onSubmit: (event) => { event.preventDefault(); setSubmissions((count) => count + 1); } },
    h('label', null, h('input', {
      id: 'portfolio', type: 'checkbox', checked: values.portfolio,
      onChange: (event) => update('portfolio', event.target.checked),
    }), 'Has a portfolio'),
    h('fieldset', null, h('legend', null, 'Preferred schedule'),
      ...['Remote', 'Hybrid'].map((option) => h('label', { key: option }, h('input', {
        type: 'radio', name: 'schedule', value: option, checked: values.schedule === option,
        onChange: (event) => update('schedule', event.target.value),
      }), option))),
    h('fieldset', null, h('legend', null, 'Available to relocate'),
      ...['Yes', 'No'].map((option) => h('label', { key: option }, h('input', {
        type: 'checkbox', name: 'relocate', value: option, checked: values.choice === option,
        onChange: (event) => { if (event.target.checked) update('choice', option); },
      }), option))),
    h('button', { type: 'button', onClick: () => setTick((count) => count + 1) }, 'Rerender'),
    h('button', { type: 'submit' }, 'Submit'),
    h('output', null, JSON.stringify({ values, changes, tick, submissions })));
}

let container;
let reactRoot;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  reactRoot = createRoot(container);
});

afterEach(async () => {
  await act(async () => reactRoot.unmount());
  container.remove();
});

async function render(props) {
  await act(async () => reactRoot.render(h(ControlledForm, props)));
}

function state() {
  return JSON.parse(container.querySelector('output').textContent);
}

async function fill(label, value) {
  const descriptors = scanForm(container);
  const field = descriptors.find((descriptor) => descriptor.label === label);
  expect(field).toBeDefined();
  let result;
  await act(async () => {
    result = fillForm([{ field_id: field.field_id, value }], { root: container, expectedDescriptors: descriptors });
  });
  expect(result).toEqual({ filled: [field.field_id], unfilled: [] });
}

async function rerender() {
  await act(async () => container.querySelector('button[type="button"]').click());
  expect(state().tick).toBe(1);
  expect(state().submissions).toBe(0);
}

describe('fillForm with real React controlled checked inputs', () => {
  it.each([
    [false, 'true', true, 1],
    [true, 'false', false, 1],
    [false, 'false', false, 0],
    [true, 'true', true, 0],
  ])('persists checkbox %s → %s in React state without double toggling', async (initial, answer, expected, count) => {
    await render({ portfolio: initial });
    const input = container.querySelector('#portfolio');
    const events = [];
    for (const type of ['click', 'input', 'change']) {
      input.addEventListener(type, () => events.push(type));
    }

    await fill('Has a portfolio', answer);
    expect(state().values.portfolio).toBe(expected);
    expect(state().changes.portfolio || 0).toBe(count);
    expect(events).toEqual(count ? ['click', 'input', 'change'] : []);
    await rerender();
    expect(input.checked).toBe(expected);
  });

  it.each([
    ['', 'Hybrid', 1],
    ['Remote', 'Hybrid', 1],
    ['Hybrid', 'Hybrid', 0],
  ])('persists radio %s → %s with exclusive React state', async (initial, answer, count) => {
    await render({ schedule: initial });

    await fill('Preferred schedule', answer);
    expect(state().values.schedule).toBe('Hybrid');
    expect(state().changes.schedule || 0).toBe(count);
    await rerender();
    expect([...container.querySelectorAll('input[type="radio"]')].map((input) => input.checked))
      .toEqual([false, true]);
  });

  it('reports a checkbox value rejected by the React form as unfilled', async () => {
    await act(async () => reactRoot.render(h('form', null,
      h('label', null, h('input', {
        type: 'checkbox', checked: false, onChange: () => {},
      }), 'Has a portfolio'))));
    const [field] = scanForm(container);
    let result;

    await act(async () => {
      result = fillForm([{ field_id: field.field_id, value: 'true' }], { root: container });
    });

    expect(result.filled).toEqual([]);
    expect(result.unfilled).toEqual([{ field_id: field.field_id, reason: expect.stringMatching(/manually/i) }]);
    expect(container.querySelector('input').checked).toBe(false);
  });

  it('changes an exclusive React checkbox choice that does not allow an empty selection', async () => {
    await render({ choice: 'Yes' });

    await fill('Available to relocate', 'No');
    expect(state().values.choice).toBe('No');
    expect(state().changes.choice).toBe(1);
    await rerender();
    expect([...container.querySelectorAll('input[name="relocate"]')].map((input) => input.checked))
      .toEqual([false, true]);
  });
});
