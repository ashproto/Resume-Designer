import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bold, ChevronDown, Plus, Trash2, X } from 'lucide-react';

import { store, generateId, experienceSortValue } from '../../store.js';
import { SortableList, SortableItem, DragHandle } from '../Sortable.jsx';
import { PanelSection } from './PanelSection.jsx';
import DesignTab from './DesignTab.jsx';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Segmented, SegmentedItem } from '@/components/ui/segmented';
import { confirmDestructive } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';

// Structure panel — restyled onto genuine shadcn primitives + Tailwind for the
// full-shadcn chrome redesign. It's a docked side <aside> (not a modal), so it
// keeps its skeleton shell + slide CSS: this component wires the skeleton
// toggle/close buttons, syncs the .open / .panel-open classes, and portals its
// body into #structure-panel-content.
//
// Data flow (the cursor-jump fix, in React): inputs are UNCONTROLLED
// (defaultValue) and write to the store on change without remounting — so typing
// never disturbs the caret. A `dataVersion` key remounts the form ONLY on
// EXTERNAL store changes (variant switch / AI edit / undo) and on local ARRAY
// ops (add/delete/reorder), refreshing every field's defaultValue. Local text
// edits are suppressed via the module `localEdit` flag — the exact translation
// of the vanilla isHandlingLocalFieldUpdate gate. Collapse state is lifted here
// so it survives remounts; scroll position is captured + restored.

const TAB_OPTIONS = {
  header: { tabLabel: 'Header', label: 'Header' },
  sidebar: { tabLabel: 'Sidebar', label: 'Sidebar' },
  main: { tabLabel: 'Main', label: 'Main Content' },
  design: { tabLabel: 'Design', label: 'Design' },
};

const SECTION_TEMPLATES = {
  skills: { title: 'Skills', type: 'skills', content: ['Skill 1', 'Skill 2', 'Skill 3'] },
  highlights: { title: 'Highlights', type: 'list', content: ['- Key achievement 1', '- Key achievement 2'] },
  languages: { title: 'Languages', type: 'skills', content: ['English (Native)', 'Spanish (Conversational)'] },
  certifications: { title: 'Certifications', type: 'list', content: ['Certification Name — Year'] },
  interests: { title: 'Interests', type: 'skills', content: ['Interest 1', 'Interest 2'] },
};

// --- tools are stored as a ' • '-joined string, not an array ---
function normalizeTools(tools) {
  if (Array.isArray(tools)) return tools.map((t) => String(t || '').trim()).filter(Boolean);
  if (tools == null) return [];
  return String(tools).split(/[\n•]/g).map((t) => t.trim()).filter(Boolean);
}
function serializeTools(items) {
  return items.map((t) => String(t || '').trim()).filter(Boolean).join(' • ');
}

// Suppress the form remount while the user is typing in a text field (the store
// 'change' it triggers must NOT refresh defaultValues mid-keystroke). Module
// scope so the store subscription closure always sees the latest value.
let localEdit = false;
function writeField(path, value) {
  localEdit = true;
  try { store.update(path, value); } finally { localEdit = false; }
}
function writeTool(index, value) {
  const items = normalizeTools(store.get('tools'));
  if (index < 0 || index >= items.length) return;
  items[index] = value;
  writeField('tools', serializeTools(items));
}

// ------------------------------ small building blocks ------------------------

// Compact labeled field. Resume-data inputs stay UNCONTROLLED (defaultValue)
// and write through writeField on change — never `value`.
function Field({ label, type = 'text', path, defaultValue }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type} className="h-8" data-field={path} defaultValue={defaultValue}
        onChange={(e) => writeField(path, e.target.value)}
      />
    </div>
  );
}

// Ghost icon delete button at the end of a sortable row.
function RowDeleteButton({ title = 'Delete', onClick }) {
  return (
    <Button
      variant="ghost" size="icon" type="button"
      className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
      title={title} onClick={onClick}
    >
      <X className="size-3.5" />
    </Button>
  );
}

// "+ Add …" ghost row at the foot of a list.
function AddRowButton({ label, onClick }) {
  return (
    <Button
      variant="ghost" size="sm" type="button"
      className="w-full justify-start gap-2 text-muted-foreground"
      onClick={onClick}
    >
      <Plus className="size-3.5" /> {label}
    </Button>
  );
}

