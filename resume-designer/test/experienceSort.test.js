import { describe, it, expect } from 'vitest';
import { experienceSortValue } from '../src/store.js';

describe('experienceSortValue', () => {
  it('sorts ongoing roles newest', () => {
    expect(experienceSortValue({ dates: '2019 - Present' })).toBe(9999 * 12);
    expect(experienceSortValue({ dates: 'Jan 2020 - current' })).toBe(9999 * 12);
  });

  it('uses the last 4-digit year when no month is present', () => {
    expect(experienceSortValue({ dates: '2018 - 2021' })).toBe(2021 * 12);
  });

  it('uses YYYY-MM month precision from the visible dates', () => {
    expect(experienceSortValue({ dates: '2021-03' })).toBe(2021 * 12 + 3);
  });

  it('borrows the month from endDate only when the year matches', () => {
    expect(experienceSortValue({ dates: '2021', endDate: '2021-06' })).toBe(2021 * 12 + 6);
    expect(experienceSortValue({ dates: '2021', endDate: '2019-06' })).toBe(2021 * 12);
  });

  it('returns 0 for missing/unparseable dates', () => {
    expect(experienceSortValue({})).toBe(0);
    expect(experienceSortValue(null)).toBe(0);
    expect(experienceSortValue({ dates: 'sometime' })).toBe(0);
  });
});
