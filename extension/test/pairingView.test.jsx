/* @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PairingView from '../src/sidepanel/PairingView.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props = {}) {
  const callbacks = { onOpen: vi.fn(), onRetry: vi.fn() };
  await act(async () => root.render(<PairingView state="incompatible" {...callbacks} {...props} />));
  return callbacks;
}

describe('desktop compatibility guidance', () => {
  it.each([
    ['2.3.2-next.165', 'https://github.com/ashproto/Resume-Designer/releases/tag/next'],
    ['2.3.1', 'https://github.com/ashproto/Resume-Designer/releases/latest'],
    ['2.3.1+build-with-hyphens', 'https://github.com/ashproto/Resume-Designer/releases/latest'],
  ])('shows detected %s and sends the user to its update channel', async (desktopVersion, updateUrl) => {
    const callbacks = await render({ desktopVersion });
    expect(container.textContent).toContain(desktopVersion);
    const update = container.querySelector('a.primary-button');
    expect(update?.href).toBe(updateUrl);
    expect(update?.target).toBe('_blank');
    expect(container.textContent).toMatch(/compatible update.*not.*released/i);
    expect(container.querySelector('.manual-pairing')).toBeNull();
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Check connection again');
    expect(retry).toBeDefined();
    await act(async () => retry.click());
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
    expect(callbacks.onOpen).not.toHaveBeenCalled();
  });

  it('offers all desktop releases when the installed version is unavailable', async () => {
    await render();
    expect(container.textContent).toContain('Desktop version unavailable');
    expect(container.querySelector('a.primary-button')?.href).toBe('https://github.com/ashproto/Resume-Designer/releases');
    expect(container.textContent).not.toMatch(/requires On Paper \d/i);
  });

  it('disables the connection recheck while it is already checking', async () => {
    const callbacks = await render({ desktopVersion: '2.3.2-next.165', busy: true, operation: 'checking' });
    expect(container.querySelector('a.primary-button')?.href).toBe('https://github.com/ashproto/Resume-Designer/releases/tag/next');
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Checking connection…');
    expect(retry?.disabled).toBe(true);
    await act(async () => retry.click());
    expect(callbacks.onRetry).not.toHaveBeenCalled();
  });
});
