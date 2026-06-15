/**
 * Theme Manager
 * Handles light/dark mode switching with system preference support
 */

import { appStorage } from './appStorage.js';

const STORAGE_KEY = 'resume-designer-theme';
const THEMES = ['light', 'dark', 'system'];

let currentTheme = 'system';

/**
 * Initialize theme manager
 */
export function initTheme() {
  // Load saved preference
  const saved = appStorage.getItem(STORAGE_KEY);
  if (saved && THEMES.includes(saved)) {
    currentTheme = saved;
  }
  
  // Apply theme
  applyTheme(currentTheme);
  
  // Listen for system preference changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    if (currentTheme === 'system') {
      applyTheme('system');
    }
  });
  
  // Update UI
  updateThemeUI();
}

/**
 * Get the current theme setting
 */
export function getTheme() {
  return currentTheme;
}

/**
 * Get the actual resolved theme (light or dark)
 */
export function getResolvedTheme() {
  if (currentTheme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return currentTheme;
}

/**
 * Set and apply a theme
 */
export function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  
  currentTheme = theme;
  appStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
  updateThemeUI();
}

/**
 * Toggle between light and dark (skips system)
 */
export function toggleTheme() {
  const resolved = getResolvedTheme();
  setTheme(resolved === 'light' ? 'dark' : 'light');
}

/**
 * Apply theme to document
 */
function applyTheme(theme) {
  const root = document.documentElement;
  
  if (theme === 'system') {
    // Remove explicit theme, let CSS media query handle it
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
  
  // Dispatch event for other components
  window.dispatchEvent(new CustomEvent('themechange', { 
    detail: { theme, resolved: getResolvedTheme() } 
  }));
}

/**
 * Update theme UI elements.
 *
 * The legacy vanilla theme-picker dropdown this used to sync is gone — the React
 * SettingsDialog (and the header toggle) now reflect the active theme via
 * component state and the `themechange` event dispatched in applyTheme(). No DOM
 * element needs updating here anymore, so this is a no-op kept for its callers.
 */
function updateThemeUI() {
  // Intentionally empty (see above).
}
