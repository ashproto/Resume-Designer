/**
 * Storage-failure toast helper for modules in the print window's static
 * graph (variantManager, persistence, jobDescriptions). sonner is loaded
 * lazily — a static `import { toast } from 'sonner'` would drag React,
 * ReactDOM, and a CSS injection into the deliberately React-free PDF-capture
 * bundle (the same constraint appStorage.js solves the same way).
 *
 * `once: true` shares a single per-session gate across all callers: passive/
 * background failures (debounced auto-save, job-description writes) produce
 * one "storage full" notice per session instead of stacking three flavors of
 * the same alarm. Direct user actions (create/duplicate/import) pass no flag
 * and toast on every attempt.
 */
let onceShown = false;

export function storageErrorToast(message, { once = false } = {}) {
  if (once) {
    if (onceShown) return;
    onceShown = true;
  }
  // Console first — it must fire even where no Toaster is mounted (print
  // window) or if the dynamic import fails.
  console.error('[storage]', message);
  import('sonner').then(({ toast }) => toast.error(message)).catch(() => {});
}

/** Test-only: reset the once-per-session gate between tests. */
export function __resetStorageToastForTests() {
  onceShown = false;
}
