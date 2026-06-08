import { useEffect, useState } from 'react';

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

// Job-description edit modal, ported from openEditModal in
// jobDescriptionPanel.js. The body-appended overlay is now a shadcn Dialog with
// controlled inputs seeded from `jd` whenever the dialog opens; Save trims and
// hands the values back to the parent (only when a description is present).

export function JobEditDialog({ open, onOpenChange, jd, onSave }) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [description, setDescription] = useState('');

  // Seed the form from the selected job when the dialog opens.
  useEffect(() => {
    if (open && jd) {
      setTitle(jd.title || '');
      setCompany(jd.company || '');
      setDescription(jd.description || '');
    }
  }, [open, jd]);

  const save = () => {
    if (description.trim()) {
      onSave({ title: title.trim(), company: company.trim(), description: description.trim() });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="p-0 gap-0 max-w-[560px] glass-card">
        <DialogTitle className="sr-only">Edit Job Description</DialogTitle>
        <DialogDescription className="sr-only">Edit the title, company, and description for this job</DialogDescription>
        <div className="jd-edit-modal">
          <div className="jd-edit-header">
            <h3>Edit Job Description</h3>
            <button className="jd-edit-close" onClick={() => onOpenChange(false)}>&times;</button>
          </div>
          <div className="jd-edit-form">
            <input
              type="text"
              className="jd-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Job Title"
            />
            <input
              type="text"
              className="jd-input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Company"
            />
            <textarea
              className="jd-textarea"
              rows="10"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Job Description"
            />
            <div className="jd-edit-actions">
              <button className="btn btn-secondary jd-edit-cancel" onClick={() => onOpenChange(false)}>Cancel</button>
              <button className="btn btn-primary jd-edit-save" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
