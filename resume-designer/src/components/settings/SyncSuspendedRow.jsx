import { CloudOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Shown only while iCloud sync is suspended on this Mac — after the account's
 * owner deleted this app's iCloud data. The transport stays down on its own
 * durable marker and re-sends nothing until a person asks; this is the one
 * place they can. Nothing on this device was deleted, and the copy says so.
 *
 * Pure: the parent decides `suspended` and supplies `onResume` (the desktop
 * bridge's `resumeAfterPurge`, which re-owes every full upload before it
 * clears the marker). iOS has this row in its native Settings sheet.
 */
export function SyncSuspendedRow({ suspended, onResume }) {
  if (!suspended) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5"
    >
      <CloudOff className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">iCloud sync is paused on this Mac</div>
        <p className="mt-0.5 text-[12.5px] leading-[1.5] text-muted-foreground">
          Your iCloud data for On Paper was deleted from the account. Everything on this Mac
          is still here. Resuming uploads it to iCloud again.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onResume}>Resume syncing</Button>
    </div>
  );
}
