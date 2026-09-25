import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import LibraryDialog from '../src/components/library/LibraryDialog.jsx';
import { createVariant, getCurrentId, initVariants, loadVariant } from '../src/variantManager.js';
import { getVariants, saveVariant } from '../src/persistence.js';
import { store } from '../src/store.js';

const resume = (summary) => ({
  name: 'Alex', contact: { email: 'alex@example.com' }, summary,
  education: ['University'], experience: [], sections: [],
});

beforeEach(() => {
  localStorage.clear();
  initVariants(() => {});
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });

  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
    const styles = originalGetComputedStyle(element, pseudoElement);
    if (!element.matches('[role="dialog"], .glass-overlay')) return styles;
    // Keep Radix's real Presence behavior, but simulate a browser that starts
    // the exit animation without ever delivering animationend or animationcancel.
    return new Proxy(styles, {
      get(target, property) {
        if (property === 'animationName') {
          return element.dataset.state === 'closed' ? 'exit' : 'enter';
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
});

afterEach(() => {
  cleanup();
  store.saveNow();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Library dismissal after external resume changes', () => {
  it.each(['Close', 'Escape'])('dismisses with %s without waiting for an exit animation or losing saved resumes', (action) => {
    const baseId = createVariant('Base resume', resume('Original summary'));
    render(<LibraryDialog />);
    act(() => window.dispatchEvent(new CustomEvent('rd:open-library')));
    expect(screen.getByRole('heading', { name: 'Base resume' })).toBeTruthy();

    // Companion tailoring saves and activates its new variant while the
    // Library can already be open. Exercise the real persistence and store path.
    act(() => {
      saveVariant('tailored', 'Tailored resume', resume('Tailored summary'));
      expect(loadVariant('tailored')).toBe(true);
    });
    expect(screen.getByRole('button', { name: /^Base resume/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Tailored resume/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tailored resume' })).toBeTruthy();
    const saved = getVariants();

    if (action === 'Close') fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    else fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(document.querySelector('.glass-overlay')).toBeNull();
    expect(screen.queryByText('No resumes yet.')).toBeNull();
    expect(getVariants()).toEqual(saved);
    expect(Object.keys(saved)).toEqual(expect.arrayContaining([baseId, 'tailored']));
    expect(getCurrentId()).toBe('tailored');
    expect(store.getData().summary).toBe('Tailored summary');

    // A close must also leave the next opening and dismissal usable.
    act(() => window.dispatchEvent(new CustomEvent('rd:open-library')));
    expect(screen.getByRole('button', { name: /^Base resume/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tailored resume' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });
});
