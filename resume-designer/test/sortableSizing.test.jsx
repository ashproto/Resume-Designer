import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SortableList, SortableItem, DragHandle } from '../src/components/Sortable.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps an expanded card its full size while dragging over a shorter card', async () => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    constructor(type, init) { super(type, init); this.isPrimary = true; this.pointerId = 1; }
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const short = this.textContent === 'Short';
    const height = this.textContent === 'LargeShort' ? 600 : short ? 40 : 200;
    const top = short ? 220 : 0;
    return { x: 0, y: top, top, left: 0, width: 300, height, right: 300, bottom: top + height };
  });
  render(<SortableList ids={['large', 'small']} onReorder={() => {}}>
    <SortableItem id="large"><DragHandle title="Reorder large" />Large</SortableItem>
    <SortableItem id="small"><DragHandle title="Reorder short" />Short</SortableItem>
  </SortableList>);
  const handle = screen.getByTitle('Reorder large');
  fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, button: 0, isPrimary: true });
  fireEvent.pointerMove(document, { clientX: 0, clientY: 10 });
  await waitFor(() => expect(handle.closest('.dragging')).toBeTruthy());
  await act(() => new Promise(resolve => setTimeout(resolve, 0)));
  fireEvent.pointerMove(document, { clientX: 0, clientY: 220 });
  await waitFor(() => expect(handle.closest('.dragging').style.transform).toContain('translate3d(0px, 220px'));
  expect(handle.closest('.dragging').style.transform).not.toMatch(/scale/);
  fireEvent.pointerUp(document);
});
