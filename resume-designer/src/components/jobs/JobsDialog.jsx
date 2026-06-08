import { useState, useEffect, useRef, useReducer, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  initJobDescriptions, getAllJobDescriptions, getActiveJobDescriptions,
  addJobDescription, updateJobDescription, deleteJobDescription, toggleJobDescriptionActive,
  parseJobDescriptionText, exportJobDescriptions, importJobDescriptions,
} from '../../jobDescriptions.js';
import {
  analyzeAgainstJobs, generateResumeChanges, getConfiguredProviders,
  getAllModels, isConfigured, validateModelId,
} from '../../aiService.js';
import { getSettings, saveVariantAnalysis, getVariantAnalysis } from '../../persistence.js';
import { createChangeSet } from '../../diffEngine.js';
import { showDiffView } from '../../diffView.js';
import { store } from '../../store.js';
import { getCurrentId } from '../../variantManager.js';
import { applyRecommendationToStore } from '../../jobRecommendations.js';
import { JobCard } from './JobCard.jsx';
import { AnalysisResults } from './AnalysisResults.jsx';
import { JobSelectionDialog } from './JobSelectionDialog.jsx';
import { JobEditDialog } from './JobEditDialog.jsx';

const RECENT_JD_LIMIT = 5;
const FALLBACK_MODEL = 'anthropic/claude-sonnet-4.5';

function getDisplayed(jobs, recentOnly) {
  if (!recentOnly || jobs.length <= RECENT_JD_LIMIT) return jobs;
  return [...jobs].sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded)).slice(0, RECENT_JD_LIMIT);
}

function getAvailableModels() {
  if (!isConfigured()) return [];
  const grouped = getAllModels();
  const available = [];
  for (const models of Object.values(grouped)) {
    for (const m of models) available.push({ id: m.id, label: m.label, provider: m.group });
  }
  return available;
}

