import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Header from '../src/components/Header.jsx';
import { store } from '../src/store.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="header-bar"></div>';
  store.setData({ name: 'Alex', contact: {}, sections: [] }, true);
});
afterEach(() => { cleanup(); store.saveNow(); vi.restoreAllMocks(); });

it('keeps generation notes accessible for the currently open resume', () => {
  render(<Header />);
  expect(screen.queryByTitle('Generation notes')).toBeNull();
  act(() => { store.update('generationReview', { notes: 'Explain the career transition.', gaps: ['Leadership examples'] }); });
  const openNotes = vi.fn();
  window.addEventListener('rd:open-generation-review', openNotes);
  try {
    fireEvent.click(screen.getByTitle('Generation notes'));
    expect(openNotes).toHaveBeenCalledTimes(1);
    act(() => { store.setData({ name: 'Another resume' }, true); });
    expect(screen.queryByTitle('Generation notes')).toBeNull();
  } finally {
    window.removeEventListener('rd:open-generation-review', openNotes);
  }
});
