import { useEffect, useReducer, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { store } from '../store.js';
import { isNativeShellAvailable } from '../iosShell.js';
import { openChatWithContext } from '../chatPanel.js';
import { GapReport } from './onboarding/GapReport.jsx';
import { LiveReasoning } from './chat/LiveReasoning.jsx';

export default function GenerationReviewDialog() {
  const [open, setOpen] = useState(false);
  const [, refresh] = useReducer((value) => value + 1, 0);

  useEffect(() => {
    const show = () => { if (!isNativeShellAvailable() && store.getData()?.generationReview) setOpen(true); };
    window.addEventListener('rd:open-generation-review', show);
    return () => window.removeEventListener('rd:open-generation-review', show);
  }, []);

  useEffect(() => {
    if (!open) return;
    return store.subscribe(() => {
      if (!store.getData()?.generationReview) setOpen(false);
      refresh();
    });
  }, [open]);

  const resume = open ? store.getData() : null;
  const review = resume?.generationReview;
  if (!review) return null;
  const gaps = Array.isArray(review.gaps) ? review.gaps.filter((gap) => typeof gap?.requirement === 'string').map((gap) => ({
    requirement: gap.requirement,
    severity: typeof gap.severity === 'string' ? gap.severity : undefined,
    note: typeof gap.note === 'string' ? gap.note : undefined,
  })) : [];
  const corrections = Array.isArray(review.corrections) ? review.corrections.filter((value) => typeof value === 'string') : [];
  const notes = typeof review.notes === 'string' ? review.notes : '';

  const continueDiscussion = () => {
    setOpen(false);
    openChatWithContext(`Generation notes for ${resume.name || 'this resume'}:\n${JSON.stringify(review, null, 2)}`, '', 'generation-review');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <div className="space-y-1">
          <DialogTitle>Generation notes</DialogTitle>
          <DialogDescription>Saved when {resume.name || 'this resume'} was generated or revised. Later editor changes may not be reflected here. Continue the discussion to correct assumptions or refine the draft.</DialogDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {Number.isInteger(review.targetPages) && review.targetPages >= 1 && review.targetPages <= 3 && <Badge variant="outline">{review.targetPages} page{review.targetPages === 1 ? '' : 's'} target</Badge>}
          {['concise', 'balanced', 'detailed'].includes(review.verbosity) && <Badge variant="outline" className="capitalize">{review.verbosity}</Badge>}
          {Number.isFinite(review.score) && review.score >= 0 && review.score <= 100 && <Badge variant="secondary">Fit assessment {review.score}/100</Badge>}
        </div>
        {notes && <p className="whitespace-pre-wrap text-sm leading-relaxed">{notes}</p>}
        <GapReport gaps={gaps} />
        {corrections.length > 0 && <div className="space-y-2">
          <h3 className="text-sm font-medium">Your corrections and requests</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{corrections.map((correction, index) => <li key={index}>{correction}</li>)}</ul>
        </div>}
        {typeof review.reasoning === 'string' && review.reasoning !== notes && <LiveReasoning reasoning={review.reasoning} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          <Button onClick={continueDiscussion}><MessageSquareText className="size-4" /> Continue discussion</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
