// React entry for the app chrome. Replaces the vanilla src/main.js as the
// index.html script. Renders <App/>, which hosts the still-vanilla chrome
// skeleton and boots it via init(), and mounts the Sonner toaster.
//
// The hidden PDF-capture window uses a separate framework-free entry
// (print.html / src/printEntry.js) so React never loads in the capture graph.
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '../styles/shadcn.css';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

const rootEl = document.getElementById('root');
if (rootEl) {
  // No StrictMode: init() (run from App's mount effect) is not double-invoke
  // safe — it wires global listeners and migrates data once. A module-level
  // guard in App.jsx also protects against an accidental remount.
  createRoot(rootEl).render(<App />);
}
