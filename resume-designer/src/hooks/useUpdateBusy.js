import { useSyncExternalStore } from 'react';
import { subscribeUpdateBusy, getUpdateBusy } from '../updateFlow.js';

/**
 * Reactive "an update check/download is in progress" flag. Drives the disabled
 * state of the Settings → Updates "Check for Updates" button (replacing the old
 * imperative setUpdateButtonsDisabled() that toggled the DOM button directly).
 */
export function useUpdateBusy() {
  return useSyncExternalStore(subscribeUpdateBusy, getUpdateBusy);
}
