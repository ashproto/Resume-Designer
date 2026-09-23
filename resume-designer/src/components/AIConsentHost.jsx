import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { setAIConsentPresenter } from '../aiConsent.js';
import { isNativeShellAvailable, requestNativeAIConsent } from '../iosShell.js';
import { PrivacyPolicyContent } from './PrivacyPolicyContent.jsx';

/** One presenter shared by every AI entry point; the service owns permission. */
export function AIConsentHost() {
  const [request, setRequest] = useState(null);
  const settle = useRef(null);
  useEffect(() => {
    setAIConsentPresenter((details) => {
      if (isNativeShellAvailable()) return requestNativeAIConsent(details);
      if (details.signal?.aborted) return false;
      return new Promise((resolve) => {
        const finish = (allowed) => {
          details.signal?.removeEventListener('abort', abort);
          setRequest(null);
          settle.current = null;
          resolve(allowed === true);
        };
        function abort() { finish(false); }
        settle.current = finish;
        details.signal?.addEventListener('abort', abort, { once: true });
        setRequest(details);
      });
    });
    return () => { setAIConsentPresenter(null); settle.current?.(false); };
  }, []);
  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) settle.current?.(false); }}>
      <DialogContent className="glass-card max-w-lg z-[3100]" overlayClassName="z-[3100]">
        <DialogTitle>{request?.title || 'AI data sharing'}</DialogTitle>
        <DialogDescription className="whitespace-pre-line">{request?.message}</DialogDescription>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Privacy policy</summary>
          <div className="mt-3"><PrivacyPolicyContent /></div>
        </details>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => settle.current?.(false)}>Not now</Button>
          <Button onClick={() => settle.current?.(true)}>Allow AI sharing</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
