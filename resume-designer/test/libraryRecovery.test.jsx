import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import LibraryDialog from '../src/components/library/LibraryDialog.jsx';
import { createVariant, getCurrentId, initVariants, refreshVariants } from '../src/variantManager.js';
import { getCurrentVariantId, getVariants, saveVariant } from '../src/persistence.js';
import { searchLibrary } from '../src/librarySearch.js';
import { assertResumeData } from '../src/resumeValidation.js';
import { store } from '../src/store.js';

const valid = () => ({
  name: 'Alex', contact: { email: 'alex@example.com' }, summary: 'body-marker',
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
});

afterEach(() => {
  cleanup();
  store.saveNow();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Library previews of retained damaged resumes', () => {
  it.each([
    ['education', { education: 'University' }],
    ['section', { sections: [null] }],
    ['experience', { experience: [null] }],
  ])('keeps recovery controls and saved data when %s cannot render', (_field, patch) => {
    const current = createVariant('Healthy resume', valid());
    saveVariant('damaged', 'Damaged resume', { ...valid(), ...patch, customMetadata: { keep: true } });
    localStorage.setItem('resume-designer-history-damaged', '{"history":[],"historyIndex":-1}');
    const before = localStorage.getItem('resume-designer-data');
    const history = localStorage.getItem('resume-designer-history-damaged');
    refreshVariants();
    render(<LibraryDialog />);
    act(() => window.dispatchEvent(new CustomEvent('rd:open-library')));
    expect(document.querySelector('.resume')?.textContent).toContain('Alex');

    fireEvent.click(screen.getByRole('button', { name: /^Damaged resume/ }));

    expect(screen.getByText('Preview unavailable')).toBeTruthy();
    expect(screen.getByText(/Export Backup/)).toBeTruthy();
    expect(screen.getByText(/import a corrected file/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Damaged resume' })).toBeTruthy();
    for (const name of ['Open', 'Duplicate', 'Rename', 'Delete']) {
      expect(screen.getByRole('button', { name, exact: true }).disabled).toBe(false);
    }
    expect(document.querySelector('.resume')).toBeNull();
    expect(getCurrentId()).toBe(current);
    expect(getCurrentVariantId()).toBe(current);
    expect(store.getData()).toEqual(valid());
    expect(localStorage.getItem('resume-designer-data')).toBe(before);
    expect(localStorage.getItem('resume-designer-history-damaged')).toBe(history);
    expect(getVariants().damaged.data.customMetadata).toEqual({ keep: true });

    // The same component must recover without a changed hook order or a stale
    // measurement when the person selects a healthy row again.
    fireEvent.click(screen.getByRole('button', { name: /^Healthy resume/ }));
    expect(screen.queryByText('Preview unavailable')).toBeNull();
    expect(document.querySelector('.resume')?.textContent).toContain('Alex');
  });
});

describe('deep search with retained damaged resumes', () => {
  it.each([
    ['education', { education: 'University' }],
    ['section', { sections: [null] }],
    ['section content', { sections: [{ content: 'body-marker' }] }],
    ['experience', { experience: {} }],
    ['experience entry', { experience: [null] }],
    ['bullets', { experience: [{ bullets: {} }] }],
  ])('skips invalid %s while preserving name and linked metadata matches', (_field, patch) => {
    const damaged = { ...valid(), ...patch, customMetadata: { keep: true } };
    expect(() => assertResumeData(damaged)).toThrow();
    const context = {
      variants: [
        { id: 'damaged', name: 'Damaged resume', data: damaged },
        { id: 'healthy', name: 'Healthy resume', data: valid() },
      ],
      applications: [{ variantId: 'damaged', jobId: 'job', jobSnapshot: { company: 'Metadata company' } }],
      jobDescriptions: [{ id: 'job', title: 'Role', description: 'job-marker' }],
      threads: [{ homeVariantId: 'damaged', messages: [{ content: 'chat-marker' }] }],
      deep: true,
    };
    const before = JSON.stringify(context);

    expect(searchLibrary('body-marker', context).map((result) => result.variantId)).toEqual(['healthy']);
    for (const query of ['damaged', 'metadata company']) {
      expect(searchLibrary(query, context)).toEqual([
        { variantId: 'damaged', quickHit: true, deepHits: [] },
      ]);
    }
    for (const source of ['job', 'chat']) {
      const result = searchLibrary(`${source}-marker`, context);
      expect(result.map((row) => row.variantId)).toEqual(['damaged']);
      expect(result[0].deepHits[0].source).toBe(source);
    }
    expect(JSON.stringify(context)).toBe(before);
  });
});
