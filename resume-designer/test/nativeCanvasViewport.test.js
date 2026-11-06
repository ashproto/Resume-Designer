import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeCanvasViewportUpdater } from '../src/iosShell.js';

const detach = [];
afterEach(() => { detach.splice(0).forEach(fn => fn()); });

function observeResize() {
  const resized = vi.fn();
  window.addEventListener('resize', resized);
  detach.push(() => window.removeEventListener('resize', resized));
  return resized;
}

describe('native-owned canvas viewport', () => {
  it('notifies resize when native usable bounds change without a window resize', () => {
    const resized = observeResize();
    const update = createNativeCanvasViewportUpdater(window);
    expect(update({ width: 420, height: 720 })).toBe(true);
    expect(update({ width: 420, height: 720 })).toBe(false);
    // A left or right system rail changes the usable frame; WebKit already
    // occupies that frame, so the event asks the normal fit guard to remeasure.
    expect(update({ width: 328, height: 720 })).toBe(true);
    expect(resized).toHaveBeenCalledTimes(2);
  });

  it('never applies native-consumed safe areas a second time in web content', () => {
    const update = createNativeCanvasViewportUpdater(window);
    const scroller = document.createElement('div');
    scroller.id = 'resume-scroller';
    scroller.style.padding = '16px';
    document.body.append(scroller);
    const before = scroller.getAttribute('style');
    update({ width: 328, height: 720, insets: { top: 0, left: 92, bottom: 0, right: 0 } });
    expect(scroller.getAttribute('style')).toBe(before);
    scroller.remove();
  });

  it('ignores incomplete or nonfinite geometry without invalidating the last real size', () => {
    const resized = observeResize();
    const update = createNativeCanvasViewportUpdater(window);
    for (const value of [null, {}, { width: 0, height: 4 }, { width: -1, height: 4 },
      { width: NaN, height: 4 }, { width: Infinity, height: 4 }, { width: '328', height: 720 }]) {
      expect(update(value)).toBe(false);
    }
    expect(update({ width: 328, height: 720 })).toBe(true);
    expect(update({ width: 328, height: 0 })).toBe(false);
    expect(update({ width: 328, height: 720 })).toBe(false);
    expect(resized).toHaveBeenCalledOnce();
  });
});