// Full-screen analysis loading overlay (portaled to body), with the 3-step
// animation cycling while a request is in flight.
function AnalysisLoadingOverlay() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 3), 2000);
    return () => clearInterval(id);
  }, []);
  const steps = [
    'Extracting keywords from job description',
    'Matching skills and experience',
    'Generating recommendations',
  ];
  return createPortal(
    <div className="jd-analysis-loading-overlay show">
      <div className="jd-analysis-loading-content">
        <div className="jd-analysis-spinner">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
            </path>
          </svg>
        </div>
        <div className="jd-analysis-loading-text">
          <span className="jd-loading-title">Analyzing Resume Fit</span>
          <span className="jd-loading-subtitle">Comparing your resume against job requirements...</span>
        </div>
        <div className="jd-loading-steps">
          {steps.map((text, i) => (
            <div key={text} className={cn('jd-loading-step', i <= step && 'active')}>
              <span className="jd-step-dot" />
              <span>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Target Job Descriptions panel — the React port of jobDescriptionPanel.js.
 * A shadcn Dialog (always mounted so the rd:open-jobs / rd:jobs-variant-change
 * listeners persist) hosting the add form, the JD list, and AI analysis. Job
 * data lives in jobDescriptions.js (re-read after each CRUD via a bump);
 * analysis is persisted per-variant. The selection + edit sub-modals and the
 * results view are separate components; applying a recommendation routes through
 * jobRecommendations.applyRecommendationToStore.
 */
export default function JobsDialog() {
  const [open, setOpen] = useState(false);
  const [, bump] = useReducer((x) => x + 1, 0);
  const [analysisResults, setAnalysisResults] = useState(null);
  const [appliedIndexes, setAppliedIndexes] = useState(() => new Set());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [showRecentOnly, setShowRecentOnly] = useState(true);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [editingJd, setEditingJd] = useState(null);
  const collapseInit = useRef(false);

  const titleRef = useRef(null);
  const companyRef = useRef(null);
  const descRef = useRef(null);

  const jobs = getAllJobDescriptions();
  const activeJDs = getActiveJobDescriptions();
  const displayed = getDisplayed(jobs, showRecentOnly);
  const configured = getConfiguredProviders().length > 0;

  const reloadAnalysis = useCallback(() => {
    const id = getCurrentId();
    setAnalysisResults(id ? getVariantAnalysis(id) : null);
    setAppliedIndexes(new Set());
  }, []);

  useEffect(() => { initJobDescriptions(); }, []);

  useEffect(() => {
    const onOpen = () => { reloadAnalysis(); setOpen(true); };
    const onVariant = () => reloadAnalysis();
    window.addEventListener('rd:open-jobs', onOpen);
    window.addEventListener('rd:jobs-variant-change', onVariant);
    return () => {
      window.removeEventListener('rd:open-jobs', onOpen);
      window.removeEventListener('rd:jobs-variant-change', onVariant);
    };
  }, [reloadAnalysis]);

  // Collapse all cards by default on first render that has jobs.
  useEffect(() => {
    if (!collapseInit.current && jobs.length > 0) {
      setCollapsedIds(new Set(jobs.map((j) => j.id)));
      collapseInit.current = true;
    }
  }, [jobs]);

  const handleAdd = () => {
    const description = descRef.current?.value.trim();
    if (!description) { window.alert('Please enter a job description'); return; }
    addJobDescription({
      title: titleRef.current?.value.trim() || 'Untitled Position',
      company: companyRef.current?.value.trim() || 'Unknown Company',
      description,
    });
    if (titleRef.current) titleRef.current.value = '';
    if (companyRef.current) companyRef.current.value = '';
    if (descRef.current) descRef.current.value = '';
    bump();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const parsed = parseJobDescriptionText(text);
        if (titleRef.current) titleRef.current.value = parsed.title;
        if (companyRef.current) companyRef.current.value = parsed.company;
        if (descRef.current) descRef.current.value = parsed.description;
      }
    } catch (e) {
      console.error('Failed to read clipboard:', e);
      window.alert('Could not read from clipboard. Please paste manually.');
    }
  };

  const toggleCollapse = (id) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const collapseAll = () => setCollapsedIds(new Set(jobs.map((j) => j.id)));
  const expandAll = () => setCollapsedIds(new Set());

  const toggleActive = (id) => { toggleJobDescriptionActive(id); bump(); };
  const removeJob = (id) => { if (window.confirm('Delete this job description?')) { deleteJobDescription(id); bump(); } };
  const saveEdit = (fields) => { if (editingJd) { updateJobDescription(editingJd.id, fields); setEditingJd(null); bump(); } };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const count = importJobDescriptions(await file.text());
        window.alert(`Imported ${count} job description(s)`);
        bump();
      } catch (err) {
        window.alert(`Failed to import: ${err.message}`);
      }
    };
    input.click();
  };

  const handleExport = () => {
    const blob = new Blob([exportJobDescriptions()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'job-descriptions.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const runAnalysis = async (selectedJobs, modelId, reasoningEffort) => {
    const model = modelId || getSettings().defaultModel || FALLBACK_MODEL;
    setIsAnalyzing(true);
    setAppliedIndexes(new Set());
    try {
      const results = await analyzeAgainstJobs(model, selectedJobs, { reasoningEffort: reasoningEffort || 'medium' });
      const id = getCurrentId();
      if (id && results) saveVariantAnalysis(id, results);
      setAnalysisResults(results);
    } catch (error) {
      window.alert(`Analysis failed: ${error.message}`);
      setAnalysisResults(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleTailor = async () => {
    if (activeJDs.length === 0) { window.alert('Please activate at least one job description'); return; }
    const modelId = getSettings().defaultModel || FALLBACK_MODEL;
    try {
      const result = await generateResumeChanges(
        modelId,
        'Tailor my entire resume for these target jobs. Optimize keywords, adjust the summary, and highlight relevant experience.',
        null,
        { jobDescriptions: activeJDs }
      );
      if (result.changes && Object.keys(result.changes).length > 0) {
        const changeSet = createChangeSet(store.getData(), result.changes);
        setOpen(false);
        showDiffView(changeSet);
      } else {
        window.alert('No changes suggested. Your resume may already be well-tailored!');
      }
    } catch (error) {
      window.alert(`Failed to generate changes: ${error.message}`);
    }
  };

  const applyRec = (index) => {
    const rec = analysisResults?.recommendations?.[index];
    if (!rec || appliedIndexes.has(index)) return;
    const ok = applyRecommendationToStore(rec.section?.toLowerCase().trim(), rec.current, rec.suggested);
    if (ok) {
      setAppliedIndexes((prev) => new Set(prev).add(index));
    } else {
      window.alert(`Could not automatically apply this recommendation to "${rec.section}". Please make this change manually in the resume editor.`);
    }
  };

  const defaultModelId = validateModelId(getSettings().defaultModel) || FALLBACK_MODEL;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[85vh] w-[90vw] max-w-[680px] flex-col gap-0 overflow-hidden p-0 glass-card"
        >
          <DialogTitle className="sr-only">Target Job Descriptions</DialogTitle>
          <DialogDescription className="sr-only">Manage job descriptions and analyze resume fit</DialogDescription>

          <div className="jd-panel-header">
            <h2>Target Job Descriptions</h2>
            <button className="jd-panel-close" type="button" onClick={() => setOpen(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="jd-panel-content">
            <div className="jd-panel-section">
              <div className="jd-section-header"><h3>Add New Job Description</h3></div>
              <div className="jd-add-form">
                <input type="text" ref={titleRef} className="jd-input" placeholder="Job Title (e.g., Senior Designer)" />
                <input type="text" ref={companyRef} className="jd-input" placeholder="Company Name" />
                <textarea ref={descRef} className="jd-textarea" placeholder="Paste the full job description here..." rows="6" />
                <div className="jd-form-actions">
                  <button className="btn btn-secondary jd-paste-btn" type="button" onClick={handlePaste}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Paste from Clipboard
                  </button>
                  <button className="btn btn-primary" type="button" onClick={handleAdd}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Add Job Description
                  </button>
                </div>
              </div>
            </div>

            <div className="jd-panel-section">
              <div className="jd-section-header">
                <h3>
                  Your Job Descriptions
                  {jobs.length > 0 ? ` (${displayed.length}${showRecentOnly && jobs.length > RECENT_JD_LIMIT ? ` of ${jobs.length}` : ''})` : ''}
                </h3>
                <div className="jd-section-actions">
                  {jobs.length > 1 && (
                    <>
                      <button className="jd-icon-btn" type="button" title="Collapse All" onClick={collapseAll}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                      </button>
                      <button className="jd-icon-btn" type="button" title="Expand All" onClick={expandAll}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                      </button>
                    </>
                  )}
                  <button className="jd-icon-btn" type="button" title="Import from JSON" onClick={handleImport}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                  </button>
                  <button className="jd-icon-btn" type="button" title="Export to JSON" onClick={handleExport}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  </button>
                </div>
              </div>

              {jobs.length > 0 && (
                <div className="jd-filter-bar">
                  <span className="jd-filter-label">Show:</span>
                  <div className="jd-filter-toggle">
                    <button className={cn('jd-filter-option', showRecentOnly && 'active')} type="button" onClick={() => setShowRecentOnly(true)}>
                      Recent ({Math.min(jobs.length, RECENT_JD_LIMIT)})
                    </button>
                    <button className={cn('jd-filter-option', !showRecentOnly && 'active')} type="button" onClick={() => setShowRecentOnly(false)}>
                      All ({jobs.length})
                    </button>
                  </div>
                </div>
              )}

              <div className="jd-list">
                {jobs.length === 0 ? (
                  <div className="jd-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="12" y2="17" /></svg>
                    <p>No job descriptions added yet</p>
                    <span>Add target jobs to analyze your resume fit</span>
                  </div>
                ) : (
                  displayed.map((jd) => (
                    <JobCard
                      key={jd.id}
                      jd={jd}
                      collapsed={collapsedIds.has(jd.id)}
                      onToggleCollapse={() => toggleCollapse(jd.id)}
                      onToggleActive={() => toggleActive(jd.id)}
                      onEdit={() => setEditingJd(jd)}
                      onDelete={() => removeJob(jd.id)}
                    />
                  ))
                )}
              </div>
            </div>

            {jobs.length > 0 && (
              <div className="jd-panel-section jd-analysis-section">
                <div className="jd-section-header"><h3>Resume Analysis</h3></div>
                <div className="jd-analysis-actions">
                  <button className="btn btn-primary jd-analyze-btn" type="button" disabled={!configured} onClick={() => setSelectionOpen(true)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                    {isAnalyzing ? 'Analyzing...' : 'Analyze Resume Fit'}
                  </button>
                  <button className="btn btn-secondary jd-tailor-btn" type="button" disabled={!configured || activeJDs.length === 0} onClick={handleTailor}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                    Tailor Resume
                  </button>
                </div>
                {!configured && <p className="jd-warning">Configure an API key in settings to use AI analysis.</p>}
                <div className="jd-analysis-results">
                  <AnalysisResults results={analysisResults} appliedIndexes={appliedIndexes} onApply={applyRec} />
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <JobSelectionDialog
        open={selectionOpen}
        onOpenChange={setSelectionOpen}
        jobs={jobs}
        models={getAvailableModels()}
        defaultModelId={defaultModelId}
        onConfirm={runAnalysis}
      />
      <JobEditDialog
        open={!!editingJd}
        onOpenChange={(next) => { if (!next) setEditingJd(null); }}
        jd={editingJd}
        onSave={saveEdit}
      />
      {isAnalyzing && <AnalysisLoadingOverlay />}
    </>
  );
}
