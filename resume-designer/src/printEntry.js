// Framework-free entry for the hidden PDF-capture window (print.html).
//
// The old print path was index.html?print=1 -> main.js -> init() ->
// initPrintMode(). Now that index.html is the React shell, the capture window
// loads this entry instead and calls initPrintMode() directly. It imports from
// the vanilla main.js (NO React in this graph), so the import graph + render
// path are identical to before — only the host document changed.
import { initPrintMode } from './main.js';

initPrintMode();
