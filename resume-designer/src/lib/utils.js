import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn's `cn` helper: merge class names with Tailwind-aware conflict
 * resolution (later utility wins over an earlier conflicting one).
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
