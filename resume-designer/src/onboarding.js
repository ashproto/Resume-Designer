/**
 * Onboarding wizard bridge.
 *
 * The first-run wizard is now a React component
 * (src/components/onboarding/OnboardingWizard.jsx) that listens for the
 * `rd:open-onboarding` / `rd:close-onboarding` window events dispatched here. This
 * thin module preserves the original ES exports so the still-vanilla callers keep
 * working unchanged:
 *
 *   - main.js                  → shouldShowOnboarding() + showOnboardingWizard()
 *                                (300ms first-run check) and window.showOnboardingWizard
 *   - components/Header.jsx     → window.showOnboardingWizard({ skipApiKeyStep: true })
 *   - components/SettingsDialog → window.showOnboardingWizard()  ("Replay welcome")
 *
 * shouldShowOnboarding / completeOnboarding / resetOnboarding stay here as pure
 * flag logic (no DOM) — they read variants + a localStorage key and are imported
 * directly by the boot code and the wizard component. The wizard's AI/parse/save
 * logic lives in src/onboardingLogic.js.
 */
import { getVariants } from './persistence.js';

const ONBOARDING_KEY = 'resume-designer-onboarding-complete';

/**
 * Check if onboarding should be shown.
 * @returns {boolean}
 */
export function shouldShowOnboarding() {
  const variants = getVariants();
  const variantList = Object.values(variants);

  // Always show on a fresh install (no variants at all).
  if (variantList.length === 0) return true;

  // Honor the "completed" flag.
  if (localStorage.getItem(ONBOARDING_KEY) === 'true') return false;

  // Show if only built-in variants exist (no user-created ones).
  return variantList.every((v) => v.builtIn);
}

/** Mark onboarding as complete. */
export function completeOnboarding() {
  localStorage.setItem(ONBOARDING_KEY, 'true');
}

/** Reset onboarding (for testing). */
export function resetOnboarding() {
  localStorage.removeItem(ONBOARDING_KEY);
}

/**
 * Show the onboarding wizard.
 * @param {Object} options
 * @param {boolean} options.skipApiKeyStep - Skip the API-key step (new-resume mode)
 */
export function showOnboardingWizard(options = {}) {
  window.dispatchEvent(new CustomEvent('rd:open-onboarding', { detail: options }));
}

/** Close the onboarding wizard. */
export function closeOnboardingWizard() {
  window.dispatchEvent(new CustomEvent('rd:close-onboarding'));
}