// ------------------------------ sub-views ------------------------------------

function SectionContentList({ sectionIndex, content }) {
  const ids = content.map((_, i) => `sc-${sectionIndex}-${i}`);
  return (
    <SortableList
      className="space-y-1.5"
      ids={ids}
      onReorder={(from, to) => store.moveInArray(`sections[${sectionIndex}].content`, from, to)}
    >
      {content.map((item, i) => (
        <SortableItem key={ids[i]} id={ids[i]} className="flex items-center gap-1.5">
          <DragHandle />
          <Input
            type="text" className="h-8 flex-1"
            data-field={`sections[${sectionIndex}].content[${i}]`}
            defaultValue={item}
            onChange={(e) => writeField(`sections[${sectionIndex}].content[${i}]`, e.target.value)}
          />
          <RowDeleteButton onClick={() => store.removeFromArray(`sections[${sectionIndex}].content`, i)} />
        </SortableItem>
      ))}
      <AddRowButton label="Add item" onClick={() => store.addToArray(`sections[${sectionIndex}].content`, 'New item')} />
    </SortableList>
  );
}

function SectionItem({ section, index }) {
  const type = section?.type === 'skills' ? 'skills' : 'list';
  const removeSection = async () => {
    const ok = await confirmDestructive({
      title: 'Delete this section?',
      description: 'The section and its items will be permanently removed from this resume.',
      actionLabel: 'Delete',
    });
    if (ok) store.removeFromArray('sections', index);
  };
  return (
    <SortableItem id={section.id || `section-${index}`} className="space-y-2.5 rounded-[9px] border bg-background p-2.5">
      <div className="flex items-center gap-1.5">
        <DragHandle />
        <Input
          type="text" className="h-8 flex-1"
          data-field={`sections[${index}].title`}
          defaultValue={section.title}
          onChange={(e) => writeField(`sections[${index}].title`, e.target.value)}
        />
        <RowDeleteButton title="Delete section" onClick={removeSection} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Display</span>
        <Segmented size="xs">
          {[['list', 'Bulleted'], ['skills', 'Inline Tags']].map(([t, label]) => (
            <SegmentedItem
              key={t} size="xs"
              active={type === t}
              onClick={() => writeField(`sections[${index}].type`, t)}
            >
              {label}
            </SegmentedItem>
          ))}
        </Segmented>
      </div>
      <SectionContentList sectionIndex={index} content={section.content || []} />
    </SortableItem>
  );
}

function ExperienceItem({ exp, index }) {
  const [expanded, setExpanded] = useState(exp._expanded !== false);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    // updateSilent => no history, no 'change' event, so no remount; the expanded
    // state persists across later structural re-renders (#9).
    store.updateSilent(`experience[${index}]._expanded`, next);
  };
  const removeExperience = async () => {
    const ok = await confirmDestructive({
      title: 'Delete this experience?',
      description: 'The experience entry will be permanently removed from this resume.',
      actionLabel: 'Delete',
    });
    if (ok) store.removeFromArray('experience', index);
  };
  const bulletIds = (exp.bullets || []).map((_, i) => `b-${index}-${i}`);
  return (
    <SortableItem id={exp.id || `exp-${index}`} className="overflow-hidden rounded-[9px] border bg-background">
      <div className="flex cursor-pointer items-center gap-2 px-2.5 py-2" onClick={toggle}>
        <DragHandle />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{exp.title || 'Untitled Position'}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">{exp.company || ''}</span>
        </span>
        <ChevronDown
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
        />
      </div>
      {/* Body stays MOUNTED when closed (Tailwind `hidden`), matching the old
          CSS expand/collapse — its uncontrolled inputs must keep their DOM
          values across toggles without a remount. */}
      <div className={cn('space-y-3 border-t bg-muted/40 p-2.5', !expanded && 'hidden')}>
        {[['title', 'Job Title'], ['company', 'Company'], ['dates', 'Dates']].map(([f, label]) => (
          <Field
            key={f} label={label}
            path={`experience[${index}].${f}`}
            defaultValue={exp[f] || ''}
          />
        ))}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Bullets</Label>
          <SortableList
            className="space-y-1.5" ids={bulletIds}
            onReorder={(from, to) => store.moveInArray(`experience[${index}].bullets`, from, to)}
          >
            {(exp.bullets || []).map((bullet, i) => (
              <SortableItem key={bulletIds[i]} id={bulletIds[i]} className="flex items-center gap-1.5">
                <DragHandle />
                <Input
                  type="text" className="h-8 flex-1"
                  data-field={`experience[${index}].bullets[${i}]`}
                  defaultValue={bullet}
                  onChange={(e) => writeField(`experience[${index}].bullets[${i}]`, e.target.value)}
                />
                <RowDeleteButton onClick={() => store.removeFromArray(`experience[${index}].bullets`, i)} />
              </SortableItem>
            ))}
            <AddRowButton label="Add bullet" onClick={() => store.addToArray(`experience[${index}].bullets`, 'New bullet point')} />
          </SortableList>
        </div>
        <Button
          variant="ghost" size="sm" type="button"
          className="text-destructive hover:text-destructive"
          onClick={removeExperience}
        >
          <Trash2 className="size-3.5" /> Delete Experience
        </Button>
      </div>
    </SortableItem>
  );
}

