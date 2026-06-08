import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

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
import { Label } from '@/components/ui/label';

// Structure panel, converted from structurePanel.js (Step 7). It's a docked
// side <aside> (not a modal), so it keeps its skeleton shell + slide CSS: this
// component wires the skeleton toggle/close buttons, syncs the .open / .panel-open
// classes, and portals its body into #structure-panel-content.
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
  header: { label: 'Header', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="6" rx="1" /><rect x="3" y="12" width="18" height="9" rx="1" opacity="0.3" /></svg> },
  sidebar: { label: 'Sidebar', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="6" height="18" rx="1" /><rect x="12" y="3" width="9" height="18" rx="1" opacity="0.3" /></svg> },
  main: { label: 'Main Content', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="6" height="18" rx="1" opacity="0.3" /><rect x="12" y="3" width="9" height="18" rx="1" /></svg> },
  design: { label: 'Design', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 2a4.5 4.5 0 0 0 0 9 4.5 4.5 0 0 1 0 9 10 10 0 0 0 0-18z" /></svg> },
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

// ------------------------------ sub-views ------------------------------------

function SectionContentList({ sectionIndex, content }) {
  const ids = content.map((_, i) => `sc-${sectionIndex}-${i}`);
  return (
    <SortableList
      className="section-content-list"
      ids={ids}
      onReorder={(from, to) => store.moveInArray(`sections[${sectionIndex}].content`, from, to)}
    >
      {content.map((item, i) => (
        <SortableItem key={ids[i]} id={ids[i]} className="section-content-item">
          <DragHandle className="drag-handle small">⋮</DragHandle>
          <input
            type="text" className="form-input"
            data-field={`sections[${sectionIndex}].content[${i}]`}
            defaultValue={item}
            onChange={(e) => writeField(`sections[${sectionIndex}].content[${i}]`, e.target.value)}
          />
          <button className="item-delete-btn small" title="Delete"
            onClick={() => store.removeFromArray(`sections[${sectionIndex}].content`, i)}>×</button>
        </SortableItem>
      ))}
      <button className="add-item-btn" onClick={() => store.addToArray(`sections[${sectionIndex}].content`, 'New item')}>
        + Add item
      </button>
    </SortableList>
  );
}

function SectionItem({ section, index }) {
  const type = section?.type === 'skills' ? 'skills' : 'list';
  return (
    <SortableItem id={section.id || `section-${index}`} className="sortable-item section-item">
      <DragHandle />
      <div className="section-item-content">
        <input
          type="text" className="form-input section-title-input"
          data-field={`sections[${index}].title`}
          defaultValue={section.title}
          onChange={(e) => writeField(`sections[${index}].title`, e.target.value)}
        />
        <div className="section-mode-control">
          <span className="section-mode-label">Display</span>
          <div className="section-mode-options">
            {[['list', 'Bulleted'], ['skills', 'Inline Tags']].map(([t, label]) => (
              <button key={t} type="button"
                className={`section-mode-btn ${type === t ? 'active' : ''}`}
                onClick={() => writeField(`sections[${index}].type`, t)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <SectionContentList sectionIndex={index} content={section.content || []} />
      </div>
      <button className="item-delete-btn" title="Delete section"
        onClick={() => { if (confirm('Delete this section?')) store.removeFromArray('sections', index); }}>×</button>
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
  const bulletIds = (exp.bullets || []).map((_, i) => `b-${index}-${i}`);
  return (
    <SortableItem id={exp.id || `exp-${index}`} className="accordion-item">
      <div className="accordion-header" onClick={toggle}>
        <DragHandle />
        <span className="accordion-title">{exp.title || 'Untitled Position'}</span>
        <span className="accordion-subtitle">{exp.company || ''}</span>
        <ChevronDown className={`accordion-chevron ${expanded ? 'expanded' : ''}`} size={16} />
      </div>
      <div className={`accordion-content ${expanded ? 'expanded' : ''}`}>
        {[['title', 'Job Title'], ['company', 'Company'], ['dates', 'Dates']].map(([f, label]) => (
          <div className="form-group" key={f}>
            <label>{label}</label>
            <input type="text" className="form-input"
              data-field={`experience[${index}].${f}`}
              defaultValue={exp[f] || ''}
              onChange={(e) => writeField(`experience[${index}].${f}`, e.target.value)} />
          </div>
        ))}
        <div className="form-group">
          <label>Bullets</label>
          <SortableList className="bullet-list" ids={bulletIds}
            onReorder={(from, to) => store.moveInArray(`experience[${index}].bullets`, from, to)}>
            {(exp.bullets || []).map((bullet, i) => (
              <SortableItem key={bulletIds[i]} id={bulletIds[i]} className="bullet-item">
                <DragHandle className="drag-handle small">⋮</DragHandle>
                <span className="bullet-marker">•</span>
                <input type="text" className="form-input"
                  data-field={`experience[${index}].bullets[${i}]`}
                  defaultValue={bullet}
                  onChange={(e) => writeField(`experience[${index}].bullets[${i}]`, e.target.value)} />
                <button className="item-delete-btn small" title="Delete"
                  onClick={() => store.removeFromArray(`experience[${index}].bullets`, i)}>×</button>
              </SortableItem>
            ))}
            <button className="add-item-btn" onClick={() => store.addToArray(`experience[${index}].bullets`, 'New bullet point')}>+ Add bullet</button>
          </SortableList>
        </div>
        <div className="accordion-actions">
          <button className="btn-danger-small"
            onClick={() => { if (confirm('Delete this experience entry?')) store.removeFromArray('experience', index); }}>
            Delete Experience
          </button>
        </div>
      </div>
    </SortableItem>
  );
}

const AddIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);

// ------------------------------ main component -------------------------------

export default function StructurePanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('header');
  const [dataVersion, bump] = useReducer((n) => n + 1, 0);
  const [collapsed, setCollapsed] = useState({});
  const [renameOpen, setRenameOpen] = useState(false); // "Custom Section…" title dialog
  const [customTitle, setCustomTitle] = useState('');
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
    if (!field?.matches?.('.form-input, .form-textarea')) return;
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
      {/* Tab selector */}
      <div className="panel-section-selector">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="panel-section-dropdown" type="button">
              <span className="dropdown-icon">{TAB_OPTIONS[tab].icon}</span>
              <span className="dropdown-label">{TAB_OPTIONS[tab].label}</span>
              <ChevronDown className="dropdown-chevron" size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {Object.entries(TAB_OPTIONS).map(([key, opt]) => (
              <DropdownMenuItem key={key} onSelect={() => { scrollPos.current = 0; setTab(key); }}>
                <span className="dropdown-icon">{opt.icon}</span>
                <span className="flex-1">{opt.label}</span>
                {tab === key && <Check className="size-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Bold formatting toolbar */}
      <div className="panel-text-toolbar">
        <button className="panel-text-btn" type="button" title="Bold (Cmd/Ctrl+B)"
          onMouseDown={(e) => e.preventDefault()} onClick={handleBold}>
          <strong>B</strong>
        </button>
        <span className="panel-text-hint">Format selected text</span>
      </div>

      {/* Tab content — keyed so content tabs remount on data change; design tab stays put */}
      <div
        className="panel-tab-content"
        ref={tabContentRef}
        onScroll={(e) => { scrollPos.current = e.currentTarget.scrollTop; }}
        key={tab === 'design' ? 'design' : `${tab}-${dataVersion}`}
      >
        {tab === 'header' && (
          <>
            <PanelSection title="Name & Title" {...sectionProps('name-title')}>
              <div className="form-group"><label>Name</label>
                <input type="text" className="form-input" data-field="name" defaultValue={data.name || ''} onChange={(e) => writeField('name', e.target.value)} /></div>
              <div className="form-group"><label>Professional Title</label>
                <input type="text" className="form-input" data-field="tagline" defaultValue={data.tagline || ''} onChange={(e) => writeField('tagline', e.target.value)} /></div>
            </PanelSection>
            <PanelSection title="Contact Information" {...sectionProps('contact-info')}>
              {[['location', 'Location', 'text'], ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'], ['portfolio', 'Portfolio URL', 'text'], ['instagram', 'Instagram', 'text']].map(([f, label, type]) => (
                <div className="form-group" key={f}><label>{label}</label>
                  <input type={type} className="form-input" data-field={`contact.${f}`} defaultValue={data.contact?.[f] || ''} onChange={(e) => writeField(`contact.${f}`, e.target.value)} /></div>
              ))}
            </PanelSection>
          </>
        )}

        {tab === 'sidebar' && (
          <>
            <PanelSection title="Sidebar Sections" {...sectionProps('sidebar-sections')} headerExtra={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="panel-add-btn" type="button" title="Add section"><AddIcon /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {Object.entries(SECTION_TEMPLATES).map(([key, t]) => (
                    <DropdownMenuItem key={key} onSelect={() => addSection(key)}>{t.title}</DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onSelect={() => { setCustomTitle(''); setRenameOpen(true); }}>Custom Section…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }>
              <SortableList className="sortable-list" ids={sections.map((s, i) => s.id || `section-${i}`)}
                onReorder={(from, to) => store.moveInArray('sections', from, to)}>
                {sections.map((section, i) => <SectionItem key={section.id || `section-${i}`} section={section} index={i} />)}
              </SortableList>
            </PanelSection>

            <PanelSection title="Tools" {...sectionProps('tools')}>
              <SortableList className="sortable-list" ids={tools.map((_, i) => `tool-${i}`)}
                onReorder={(from, to) => {
                  const items = normalizeTools(store.get('tools'));
                  const [moved] = items.splice(from, 1);
                  items.splice(to, 0, moved);
                  writeField('tools', serializeTools(items));
                  bump();
                }}>
                {tools.map((tool, i) => (
                  <SortableItem key={`tool-${i}`} id={`tool-${i}`} className="sortable-item tool-item">
                    <DragHandle />
                    <input type="text" className="form-input flex-grow" placeholder="Tool name"
                      defaultValue={tool} onChange={(e) => writeTool(i, e.target.value)} />
                    <button className="item-delete-btn" title="Delete"
                      onClick={() => { const items = normalizeTools(store.get('tools')); items.splice(i, 1); writeField('tools', serializeTools(items)); bump(); }}>×</button>
                  </SortableItem>
                ))}
                <button className="add-item-btn" onClick={() => { const items = normalizeTools(store.get('tools')); items.push('New tool'); writeField('tools', serializeTools(items)); bump(); }}>+ Add tool</button>
              </SortableList>
            </PanelSection>
          </>
        )}

        {tab === 'main' && (
          <>
            <PanelSection title="Summary" {...sectionProps('summary')}>
              <div className="form-group">
                <textarea className="form-textarea" data-field="summary" rows={4} placeholder="A brief professional summary..."
                  defaultValue={data.summary || ''} onChange={(e) => writeField('summary', e.target.value)} />
              </div>
            </PanelSection>

            <PanelSection title="Experience" {...sectionProps('experience')} headerExtra={
              <button className="panel-add-btn" type="button" title="Add experience"
                onClick={() => store.addToArray('experience', { id: generateId('exp'), title: 'New Position', company: 'Company Name', dates: 'Start – End', bullets: ['Describe your accomplishments'], _expanded: true })}><AddIcon /></button>
            }>
              {experience.length > 1 && (
                <div className="experience-sort-bar">
                  <span className="experience-sort-label">Sort by</span>
                  <button className="experience-sort-btn" type="button" title="Sort by date (most recent first)" onClick={() => sortExperience('date')}>Date</button>
                  <button className="experience-sort-btn" type="button" title="Sort by relevance to the target role" onClick={() => sortExperience('relevance')}>Relevance</button>
                </div>
              )}
              <SortableList className="accordion-list" ids={experience.map((e, i) => e.id || `exp-${i}`)}
                onReorder={(from, to) => store.moveInArray('experience', from, to)}>
                {experience.map((exp, i) => <ExperienceItem key={exp.id || `exp-${i}`} exp={exp} index={i} />)}
              </SortableList>
            </PanelSection>

            <PanelSection title="Education" {...sectionProps('education')} headerExtra={
              <button className="panel-add-btn" type="button" title="Add education"
                onClick={() => store.addToArray('education', 'Degree — Institution — Dates')}><AddIcon /></button>
            }>
              <SortableList className="sortable-list" ids={education.map((_, i) => `edu-${i}`)}
                onReorder={(from, to) => store.moveInArray('education', from, to)}>
                {education.map((edu, i) => (
                  <SortableItem key={`edu-${i}`} id={`edu-${i}`} className="sortable-item">
                    <DragHandle />
                    <input type="text" className="form-input flex-grow" data-field={`education[${i}]`}
                      defaultValue={edu} onChange={(e) => writeField(`education[${i}]`, e.target.value)} />
                    <button className="item-delete-btn" title="Delete" onClick={() => store.removeFromArray('education', i)}>×</button>
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
