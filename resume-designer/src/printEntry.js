// Framework-free entry for the hidden PDF-capture window (print.html).
//
// The old print path was index.html?print=1 -> main.js -> init() ->
// initPrintMode(). Now that index.html is the React shell, the capture window
// loads this entry instead and calls initPrintMode() directly. It imports from
// the vanilla main.js (NO React in this graph), so the import graph + render
// path are identical to before — only the host document changed.
import { initAppStorage } from './appStorage.js';
import { initPrintMode } from './main.js';

// Storage must be initialized read-only BEFORE initPrintMode() reads the
// variant data: on Tauri the data lives in per-key disk files, not
// localStorage. readOnly means this window can never write app data — the
// main window remains the single writer.
initAppStorage({ readOnly: true }).then(() => initPrintMode());
