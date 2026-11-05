/* @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GeneratedResume from '../src/sidepanel/GeneratedResume.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMKsAAAAASUVORK5CYII=';
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

async function render(overrides = {}) {
  const props = {
    resume: { id: 'saved-resume', name: 'Engineering at Acme' },
    onOpenInApp: vi.fn(),
    onPrepareAutofill: vi.fn(),
    ...overrides,
  };
  await act(async () => root.render(<GeneratedResume {...props} />));
  return props;
}

function button(label) {
  return [...container.querySelectorAll('button')].find((item) => item.textContent === label);
}

describe('generated resume success', () => {
  it('shows the saved resume’s actual first page and separate explicit next steps', async () => {
    const props = await render({ preview: { imageBase64: png, mimeType: 'image/png', pageCount: 2 } });
    expect(container.textContent).toContain('Your resume is ready');
    expect(container.textContent).toContain('Saved in On Paper');
    expect(container.textContent).toContain('First page preview · 2 pages');
    const image = container.querySelector('img');
    expect(image.getAttribute('src')).toBe(`data:image/png;base64,${png}`);
    expect(image.getAttribute('alt')).toBe('First page of Engineering at Acme');
    expect(props.onOpenInApp).not.toHaveBeenCalled();
    expect(props.onPrepareAutofill).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Open the application page first');

    await act(async () => button('View in On Paper').click());
    expect(props.onOpenInApp).toHaveBeenCalledOnce();
    expect(props.onPrepareAutofill).not.toHaveBeenCalled();
    await act(async () => button('Prepare application autofill').click());
    expect(props.onPrepareAutofill).toHaveBeenCalledOnce();
  });

  it('keeps saved success and actions available while the preview is loading', async () => {
    await render({ previewLoading: true });
    expect(container.textContent).toContain('Your resume is ready');
    expect(container.textContent).toContain('Preparing your preview…');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(button('View in On Paper').disabled).toBe(false);
    expect(button('Prepare application autofill').disabled).toBe(false);
    expect(container.querySelector('img')).toBeNull();
  });

  it('offers a preview retry without erasing the saved resume', async () => {
    const retry = vi.fn();
    await render({ previewError: { message: 'Network unavailable' }, onRetryPreview: retry });
    expect(container.textContent).toContain('Your resume is saved. The preview couldn’t be loaded.');
    expect(container.textContent).toContain('Engineering at Acme');
    await act(async () => button('Try preview again').click());
    expect(retry).toHaveBeenCalledOnce();
    expect(button('View in On Paper').disabled).toBe(false);
  });

  it('provides an update and manual app fallback when an older app lacks support', async () => {
    await render({
      previewError: { code: 'app_update_required' },
      openError: { code: 'app_update_required' },
      onRetryPreview: vi.fn(),
    });
    expect(container.textContent).toContain('Update On Paper to see resume previews here');
    expect(container.textContent).toContain('choose “Engineering at Acme” in Resumes');
    expect(button('Try preview again')).toBeUndefined();
    expect(button('Prepare application autofill').disabled).toBe(false);
  });

  it.each([
    { imageBase64: png, mimeType: 'image/svg+xml' },
    { imageBase64: 'https://example.test/resume.png', mimeType: 'image/png' },
    { imageBase64: 'data:image/png;base64,' + png, mimeType: 'image/png' },
    { imageBase64: 'not an image', mimeType: 'image/png' },
  ])('never renders remote, active, or malformed preview sources: %j', async (preview) => {
    await render({ preview, onRetryPreview: vi.fn() });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('The preview couldn’t be loaded');
    expect(container.textContent).toContain('Your resume is ready');
  });

  it('retains success and fallback controls if a valid PNG cannot be decoded', async () => {
    const props = await render({ preview: { imageBase64: png, mimeType: 'image/png' }, onRetryPreview: vi.fn() });
    await act(async () => container.querySelector('img').dispatchEvent(new Event('error')));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('The preview couldn’t be loaded');
    expect(container.textContent).toContain('Your resume is ready');
    await act(async () => button('Try preview again').click());
    expect(props.onRetryPreview).toHaveBeenCalledOnce();
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('prevents repeated opening and respects a disabled state', async () => {
    const props = await render({ opening: true });
    expect(button('Opening On Paper…').disabled).toBe(true);
    await act(async () => button('Opening On Paper…').click());
    expect(props.onOpenInApp).not.toHaveBeenCalled();
    await render({ disabled: true });
    expect(button('View in On Paper').disabled).toBe(true);
    expect(button('Prepare application autofill').disabled).toBe(true);
  });

  it('shows a useful opening failure without losing preview or next steps', async () => {
    await render({ preview: { imageBase64: png, pageCount: 1 }, openError: { message: 'Could not activate window' } });
    expect(container.querySelector('[role="alert"]').textContent).toContain('The resume couldn’t be opened.');
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.textContent).toContain('First page preview · 1 page');
    expect(button('View in On Paper').disabled).toBe(false);
  });
});
