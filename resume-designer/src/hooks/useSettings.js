import { useSyncExternalStore } from 'react';
import { getSettings, SETTINGS_UPDATED_EVENT } from '../persistence.js';

// Bridge the settings store into React. saveSettings() (in persistence.js)
// remains the ONLY writer and dispatches SETTINGS_UPDATED_EVENT; every consumer
// re-reads here. Same cached-snapshot guard as useResumeStore (getSettings()
// may return a fresh object each call).
let snapshot = getSettings();

window.addEventListener(SETTINGS_UPDATED_EVENT, () => {
  snapshot = getSettings();
});

function subscribe(callback) {
  window.addEventListener(SETTINGS_UPDATED_EVENT, callback);
  return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, callback);
}

/** Reactive, referentially-stable snapshot of app settings. */
export function useSettings() {
  return useSyncExternalStore(subscribe, () => snapshot);
}
