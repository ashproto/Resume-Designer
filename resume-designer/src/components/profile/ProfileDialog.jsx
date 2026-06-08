import { useState, useRef, useReducer, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { getUserProfile, saveUserProfile } from '../../persistence.js';
import { DEFAULT_PROFILE, profileToMarkdown, markdownToProfile } from '../../profileMarkdown.js';
import { TabIcon, ProfileTabContent } from './ProfileTabs.jsx';

const SAVE_DELAY = 500;

const PROFILE_TABS = [
  { id: 'contact', label: 'Contact', icon: 'contact' },
  { id: 'summary', label: 'Summary', icon: 'user' },
  { id: 'experience', label: 'Experience', icon: 'briefcase' },
  { id: 'skills', label: 'Skills', icon: 'star' },
  { id: 'education', label: 'Education', icon: 'book' },
  { id: 'projects', label: 'Projects', icon: 'folder' },
  { id: 'more', label: 'More', icon: 'plus' },
];

// A deep, shape-complete clone of the stored profile to edit against (so edits
// never mutate the persisted object until saved, and every key/array exists).
function buildWorkingCopy() {
  const stored = getUserProfile() || {};
  const cloned = JSON.parse(JSON.stringify(stored));
  return {
    ...DEFAULT_PROFILE,
    ...cloned,
    contactInfo: { ...DEFAULT_PROFILE.contactInfo, ...(cloned.contactInfo || {}) },
  };
}

/**
 * The User Profile editor — the React port of userProfilePanel.js. A shadcn
 * Dialog (built-in close suppressed; the header carries its own) wrapping the
 * existing `.profile-*` markup across 7 tabs. Always mounted (like Settings) so
 * the `rd:profile-flush` listener is present even when closed: that flush is
 * dispatched synchronously by backupFlow.js right before a backup import to win
 * the autosave-clobbers-import race.
 *
 * Edits mutate an in-memory working copy (a ref) and debounce-save to
 * persistence; a remount key (`version`) refreshes the uncontrolled inputs after
 * add/delete/import without disturbing the caret during typing.
 */
export default function ProfileDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('contact');
  const [saved, setSaved] = useState(false);
  const [version, bump] = useReducer((x) => x + 1, 0);

  const profileRef = useRef(null);
  if (profileRef.current === null) profileRef.current = buildWorkingCopy();
  const saveTimeoutRef = useRef(null);
  const savedTimeoutRef = useRef(null);

  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveUserProfile(profileRef.current);
      saveTimeoutRef.current = null;
      setSaved(true);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = setTimeout(() => setSaved(false), 1500);
    }, SAVE_DELAY);
  }, []);

  // Cancel the pending debounce and write immediately. No-op when nothing is
  // pending — safe to call unconditionally (the backupFlow flush contract).
  const flush = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
      saveUserProfile(profileRef.current);
    }
  }, []);

  // Save + remount the tab so a structural change (add/delete) shows.
  const refresh = useCallback(() => { scheduleSave(); bump(); }, [scheduleSave]);

  useEffect(() => {
    const onOpen = () => { profileRef.current = buildWorkingCopy(); bump(); setOpen(true); };
    const onFlush = () => flush();
    window.addEventListener('rd:open-profile', onOpen);
    window.addEventListener('rd:profile-flush', onFlush);
    return () => {
      window.removeEventListener('rd:open-profile', onOpen);
      window.removeEventListener('rd:profile-flush', onFlush);
    };
  }, [flush]);

  const handleOpenChange = (next) => {
    if (!next) flush(); // persist pending edits on close (ESC / click-outside / X)
    setOpen(next);
  };

  const handleExport = () => {
    const md = profileToMarkdown(profileRef.current);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'user-profile.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (file) => {
    file.text().then((text) => {
      const imported = markdownToProfile(text);
      profileRef.current = {
        ...DEFAULT_PROFILE,
        ...imported,
        contactInfo: { ...DEFAULT_PROFILE.contactInfo, ...(imported.contactInfo || {}) },
      };
      saveUserProfile(profileRef.current);
      bump();
    }).catch((err) => {
      console.error('Failed to import profile:', err);
      window.alert(`Failed to import profile: ${err.message}`);
    });
  };

  const startInterview = () => {
    setOpen(false);
    // Let the dialog close before the chat panel takes over (matches the old flow).
    setTimeout(() => window.startProfileInterviewFromChat?.(), 200);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] w-[90vw] max-w-[700px] flex-col gap-0 overflow-hidden p-0 glass-card"
      >
        <DialogTitle className="sr-only">User Profile</DialogTitle>
        <DialogDescription className="sr-only">Background information for AI assistance</DialogDescription>

        <div className="profile-panel-header">
          <div className="profile-panel-title-row">
            <div>
              <h2>User Profile</h2>
              <span className="profile-panel-subtitle">Background info for AI assistance</span>
            </div>
            <div className="profile-header-actions">
              <span className={cn('save-indicator', saved && 'show')}>Saved</span>
              <label className="profile-import-btn" title="Import profile from markdown file">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Import
                <input
                  type="file"
                  accept=".md,.markdown,.txt"
                  hidden
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleImport(f); }}
                />
              </label>
              <button className="profile-export-btn" type="button" title="Export profile to markdown file" onClick={handleExport}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export
              </button>
              <button className="profile-ai-interview-btn" type="button" title="Fill profile via AI interview" onClick={startInterview}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                AI Interview
              </button>
              <button className="profile-panel-close" type="button" title="Close" onClick={() => handleOpenChange(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="profile-panel-tabs">
          {PROFILE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn('profile-tab', t.id === tab && 'active')}
              onClick={() => setTab(t.id)}
            >
              <TabIcon icon={t.icon} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="profile-panel-content">
          <div key={`${tab}-${version}`}>
            <ProfileTabContent tab={tab} profile={profileRef.current} scheduleSave={scheduleSave} refresh={refresh} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
