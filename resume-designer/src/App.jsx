import { useEffect, useRef } from 'react';
import shellHtml from './shell/appShell.html?raw';
import { Toaster } from '@/components/ui/sonner';
import SettingsDialog from './components/SettingsDialog.jsx';
import { init } from './main.js';

// Single-root migration shell.
//
// React renders an empty container and injects the existing vanilla chrome
// skeleton (header, chat/structure panels, settings modal, toggles, hidden PDF
// button) into it ONCE. The markup is app-controlled and fixed at build time (a
// ?raw import of the former index.html body), NOT user input. The vanilla
// init() then wires every module against that markup exactly as it did when the
// markup lived in index.html. Regions are carved out into real React components
// one at a time (Steps 5-7), shrinking this hosted blob.
//
// React never re-renders the container's contents (it has no JSX children), so
// it won't clobber the injected DOM — the same contract renderCurrentResume
// relies on for #resume. The container is display:contents (and #root too, see
// shadcn.css) so `.app` keeps its body-level layout.
//
// App is the root, mounted once, never unmounted, and not wrapped in
// StrictMode, so the one-shot boot runs exactly once; the guard is cheap
// insurance against an accidental double-invoke.
let didBoot = false;

export default function App() {
  const shellRef = useRef(null);

  useEffect(() => {
    if (didBoot) return;
    didBoot = true;
    const host = shellRef.current;
    if (host) {
      // Parse the static skeleton and append its nodes. DOMParser never executes
      // scripts (and the skeleton has none), so this stays off the XSS path
      // while producing DOM identical to the original index.html body.
      const parsed = new DOMParser().parseFromString(shellHtml, 'text/html');
      while (parsed.body.firstChild) {
        host.appendChild(parsed.body.firstChild);
      }
    }
    init().catch((err) => console.error('[App] init failed:', err));
  }, []);

  return (
    <>
      <div ref={shellRef} style={{ display: 'contents' }} />
      <SettingsDialog />
      <Toaster />
    </>
  );
}
