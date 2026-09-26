import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { requestAIConsent, revokeAIConsent, hasAIConsent } from '../src/aiConsent.js';
import { AIConsentHost } from '../src/components/AIConsentHost.jsx';
import OnboardingWizard from '../src/components/onboarding/OnboardingWizard.jsx';

beforeEach(async () => { localStorage.clear(); await revokeAIConsent(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AI sharing permission UI', () => {
  it.each(['Allow AI sharing', 'Not now'])('removes the completed %s dialog even when its exit animation never ends', async (action) => {
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
      const styles = originalGetComputedStyle(element, pseudoElement);
      if (!element.matches('[role="dialog"], .glass-overlay')) return styles;
      // Real browsers expose live computed styles. Model an exit animation
      // without animationend, which otherwise keeps Radix Presence mounted.
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
    render(<AIConsentHost />);
    let pending;
    await act(async () => { pending = requestAIConsent().catch((error) => error); });
    expect(screen.getByRole('dialog')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: action }));
      await pending;
    });

    expect(hasAIConsent()).toBe(action === 'Allow AI sharing');
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(document.querySelector('.glass-overlay')).toBeNull();
  });

  it('keeps the permission dialog and its backdrop above the onboarding wizard that requested it', async () => {
    render(<><OnboardingWizard /><AIConsentHost /></>);
    await act(async () => { window.dispatchEvent(new CustomEvent('rd:open-onboarding')); });
    let pending;
    await act(async () => { pending = requestAIConsent().catch((error) => error); });
    const wizard = document.getElementById('onboarding-overlay');
    const dialog = screen.getByRole('dialog');
    const overlay = document.querySelector('.glass-overlay');

    // Compile the actual rendered utilities so this guards stacking behavior,
    // including the backdrop, without coupling the test to a particular layer.
    const { css } = await postcss([tailwindcss({
      content: [{ raw: document.body.innerHTML, extension: 'html' }],
      corePlugins: ['zIndex'],
    })]).process('@tailwind utilities;', { from: undefined });
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    try {
      const wizardLayer = Number(getComputedStyle(wizard).zIndex);
      expect(wizardLayer).toBeGreaterThan(0);
      expect(Number(getComputedStyle(dialog).zIndex)).toBeGreaterThan(wizardLayer);
      expect(Number(getComputedStyle(overlay).zIndex)).toBeGreaterThan(wizardLayer);
      expect(Number(getComputedStyle(overlay).zIndex)).toBeLessThanOrEqual(Number(getComputedStyle(dialog).zIndex));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Allow AI sharing' })); await pending; });
      expect(hasAIConsent()).toBe(true);
    } finally {
      style.remove();
    }
  });

  it('shows the disclosure before permission and leaves local editing available after decline', async () => {
    render(<AIConsentHost />);
    let pending;
    await act(async () => { pending = requestAIConsent().catch((error) => error); });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/^AI features send/).textContent).toContain('OpenRouter');
    expect(hasAIConsent()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect((await pending).code).toBe('AI_CONSENT_DECLINED');
    expect(hasAIConsent()).toBe(false);
  });

  it('grants permission only after the explicit Allow action and shows the offline policy', async () => {
    render(<AIConsentHost />);
    let pending;
    await act(async () => { pending = requestAIConsent().catch((error) => error); });
    fireEvent.click(screen.getByText('Privacy policy'));
    expect(screen.getByText(/Last updated/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Allow AI sharing' })); await pending; });
    expect(hasAIConsent()).toBe(true);
  });
});