// ------------------------------ main component -------------------------------

export default function StructurePanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('header');
  const [dataVersion, bump] = useReducer((n) => n + 1, 0);
  const [collapsed, setCollapsed] = useState({});
  const [renameOpen, setRenameOpen] = useState(false); // "Custom Section…" title dialog
  const [customTitle, setCustomTitle] = useState('');
  // Visual-only highlight for the experience "Sort by" segmented control (the
  // sort itself is a one-shot reorder; this just reflects the last choice, with
  // Date as the default active segment per the mockup).
  const [sortMode, setSortMode] = useState('date');
  const tabContentRef = useRef(null);
  const scrollPos = useRef(0);

  // Wire the skeleton toggle + close buttons to our open state.
  useEffect(() => {
    const toggleBtn = document.getElementById('toggle-structure-panel');
    const closeBtn = document.getElementById('close-structure-panel');
    const onToggle = () => setOpen((o) => !o);
    const onClose = () => setOpen(false);
    toggleBtn?.addEventListener('click', onToggle);
    closeBtn?.addEventListener('click', onClose);
    return () => {
      toggleBtn?.removeEventListener('click', onToggle);
      closeBtn?.removeEventListener('click', onClose);
    };
  }, []);

  // Sync the slide/layout classes the existing CSS keys on.
  useEffect(() => {
    document.getElementById('structure-panel')?.classList.toggle('open', open);
    document.getElementById('toggle-structure-panel')?.classList.toggle('active', open);
    document.querySelector('.app')?.classList.toggle('panel-open', open);
  }, [open]);

  // Remount the content form on external store changes (and local array ops),
  // but never on a local text edit (localEdit gate).
  useEffect(() => {
    if (!open) return undefined;
    return store.subscribe((event) => {
      if (event === 'change' || event === 'dataLoaded') {
        if (localEdit) return;
        bump();
      }
    });
  }, [open]);

  // Restore scroll after a content remount.
  useLayoutEffect(() => {
    if (tabContentRef.current) tabContentRef.current.scrollTop = scrollPos.current;
  }, [dataVersion]);

  const host = typeof document !== 'undefined' ? document.getElementById('structure-panel-content') : null;
  if (!host || !open) return host ? createPortal(null, host) : null;

  const data = store.getData() || {};
  const toggleCollapse = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  const sectionProps = (id) => ({
    collapsed: !!collapsed[`${tab}-${id}`],
    onToggleCollapse: () => toggleCollapse(`${tab}-${id}`),
  });

  const addSection = (templateKey) => {
    const template = SECTION_TEMPLATES[templateKey];
    if (!template) return;
    store.addToArray('sections', { id: generateId('section'), ...JSON.parse(JSON.stringify(template)) });
  };
  const addCustomSection = () => {
    const title = customTitle.trim();
    if (!title) return;
    store.addToArray('sections', { id: generateId('section'), title, type: 'list', content: ['Item 1'] });
    setRenameOpen(false);
    setCustomTitle('');
  };
  const sortExperience = (mode) => {
    setSortMode(mode);
    const experience = store.get('experience');
    if (!Array.isArray(experience) || experience.length < 2) return;
    const sorted = [...experience];
    if (mode === 'relevance') {
      const rank = (e) => (Number.isFinite(e?._relevanceRank) ? e._relevanceRank : Number.MAX_SAFE_INTEGER);
      sorted.sort((a, b) => rank(a) - rank(b));
    } else {
      sorted.sort((a, b) => experienceSortValue(b) - experienceSortValue(a));
    }
    store.update('experience', sorted);
  };

  const handleBold = () => {
    const field = document.activeElement;
    if (!field?.matches?.('input[data-field], textarea[data-field]')) return;
    const path = field.dataset.field;
    if (!path) return;
    const s = field.selectionStart ?? 0;
    const e = field.selectionEnd ?? s;
    const value = field.value || '';
    const sel = value.slice(s, e);
    const bolded = sel.startsWith('**') && sel.endsWith('**') && sel.length >= 4;
    const replacement = bolded ? sel.slice(2, -2) : `**${sel}**`;
    const next = value.slice(0, s) + replacement + value.slice(e);
    field.value = next;
    writeField(path, next);
    field.focus();
    field.setSelectionRange(s, s + replacement.length);
  };

  const sections = data.sections || [];
  const experience = data.experience || [];
  const education = data.education || [];
  const tools = normalizeTools(data.tools);

  return createPortal(
    <>
      {/* Fixed top zone: 4-tab segmented switcher + bold toolbar (content scrolls). */}
      <div className="shrink-0 space-y-2.5 border-b px-4 pb-3 pt-3.5">
        <Segmented className="flex w-full">
          {Object.entries(TAB_OPTIONS).map(([key, { tabLabel, label }]) => (
            <SegmentedItem
              key={key}
              className="flex-1"
              active={tab === key}
              onClick={() => { scrollPos.current = 0; setTab(key); }}
              title={label}
            >
              {tabLabel}
            </SegmentedItem>
          ))}
        </Segmented>

        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="icon" type="button" className="size-7"
            title="Bold (Cmd/Ctrl+B)"
            onMouseDown={(e) => e.preventDefault()} onClick={handleBold}
          >
            <Bold className="size-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground">Format selected text</span>
        </div>
      </div>

      {/* Tab content — keyed so content tabs remount on data change; design tab
          stays put. This wrapper is the scroller (flex-1 + overflow-y-auto inside
          the host's flex column), exactly as .panel-tab-content was before. */}
      <div
        className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-3.5"
        ref={tabContentRef}
        onScroll={(e) => { scrollPos.current = e.currentTarget.scrollTop; }}
        key={tab === 'design' ? 'design' : `${tab}-${dataVersion}`}
      >
        {tab === 'header' && (
          <>
            <PanelSection title="Name & Title" {...sectionProps('name-title')}>
              <Field label="Name" path="name" defaultValue={data.name || ''} />
              <Field label="Professional Title" path="tagline" defaultValue={data.tagline || ''} />
            </PanelSection>
            <PanelSection title="Contact Information" {...sectionProps('contact-info')}>
              {[['location', 'Location', 'text'], ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'], ['portfolio', 'Portfolio URL', 'text'], ['instagram', 'Instagram', 'text']].map(([f, label, type]) => (
                <Field key={f} label={label} type={type} path={`contact.${f}`} defaultValue={data.contact?.[f] || ''} />
              ))}
            </PanelSection>
          </>
        )}

        {tab === 'sidebar' && (
          <>
            <PanelSection title="Sidebar Sections" {...sectionProps('sidebar-sections')} headerExtra={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" type="button" className="size-7" title="Add section">
                    <Plus className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {Object.entries(SECTION_TEMPLATES).map(([key, t]) => (
                    <DropdownMenuItem key={key} onSelect={() => addSection(key)}>{t.title}</DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onSelect={() => { setCustomTitle(''); setRenameOpen(true); }}>Custom Section…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }>
              <SortableList className="space-y-2" ids={sections.map((s, i) => s.id || `section-${i}`)}
                onReorder={(from, to) => store.moveInArray('sections', from, to)}>
                {sections.map((section, i) => <SectionItem key={section.id || `section-${i}`} section={section} index={i} />)}
              </SortableList>
            </PanelSection>

            <PanelSection title="Tools" {...sectionProps('tools')}>
              <SortableList className="space-y-1.5" ids={tools.map((_, i) => `tool-${i}`)}
                onReorder={(from, to) => {
                  const items = normalizeTools(store.get('tools'));
                  const [moved] = items.splice(from, 1);
                  items.splice(to, 0, moved);
                  writeField('tools', serializeTools(items));
                  bump();
                }}>
                {tools.map((tool, i) => (
                  <SortableItem key={`tool-${i}`} id={`tool-${i}`} className="flex items-center gap-1.5">
                    <DragHandle />
                    <Input
                      type="text" className="h-8 flex-1" placeholder="Tool name"
                      defaultValue={tool} onChange={(e) => writeTool(i, e.target.value)}
                    />
                    <RowDeleteButton onClick={() => { const items = normalizeTools(store.get('tools')); items.splice(i, 1); writeField('tools', serializeTools(items)); bump(); }} />
                  </SortableItem>
                ))}
                <AddRowButton label="Add tool" onClick={() => { const items = normalizeTools(store.get('tools')); items.push('New tool'); writeField('tools', serializeTools(items)); bump(); }} />
              </SortableList>
            </PanelSection>
          </>
        )}

        {tab === 'main' && (
          <>
            <PanelSection title="Summary" {...sectionProps('summary')}>
              <Textarea
                data-field="summary" rows={4} placeholder="A brief professional summary..."
                defaultValue={data.summary || ''} onChange={(e) => writeField('summary', e.target.value)}
              />
            </PanelSection>

            <PanelSection title="Experience" {...sectionProps('experience')} headerExtra={
              <Button
                variant="ghost" size="icon" type="button" className="size-7" title="Add experience"
                onClick={() => store.addToArray('experience', { id: generateId('exp'), title: 'New Position', company: 'Company Name', dates: 'Start – End', bullets: ['Describe your accomplishments'], _expanded: true })}
              >
                <Plus className="size-4" />
              </Button>
            }>
              {experience.length > 1 && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Sort by</span>
                  <Segmented size="xs">
                    <SegmentedItem size="xs" active={sortMode === 'date'} title="Sort by date (most recent first)" onClick={() => sortExperience('date')}>Date</SegmentedItem>
                    <SegmentedItem size="xs" active={sortMode === 'relevance'} title="Sort by relevance to the target role" onClick={() => sortExperience('relevance')}>Relevance</SegmentedItem>
                  </Segmented>
                </div>
              )}
              <SortableList className="space-y-2" ids={experience.map((e, i) => e.id || `exp-${i}`)}
                onReorder={(from, to) => store.moveInArray('experience', from, to)}>
                {experience.map((exp, i) => <ExperienceItem key={exp.id || `exp-${i}`} exp={exp} index={i} />)}
              </SortableList>
            </PanelSection>

            <PanelSection title="Education" {...sectionProps('education')} headerExtra={
              <Button
                variant="ghost" size="icon" type="button" className="size-7" title="Add education"
                onClick={() => store.addToArray('education', 'Degree — Institution — Dates')}
              >
                <Plus className="size-4" />
              </Button>
            }>
              <SortableList className="space-y-1.5" ids={education.map((_, i) => `edu-${i}`)}
                onReorder={(from, to) => store.moveInArray('education', from, to)}>
                {education.map((edu, i) => (
                  <SortableItem key={`edu-${i}`} id={`edu-${i}`} className="flex items-center gap-1.5">
                    <DragHandle />
                    <Input
                      type="text" className="h-8 flex-1" data-field={`education[${i}]`}
                      defaultValue={edu} onChange={(e) => writeField(`education[${i}]`, e.target.value)}
                    />
                    <RowDeleteButton onClick={() => store.removeFromArray('education', i)} />
                  </SortableItem>
                ))}
              </SortableList>
            </PanelSection>
          </>
        )}

        {tab === 'design' && <DesignTab />}
      </div>

      {/* Custom section title dialog (replaces prompt()) */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm glass-card">
          <DialogHeader>
            <DialogTitle>New section</DialogTitle>
            <DialogDescription className="sr-only">Enter a title for the new custom section</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); addCustomSection(); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="custom-section-title">Section title</Label>
              <Input id="custom-section-title" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setRenameOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!customTitle.trim()}>Add section</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>,
    host
  );
}
