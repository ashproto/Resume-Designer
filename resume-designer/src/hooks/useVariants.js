import { useSyncExternalStore } from 'react';
import { subscribeVariants, getVariantsSnapshot } from '../variantManager.js';

/**
 * Read the variant list + current selection reactively. variantManager caches a
 * stable snapshot ({ currentId, list }) and only recomputes it on a real change
 * (load/create/delete/rename), so this satisfies useSyncExternalStore's
 * stable-snapshot requirement without re-reading storage every render.
 */
export function useVariants() {
  return useSyncExternalStore(subscribeVariants, getVariantsSnapshot);
}
