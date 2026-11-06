import { beforeEach, expect, it } from 'vitest';
import { readRenderedContactRows } from '../src/contactMeasurement.js';

beforeEach(() => { document.body.innerHTML = '<div id="resume"><header class="resume-header"></header></div>'; });

function item(field, top, bottom, width = 100) {
  const el = document.createElement('span');
  el.dataset.editable = `contact.${field}`;
  el.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, width, left: 0, right: width });
  document.querySelector('.resume-header').append(el);
}

it('reads the actual visible rows, including template wrapping and different text sizes', () => {
  item('email', 10, 25); item('phone', 12, 25); item('location', 29, 42); item('portfolio', 28, 42);
  expect(readRenderedContactRows()).toEqual([['email', 'phone'], ['location', 'portfolio']]);
});

it('reads vertical templates without assuming a fixed number of lines', () => {
  item('email', 10, 20); item('phone', 21, 31); item('location', 32, 42);
  expect(readRenderedContactRows()).toEqual([['email'], ['phone'], ['location']]);
});

it('ignores hidden contacts, duplicate markers and unknown paths', () => {
  item('email', 10, 20); item('email', 10, 20); item('phone', 0, 0, 0); item('__proto__', 10, 20);
  expect(readRenderedContactRows()).toEqual([['email']]);
});

it('returns null until the header has a measurable layout', () => {
  expect(readRenderedContactRows()).toBeNull();
  item('email', 0, 0, 0);
  expect(readRenderedContactRows()).toBeNull();
  document.body.innerHTML = '';
  expect(readRenderedContactRows()).toBeNull();
});
