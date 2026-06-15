import { describe, it, expect } from 'vitest';
import { assignBlocksToPages } from '../src/pagination.js';

describe('assignBlocksToPages', () => {
  const budgets = { firstPageContentPx: 250, pageContentPx: 300 };

  it('returns an empty array for no blocks', () => {
    expect(assignBlocksToPages([], budgets)).toEqual([]);
  });
  it('keeps blocks on page 0 until the first-page budget is exceeded', () => {
    expect(assignBlocksToPages([100, 100, 100], budgets)).toEqual([0, 0, 1]);
  });
  it('uses the larger per-page budget on pages after the first', () => {
    // page0: 100+100=200 (<=250); next 100 -> 300 > 250 -> page1. page1: 100,100,100=300 (<=300) ok.
    expect(assignBlocksToPages([100, 100, 100, 100, 100], budgets)).toEqual([0, 0, 1, 1, 1]);
  });
  it('gives an oversize block its own page (overflow allowed, never an empty page)', () => {
    expect(assignBlocksToPages([500, 100], { firstPageContentPx: 300, pageContentPx: 300 })).toEqual([0, 1]);
  });
  it('places a single block on page 0', () => {
    expect(assignBlocksToPages([100], budgets)).toEqual([0]);
  });
  it('never starts a new page for a block that fits exactly', () => {
    expect(assignBlocksToPages([250], budgets)).toEqual([0]);
    expect(assignBlocksToPages([250, 300], budgets)).toEqual([0, 1]);
  });
});
