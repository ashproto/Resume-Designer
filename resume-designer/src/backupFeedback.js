import { toast } from 'sonner';

export function notifyBackupDownloadStarted({ filename, profileName } = {}) {
  const title = profileName
    ? `Backup download started for "${profileName}"`
    : 'Backup download started';
  toast.success(title, { description: String(filename ?? '') });
}
