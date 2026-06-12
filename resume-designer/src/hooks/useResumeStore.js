import { useSyncExternalStore } from 'react';
import { store } from '../store.js';

// Bridge store.js (the vanilla single source of truth) into React without
// rewriting it.
//
// THE CLONE TRAP: store.getData() deep-clones on every call, so passing it
// straight to useSyncExternalStore as getSnapshot would return a new reference
// each render and loop forever ("getSnapshot should be cached"). So we cache a
// snapshot module-side and refresh it ONLY on a render-relevant store event
// (mirroring main.js's own subscription filter).
const RENDER_EVENTS = new Set(['change', 'fieldUpdated', 'dataLoaded']);

let snapshot = store.getData();

// Permanent subscription that keeps the cached snapshot fresh. The unsubscribe
// is intentionally dropped — this lives for the app's lifetime.
store.subscribe((event) => {
  if (RENDER_EVENTS.has(event)) snapshot = store.getData();
});

function subscribe(callback) {
  return store.subscribe((event) => {
    if (RENDER_EVENTS.has(event)) callback();
  });
}

/** Reactive, referentially-stable snapshot of the current resume data. */
export function useResumeStore() {
  return useSyncExternalStore(subscribe, () => snapshot);
}
