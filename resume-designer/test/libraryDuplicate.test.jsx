import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import LibraryDialog from '../src/components/library/LibraryDialog.jsx';
import { createVariant, getCurrentId, initVariants, refreshVariants } from '../src/variantManager.js';
import { getCurrentVariantId, getVariants, saveVariant } from '../src/persistence.js';
import { store } from '../src/store.js';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const valid = () => ({
  name: 'Alex', contact: { email: 'alex@example.com' },
  education: ['University'], experience: [], sections: [],
});

let uncaught;
let onError;

beforeEach(() => {
  localStorage.clear();
  initVariants(() => {});
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  // React reports event-handler exceptions through window rather than throwing
  // out of fireEvent. Record them so the regression cannot silently pass.
  uncaught = [];
  onError = (event) => { uncaught.push(event.error); event.preventDefault(); };
  window.addEventListener('error', onError);
});

afterEach(() => {
  cleanup();
  store.saveNow();
  window.removeEventListener('error', onError);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openLibrary() {
  refreshVariants();
  render(<LibraryDialog />);
  act(() => window.dispatchEvent(new CustomEvent('rd:open-library')));
}

describe('duplicating a résumé from the Library', () => {
  it.each([
    ['summary', { summary: { text: 'Damaged legacy value' } }],
    ['education', { education: [{ school: 'University' }] }],
  ])('explains a malformed %s without changing saved data or the open résumé', (_field, patch) => {
    const current = createVariant('Healthy résumé', valid());
    // The Library intentionally retains malformed old documents for recovery.
    // These shapes still render in its preview, but fail creation validation.
    saveVariant('damaged', 'Damaged résumé', { ...valid(), ...patch });
    const history = '{"history":[],"historyIndex":-1}';
    localStorage.setItem('resume-designer-history-damaged', history);
    const before = localStorage.getItem('resume-designer-data');
    openLibrary();
    fireEvent.click(screen.getByRole('button', { name: /^Damaged résumé/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate', exact: true }));

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toMatch(/could not duplicate/i);
    expect(toast.error.mock.calls[0][0]).toMatch(/Export Backup/);
    expect(toast.error.mock.calls[0][0]).toMatch(/import a corrected file/i);
    expect(uncaught).toEqual([]);
    expect(localStorage.getItem('resume-designer-data')).toBe(before);
    expect(localStorage.getItem('resume-designer-history-damaged')).toBe(history);
    expect(getCurrentId()).toBe(current);
    expect(getCurrentVariantId()).toBe(current);
    expect(store.getData()).toEqual(valid());
    expect(screen.getByRole('heading', { name: 'Damaged résumé' })).toBeTruthy();
  });

  it.each([
    ['current', valid()],
    ['legacy scalar prose', {
      ...valid(), customMetadata: { keep: true },
      sections: [{ title: 'About', area: 'sidebar', type: 'text', content: 'First line.\nSecond line.', custom: 'retained' }],
    }],
  ])('still previews, copies and selects a %s résumé with a unique name', (_shape, data) => {
    const original = createVariant('Healthy résumé', data);
    saveVariant('existing-copy', 'Healthy résumé (Copy)', data);
    openLibrary();
    if (data.sections.length) {
      expect(document.querySelector('.resume')?.textContent).toContain(data.sections[0].content);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate', exact: true }));

    const copy = getVariants()[getCurrentId()];
    expect(copy.id).not.toBe(original);
    expect(copy.name).toBe('Healthy résumé (Copy) (2)');
    expect(copy.data).toEqual(data);
    expect(getVariants()[original].data).toEqual(data);
    expect(getCurrentVariantId()).toBe(copy.id);
    expect(store.getData()).toEqual(data);
    expect(toast.error).not.toHaveBeenCalled();
    expect(uncaught).toEqual([]);
  });
});
