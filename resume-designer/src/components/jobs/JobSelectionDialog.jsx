import { useEffect, useState } from 'react';

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

// Job-selection modal for "Analyze Resume Fit", ported from
// showJobSelectionModal + renderJobSelectionModalContent in
// jobDescriptionPanel.js. The body-appended overlay is now a shadcn Dialog;
// selection / model / reasoning live in local state seeded each time the
// dialog opens, and confirm hands the chosen jobs back to the parent.

export function JobSelectionDialog({ open, onOpenChange, jobs, models, defaultModelId, onConfirm }) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [modelId, setModelId] = useState(defaultModelId);
  const [reasoning, setReasoning] = useState('medium');

  // Seed selection/model/reasoning when the dialog transitions to open.
  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set(jobs.filter((jd) => jd.isActive).map((jd) => jd.id)));
    setModelId(defaultModelId);
    setReasoning('medium');
  }, [open, jobs, defaultModelId]);

  const toggle = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(jobs.map((jd) => jd.id)));
  const clearAll = () => setSelectedIds(new Set());

  const confirm = () => {
    const selectedJobs = jobs.filter((j) => selectedIds.has(j.id));
    onConfirm(selectedJobs, modelId, reasoning);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="p-0 gap-0 max-w-[560px] glass-card">
        <DialogTitle className="sr-only">Analyze Resume Fit</DialogTitle>
        <DialogDescription className="sr-only">Select job descriptions to analyze your resume against</DialogDescription>
        <div className="jd-select-modal">
          <div className="jd-select-header">
            <h3>Analyze Resume Fit</h3>
            <button className="jd-select-close" onClick={() => onOpenChange(false)}>&times;</button>
          </div>
          <div className="jd-select-body">
            <div className="jd-ai-options">
              <div className="jd-model-selector">
                <label>Model</label>
                <select className="jd-model-select" value={modelId} onChange={(e) => setModelId(e.target.value)}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="jd-reasoning-selector">
                <label>Reasoning</label>
                <select className="jd-reasoning-select" value={reasoning} onChange={(e) => setReasoning(e.target.value)}>
                  <option value="none">Off</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            <div className="jd-select-section-label">Select Job Description(s)</div>
            <div className="jd-select-info">
              <span className="jd-select-count">{selectedIds.size} selected</span>
              <div className="jd-select-actions-header">
                <button className="jd-select-all-btn" onClick={selectAll}>Select All</button>
                <button className="jd-select-none-btn" onClick={clearAll}>Clear</button>
              </div>
            </div>
            <div className="jd-select-list">
              {jobs.map((jd) => {
                const selected = selectedIds.has(jd.id);
                const preview =
                  jd.description.length > 100 ? jd.description.substring(0, 100) + '...' : jd.description;
                return (
                  <label key={jd.id} className={`jd-select-item ${selected ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      className="jd-select-checkbox"
                      checked={selected}
                      onChange={() => toggle(jd.id)}
                    />
                    <div className="jd-select-item-content">
                      <div className="jd-select-item-header">
                        <span className="jd-select-item-title">{jd.title}</span>
                        <span className="jd-select-item-company">{jd.company}</span>
                      </div>
                      <p className="jd-select-item-preview">{preview}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="jd-select-footer">
            <button className="btn btn-secondary" onClick={() => onOpenChange(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={selectedIds.size === 0} onClick={confirm}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Analyze{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
