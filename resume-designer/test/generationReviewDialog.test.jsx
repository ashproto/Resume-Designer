import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GenerationReviewDialog from '../src/components/GenerationReviewDialog.jsx';
import { store } from '../src/store.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('saved generation notes', () => {
  it('ignores malformed optional metadata from an imported document', () => {
    store.setData({ name: 'Alex', generationReview: {
      notes: 'Saved notes', targetPages: { value: 1 }, verbosity: ['detailed'], score: 200,
      gaps: [{ requirement: 'Research', severity: { value: 'high' }, note: { text: 'Add detail' } }],
    } }, true);
    render(<GenerationReviewDialog />);
    act(() => window.dispatchEvent(new CustomEvent('rd:open-generation-review')));
    expect(screen.getByText('Saved notes')).toBeTruthy();
    expect(screen.getByText('Research')).toBeTruthy();
    expect(screen.queryByText(/page.*target/)).toBeNull();
    expect(screen.queryByText(/Fit assessment/)).toBeNull();
  });
  it('reopens the active resume assessment and carries its corrections into the discussion', () => {
    store.setData({ name: 'Alex', generationReview: {
      notes: 'Leadership needs more evidence.', score: 72,
      gaps: [{ requirement: 'Team leadership', severity: 'high', note: 'Clarify your role.' }],
      corrections: ['I mentored five designers.'], verbosity: 'concise', targetPages: 1,
    } }, true);
    const openContext = vi.fn();
    window.addEventListener('rd:chat-open-context', openContext);
    try {
      render(<GenerationReviewDialog />);
      act(() => window.dispatchEvent(new CustomEvent('rd:open-generation-review')));
      expect(screen.getByText('Leadership needs more evidence.')).toBeTruthy();
      expect(screen.getByText('I mentored five designers.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Continue discussion' }));
      expect(openContext).toHaveBeenCalledTimes(1);
      expect(openContext.mock.calls[0][0].detail.context).toContain('Team leadership');
      expect(openContext.mock.calls[0][0].detail.context).toContain('I mentored five designers.');
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      window.removeEventListener('rd:chat-open-context', openContext);
    }
  });

  it('follows the active resume instead of showing another resume\'s feedback', () => {
    store.setData({ name: 'Alex', generationReview: { notes: 'Alex feedback', gaps: [] } }, true);
    render(<GenerationReviewDialog />);
    act(() => window.dispatchEvent(new CustomEvent('rd:open-generation-review')));
    expect(screen.getByText('Alex feedback')).toBeTruthy();
    act(() => store.setData({ name: 'Sam', generationReview: { notes: 'Sam feedback', gaps: [] } }, true));
    expect(screen.getByText('Sam feedback')).toBeTruthy();
    expect(screen.queryByText('Alex feedback')).toBeNull();
  });
});
