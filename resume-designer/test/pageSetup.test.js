import { describe, it, expect } from 'vitest';
import {
  PAGE_SIZES, ORIENTATIONS, DEFAULT_PAGE_WIDTH_IN, PAGE_DIMS_IN,
  normalizePageSize, pageDimsIn,
} from '../src/pageSetup.js';

describe('normalizePageSize', () => {
  it('maps legacy "auto", undefined, and unknown values to "continuous"', () => {
    expect(normalizePageSize('auto')).toBe('continuous');
    expect(normalizePageSize(undefined)).toBe('continuous');
    expect(normalizePageSize('nonsense')).toBe('continuous');
  });
  it('passes through every known size unchanged', () => {
    for (const s of PAGE_SIZES) expect(normalizePageSize(s)).toBe(s);
  });
});

describe('pageDimsIn', () => {
  it('returns null height for continuous and uses the given width', () => {
    expect(pageDimsIn({ pageSize: 'continuous', pageWidthIn: 7 })).toEqual({ widthIn: 7, heightIn: null });
  });
  it('defaults the continuous width to 8.5in', () => {
    expect(pageDimsIn({ pageSize: 'continuous' })).toEqual({ widthIn: DEFAULT_PAGE_WIDTH_IN, heightIn: null });
  });
  it('returns portrait dims for fixed sizes', () => {
    expect(pageDimsIn({ pageSize: 'letter' })).toEqual({ widthIn: 8.5, heightIn: 11 });
    expect(pageDimsIn({ pageSize: 'tabloid' })).toEqual({ widthIn: 11, heightIn: 17 });
  });
  it('swaps width/height for landscape', () => {
    expect(pageDimsIn({ pageSize: 'letter', orientation: 'landscape' })).toEqual({ widthIn: 11, heightIn: 8.5 });
  });
  it('ignores orientation for continuous', () => {
    expect(pageDimsIn({ pageSize: 'continuous', orientation: 'landscape', pageWidthIn: 9 }))
      .toEqual({ widthIn: 9, heightIn: null });
  });
  it('treats legacy "auto" as continuous', () => {
    expect(pageDimsIn({ pageSize: 'auto' })).toEqual({ widthIn: DEFAULT_PAGE_WIDTH_IN, heightIn: null });
  });
  it('exposes a dims table that matches standard paper sizes', () => {
    expect(PAGE_DIMS_IN.a4).toEqual({ widthIn: 8.27, heightIn: 11.69 });
    expect(PAGE_DIMS_IN.legal).toEqual({ widthIn: 8.5, heightIn: 14 });
  });
});
