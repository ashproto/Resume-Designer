import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Copy, Pencil, Trash2, MoreHorizontal, Wrench, Upload, Download,
  ChevronDown, Settings, FileDown, User, Briefcase, History, Menu, Check,
} from 'lucide-react';

import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { useVariants } from '../hooks/useVariants.js';
import {
  loadVariant, duplicateVariant, deleteCurrentVariant, renameCurrentVariant,
  importVariant, exportCurrentVariant,
} from '../variantManager.js';
import { openSettings } from '../settingsModal.js';

// Format a variant's updatedAt for the selector menu (relative, then absolute).
function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (diffDays === 0) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The app header, converted from headerBar.js (Step 6 of the React migration).
 *
 * Rendered via createPortal into the empty `<header id="header-bar">` left in the
 * static skeleton (kept there for layout + so tauriDrag.js can attach the
 * window-drag region to it). We reuse the existing `.header-*` CSS classes so the
 * bar's layout, responsive collapse, and liquid-glass background carry over
 * unchanged; only the floating menus become shadcn <DropdownMenu>s. Radix portals
 * those to <body>, so they blur correctly outside the frosted header — which is
 * exactly what menuPortal.js used to do by hand (now obsolete for the header).
 *
 * Variant CRUD lives in variantManager.js; this component is the view + the
 * rename dialog. App mounts it only after the skeleton is injected, so
 * `#header-bar` is guaranteed to exist.
 */
export default function Header() {
  const { currentId, list } = useVariants();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const importInputRef = useRef(null);

  const host = typeof document !== 'undefined' ? document.getElementById('header-bar') : null;
  if (!host) return null;

  const currentName = list.find((v) => v.id === currentId)?.name || 'Select Resume';

  const newVariant = () => window.showOnboardingWizard?.({ skipApiKeyStep: true });
  const openRename = () => {
    setRenameValue(currentName);
    setRenameOpen(true);
  };
  const submitRename = (e) => {
    e.preventDefault();
    if (renameCurrentVariant(renameValue)) setRenameOpen(false);
  };
  const pickImport = () => importInputRef.current?.click();
  const onImportChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      importVariant(file);
      e.target.value = ''; // allow re-importing the same file
    }
  };

  // Variant action items reused by the expanded buttons, the "⋯" menu, and mobile.
  const variantActions = [
    { key: 'new', label: 'New Resume', Icon: Plus, run: newVariant },
    { key: 'duplicate', label: 'Duplicate', Icon: Copy, run: duplicateVariant },
    { key: 'rename', label: 'Rename', Icon: Pencil, run: openRename },
    { key: 'delete', label: 'Delete', Icon: Trash2, run: deleteCurrentVariant, danger: true },
  ];
  const toolItems = [
    { key: 'profile', label: 'User Profile', Icon: User, run: () => window.openUserProfilePanel?.() },
    { key: 'jobs', label: 'Job Descriptions', Icon: Briefcase, run: () => window.openJobDescriptionPanel?.() },
    { key: 'history', label: 'Version History', Icon: History, run: () => window.openHistoryPanel?.() },
  ];

  return createPortal(
    <>
      <div className="header-brand">
        <h1 className="header-title">Resume Designer</h1>
      </div>

      <div className="header-variant">
        {/* Variant selector */}
        <div className="custom-dropdown">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="custom-dropdown-trigger" type="button">
                <span className="dropdown-label">{currentName}</span>
                <ChevronDown className="dropdown-chevron" size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[60vh] min-w-56 overflow-y-auto">
              {list.map((v) => (
                <DropdownMenuItem key={v.id} onSelect={() => loadVariant(v.id)}>
                  <Check className={cn('size-3.5 shrink-0', v.id !== currentId && 'opacity-0')} />
                  <span className="flex flex-col">
                    <span>{v.name}</span>
                    {v.updatedAt && (
                      <span className="text-xs text-muted-foreground">{formatDate(v.updatedAt)}</span>
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Expanded variant actions (wide screens) */}
        <div className="header-variant-actions-expanded">
          {variantActions.map(({ key, label, Icon, run, danger }) => (
            <button
              key={key}
              className={cn('header-action-btn', danger && 'danger')}
              title={label}
              onClick={run}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>

        {/* Collapsed variant actions (medium screens) */}
        <div className="header-variant-actions-dropdown">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="header-variant-actions-btn" title="Resume Actions">
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {variantActions.map(({ key, label, Icon, run, danger }) => (
                <DropdownMenuItem key={key} onSelect={run} className={danger ? 'text-destructive focus:text-destructive' : undefined}>
                  <Icon className="size-4" />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="header-actions">
        {/* Mobile menu (shown on narrow screens) */}
        <div className="header-mobile-menu-btn">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button title="Menu" className="flex items-center justify-center">
                <Menu size={20} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuLabel>Resume</DropdownMenuLabel>
              {variantActions.map(({ key, label, Icon, run, danger }) => (
                <DropdownMenuItem key={key} onSelect={run} className={danger ? 'text-destructive focus:text-destructive' : undefined}>
                  <Icon className="size-4" />
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Tools</DropdownMenuLabel>
              {toolItems.map(({ key, label, Icon, run }) => (
                <DropdownMenuItem key={key} onSelect={run}>
                  <Icon className="size-4" />
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>File</DropdownMenuLabel>
              <DropdownMenuItem onSelect={pickImport}>
                <Upload className="size-4" /> Import
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportCurrentVariant('json')}>
                <Download className="size-4" /> Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportCurrentVariant('md')}>
                <Download className="size-4" /> Export as Markdown
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Desktop actions (hidden on mobile) */}
        <div className="header-desktop-actions">
          {/* Tools */}
          <div className="header-tools-dropdown">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="header-tools-btn" title="Tools">
                  <Wrench size={16} />
                  <span className="btn-text">Tools</span>
                  <ChevronDown className="dropdown-arrow" size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {toolItems.map(({ key, label, Icon, run }) => (
                  <DropdownMenuItem key={key} onSelect={run}>
                    <Icon className="size-4" />
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Import */}
          <button className="header-import-btn" title="Import resume" onClick={pickImport}>
            <Upload size={16} />
            <span className="btn-text">Import</span>
          </button>

          {/* Export */}
          <div className="header-export-dropdown">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="header-export-btn">
                  <Download size={16} />
                  <span className="btn-text">Export</span>
                  <ChevronDown className="dropdown-arrow" size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => exportCurrentVariant('json')}>Export as JSON</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportCurrentVariant('md')}>Export as Markdown</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Settings gear */}
        <button className="header-action-btn" title="Settings" onClick={() => openSettings()}>
          <Settings size={18} />
        </button>

        {/* PDF export — proxies the hidden #download-pdf button wired by pdf.js */}
        <button
          className="btn btn-primary header-pdf-btn"
          onClick={() => document.getElementById('download-pdf')?.click()}
        >
          <FileDown size={16} />
          <span className="btn-text">PDF</span>
        </button>
      </div>

      {/* Shared hidden file input for Import (desktop + mobile) */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,.md,.markdown"
        hidden
        onChange={onImportChange}
      />

      {/* Rename dialog (replaces the old custom prompt modal) */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm glass-card">
          <DialogHeader>
            <DialogTitle>Rename resume</DialogTitle>
            <DialogDescription className="sr-only">Enter a new name for the current resume variant</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitRename} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rename-variant-input">Name</Label>
              <Input
                id="rename-variant-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!renameValue.trim()}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>,
    host
  );
}
