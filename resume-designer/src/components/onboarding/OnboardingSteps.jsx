import { useState, useEffect, useRef } from 'react';

/**
 * Presentational step components for the onboarding wizard.
 *
 * Each component is a pure view: it returns a Fragment whose two direct children
 * are <div className="onboarding-content"> and <div className="onboarding-footer">,
 * so they slot directly into the wizard's flex column (.onboarding-wizard) and
 * reuse styles/onboarding.css verbatim. All data and actions arrive via props —
 * these components import nothing from the app (store/persistence/aiService live
 * in OnboardingWizard.jsx and onboardingLogic.js). Markup is a 1:1 translation of
 * the original vanilla onboarding.js render functions.
 */

// --- Step 0: API key ------------------------------------------------------

export function ApiKeyStep({ defaultKey, hasProviders, onValidate, goTo }) {
  const [key, setKey] = useState(defaultKey);
  const [status, setStatus] = useState(null); // null | { message, success }
  const [inputStatus, setInputStatus] = useState(''); // '' | '…' | '✓' | '✗'
  const [groupClass, setGroupClass] = useState(''); // '' | 'validated' | 'invalid'
  const [validating, setValidating] = useState(false);

  const handleContinue = async () => {
    const k = key.trim();
    if (!k) {
      setStatus({ message: 'Enter your OpenRouter API key to use AI features.', success: false });
      return;
    }
    setValidating(true);
    setInputStatus('…');
    setGroupClass('');

    const valid = await onValidate(k);
    setInputStatus(valid ? '✓' : '✗');
    setGroupClass(valid ? 'validated' : 'invalid');
    setStatus(valid
      ? { message: 'API key validated! AI features are ready to use.', success: true }
      : { message: 'Could not validate your key. We saved it — you can re-check it later in Settings.', success: false });

    setTimeout(() => goTo(1), valid ? 1000 : 1200);
  };

  return (
    <>
      <div className="onboarding-content">
        <div className="onboarding-step api-key-step">
          <div className="welcome-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          </div>
          <h1>Welcome to Resume Designer</h1>
          <p className="step-description">This app uses AI to help you create professional resumes. Enter your OpenRouter API key to get started.</p>

          <div className="api-config-panel" id="api-config-panel">
            <div className={`api-input-group ${groupClass}`.trim()} id="openrouter-group">
              <label htmlFor="api-openrouter">
                <span className="provider-name">OpenRouter</span>
                <span className="provider-hint">One key for Claude, GPT, Gemini &amp; 300+ models</span>
              </label>
              <div className="api-input-wrapper">
                <input
                  type="password"
                  id="api-openrouter"
                  placeholder="sk-or-v1-..."
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                <span
                  className={`api-input-status ${inputStatus === '✓' ? 'valid' : inputStatus === '✗' ? 'invalid' : ''}`.trim()}
                  id="openrouter-status"
                >
                  {inputStatus}
                </span>
              </div>
              <span className="provider-hint">Get a key at openrouter.ai/keys</span>
            </div>
            {status && (
              <div className={`api-key-status ${status.success ? 'success' : 'error'}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {status.success ? (
                    <>
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </>
                  ) : (
                    <>
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </>
                  )}
                </svg>
                <span>{status.message}</span>
              </div>
            )}
          </div>

          <p className="api-privacy-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Your API key is stored locally on your device and is sent only to OpenRouter to make AI requests.
          </p>
        </div>
      </div>
      <div className="onboarding-footer">
        <button
          className="btn btn-primary btn-lg"
          id="validate-and-continue"
          disabled={validating}
          onClick={handleContinue}
        >
          {validating ? 'Validating…' : (hasProviders ? 'Continue' : 'Validate & Continue')}
        </button>
      </div>
    </>
  );
}

// --- Step 1: Choose path --------------------------------------------------

export function ChoosePathStep({ isNewResumeMode, onChoose, onBack }) {
  return (
    <>
      <div className="onboarding-content">
        <div className="onboarding-step choose-path-step">
          <div className="welcome-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="9" x2="15" y2="9" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="12" y2="17" />
            </svg>
          </div>
          <h1>How would you like to start?</h1>
          <p className="step-description">Choose how you&apos;d like to create your AI-powered resume.</p>

          <div className="welcome-options">
            <button className="welcome-option" id="option-import" onClick={() => onChoose('import')}>
              <div className="option-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="option-text">
                <h3>Import Existing Resume</h3>
                <p>Upload a PDF or paste text — AI will parse and structure your content automatically</p>
              </div>
              <div className="option-badge ai-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                AI-Powered
              </div>
            </button>

            <button className="welcome-option" id="option-new" onClick={() => onChoose('new')}>
              <div className="option-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <div className="option-text">
                <h3>Start Fresh</h3>
                <p>Answer a few questions and AI will help you craft professional content</p>
              </div>
              <div className="option-badge ai-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                AI-Powered
              </div>
            </button>

            <button className="welcome-option welcome-option-featured" id="option-job" onClick={() => onChoose('job')}>
              <div className="option-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="3" />
                  <line x1="12" y1="2" x2="12" y2="5" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="5" y2="12" />
                  <line x1="19" y1="12" x2="22" y2="12" />
                </svg>
              </div>
              <div className="option-text">
                <h3>Create for Job</h3>
                <p>Generate a tailored resume from your profile, optimized for a specific job posting</p>
              </div>
              <div className="option-badge ai-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                AI-Powered
              </div>
            </button>
          </div>
        </div>
      </div>
      {isNewResumeMode ? (
        <div className="onboarding-footer" />
      ) : (
        <div className="onboarding-footer">
          <button className="btn btn-secondary" id="back-btn" onClick={onBack}>Back</button>
        </div>
      )}
    </>
  );
}

// --- Step 2 (import mode): Import ------------------------------------------

export function ImportStep({ initialText, onParse, onFile, onBack }) {
  const [text, setText] = useState(initialText);
  const [method, setMethod] = useState('paste'); // 'paste' | 'file'
  const [extracting, setExtracting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = async (file) => {
    setExtracting(true);
    try {
      await onFile(file);
    } catch (e) {
      alert('Failed to read file: ' + e.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleParse = async () => {
    const t = text.trim();
    if (!t) {
      alert('Please paste or upload your resume content');
      return;
    }
    setParsing(true);
    try {
      await onParse(t);
    } catch (e) {
      alert('Failed to parse resume: ' + e.message);
      setParsing(false);
    }
  };

  return (
    <>
      <div className="onboarding-content">
        <div className="onboarding-step import-step">
          <h2>Import Your Resume</h2>
          <p>Paste your existing resume text below, or upload a file.</p>

          <div className="import-methods">
            <button
              className={`import-method${method === 'paste' ? ' active' : ''}`}
              data-method="paste"
              onClick={() => setMethod('paste')}
            >
              Paste Text
            </button>
            <button
              className={`import-method${method === 'file' ? ' active' : ''}`}
              data-method="file"
              onClick={() => setMethod('file')}
            >
              Upload File
            </button>
          </div>

          <div className={`import-area${method !== 'paste' ? ' hidden' : ''}`} id="import-paste-area">
            <textarea
              id="import-textarea"
              className="import-textarea"
              placeholder="Paste your resume text here..."
              rows="15"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          <div className={`import-area${method !== 'file' ? ' hidden' : ''}`} id="import-file-area">
            <div
              className={`file-drop-zone${dragOver ? ' drag-over' : ''}`}
              id="file-drop-zone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) await handleFile(file);
              }}
            >
              {extracting ? (
                <div className="file-loading">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="spinner">
                    <circle cx="12" cy="12" r="10" opacity="0.3" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  <p>Extracting text...</p>
                </div>
              ) : (
                <>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <p>Drop file here or click to browse</p>
                  <span>Supports TXT, PDF, DOCX</span>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                id="file-input"
                accept=".txt,.pdf,.docx"
                hidden
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (file) await handleFile(file);
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="onboarding-footer">
        <button className="btn btn-secondary" id="back-btn" onClick={onBack}>Back</button>
        <button className="btn btn-primary" id="next-btn" disabled={parsing} onClick={handleParse}>
          {parsing ? 'Parsing with AI...' : 'Parse Resume'}
        </button>
      </div>
    </>
  );
}

// --- Step 2 (import mode, file preview): File preview ----------------------

export function FilePreviewStep({ previewText, onBack, onContinue }) {
  const [busy, setBusy] = useState(false);

  const handleContinue = async () => {
    setBusy(true);
    try {
      await onContinue(previewText);
    } catch (e) {
      alert('Failed to parse resume: ' + e.message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="onboarding-content">
        <div className="onboarding-step import-step">
          <h2>Review Extracted Text</h2>
          <p>We&apos;ve extracted the following text from your file. Please review before continuing.</p>

          <div className="file-preview-container">
            <div className="file-preview-text">{previewText}</div>
          </div>

          <div className="file-preview-hint">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>If the text doesn&apos;t look right, try uploading a different file or paste the text manually.</span>
          </div>
        </div>
      </div>
      <div className="onboarding-footer">
        <button className="btn btn-secondary" id="back-btn" onClick={onBack}>Try Again</button>
        <button className="btn btn-primary" id="next-btn" disabled={busy} onClick={handleContinue}>
          {busy ? 'Parsing with AI...' : 'Continue'}
        </button>
      </div>
    </>
  );
}

// --- Step 2 (new mode): Interview -----------------------------------------

export function InterviewStep({
  question,
  questionIndex,
  totalQuestions,
  initialValue,
  hasProviders,
  onImprove,
  onBack,
  onNext,
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef(null);

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(id);
  }, []);

  const handleImprove = async () => {
    const v = value.trim();
    if (!v) {
      alert('Please enter some text first');
      return;
    }
    try {
      const improved = await onImprove(question.question, v);
      setValue(improved);
    } catch (e) {
      alert('AI assistance failed: ' + e.message);
    }
  };

  const handleNext = () => {
    const v = value.trim();
    if (!v && question.id !== 'summary') {
      alert('Please provide an answer');
      return;
    }
    onNext(v);
  };

  return (
    <>
      <div className="onboarding-content">
        <div className="onboarding-step interview-step">
          <div className="interview-progress">
            <span>Question {questionIndex + 1} of {totalQuestions}</span>
            <div className="interview-dots">
              {Array.from({ length: totalQuestions }, (_, i) => (
                <span
                  key={i}
                  className={`dot ${i < questionIndex ? 'completed' : i === questionIndex ? 'active' : ''}`}
                />
              ))}
            </div>
          </div>

          <h2>{question.question}</h2>

          {question.type === 'textarea' ? (
            <textarea
              ref={inputRef}
              id="interview-input"
              className="interview-textarea"
              placeholder="Type your answer..."
              rows="6"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <input
              ref={inputRef}
              type="text"
              id="interview-input"
              className="interview-input"
              placeholder="Type your answer..."
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}

          {question.aiAssist && hasProviders && (
            <button className="ai-assist-btn" id="ai-assist-btn" onClick={handleImprove}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              Help me improve this with AI
            </button>
          )}
        </div>
      </div>
      <div className="onboarding-footer">
        <button className="btn btn-secondary" id="back-btn" onClick={onBack}>
          {questionIndex === 0 ? 'Back' : 'Previous'}
        </button>
        <button className="btn btn-primary" id="next-btn" onClick={handleNext}>
          {questionIndex === totalQuestions - 1 ? 'Continue' : 'Next'}
        </button>
      </div>
    </>
  );
}

// --- Step 2 (job mode): Job input -----------------------------------------

export function JobInputStep({
  hasProfileData,
  targetJob,
  availableModels,
  defaultModel,
  defaultReasoning,
  modelSupportsReasoning,
  fetchModelCatalog,
  onGenerate,
  onBack,
  onOpenProfile,
}) {
  const [title, setTitle] = useState(targetJob?.title || '');
  const [company, setCompany] = useState(targetJob?.company || '');
  const [description, setDescription] = useState(targetJob?.description || '');
  const [model, setModel] = useState(defaultModel);
  const [reasoning, setReasoning] = useState(defaultReasoning);
  const [generating, setGenerating] = useState(false);
  const [tick, setTick] = useState(0);

  // Re-evaluate reasoning support after the catalog loads (tick bump).
  void tick;
  const reasoningSupported = modelSupportsReasoning(model);

  useEffect(() => {
    fetchModelCatalog().then(() => setTick((t) => t + 1)).catch(() => {});
  }, [fetchModelCatalog]);

  if (!hasProfileData) {
    return (
      <>
        <div className="onboarding-content">
          <div className="onboarding-step job-input-step">
            <div className="profile-warning">
              <div className="warning-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <h2>Profile Needed</h2>
              <p className="warning-description">
                To create a tailored resume from a job description, we need your background information.
                Please fill out your profile first with your work experience, skills, and education.
              </p>
              <div className="warning-actions">
                <button className="btn btn-primary" id="open-profile-btn" onClick={onOpenProfile}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Open My Profile
                </button>
              </div>
              <p className="warning-hint">
                After filling out your profile, come back here to create a tailored resume.
              </p>
            </div>
          </div>
        </div>
        <div className="onboarding-footer">
          <button
            className="btn btn-secondary"
            id="back-btn"
            onClick={() => onBack(targetJob || { title: '', company: '', description: '' })}
          >
            Back
          </button>
        </div>
      </>
    );
  }

  const handlePaste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setDescription(t);
    } catch (err) {
      console.error('Failed to read clipboard:', err);
      alert('Unable to access clipboard. Please paste manually using Ctrl+V / Cmd+V.');
    }
  };

  const handleGenerate = async () => {
    const d = description.trim();
    if (!d) {
      alert('Please paste a job description');
      return;
    }
    setGenerating(true);
    try {
      await onGenerate({ title: title.trim(), company: company.trim(), description: d, model, reasoning });
    } catch (e) {
      alert('Failed to generate resume: ' + e.message);
      setGenerating(false);
    }
  };

  return (
    <>
      <div className="onboarding-content">
        <div className="onboarding-step job-input-step">
          <div className="step-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" />
              <line x1="12" y1="2" x2="12" y2="5" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" />
              <line x1="19" y1="12" x2="22" y2="12" />
            </svg>
          </div>
          <h2>Target Job Details</h2>
          <p className="step-description">
            Paste the job description below. AI will analyze it and create a resume from your profile
            that&apos;s perfectly tailored for this role.
          </p>

          <div className="job-input-form">
            <div className="input-row">
              <div className="input-group">
                <label htmlFor="job-title-input">Job Title</label>
                <input
                  type="text"
                  id="job-title-input"
                  className="job-input"
                  placeholder="e.g. Senior Software Engineer"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label htmlFor="job-company-input">Company</label>
                <input
                  type="text"
                  id="job-company-input"
                  className="job-input"
                  placeholder="e.g. Google"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="job-desc-input">Job Description</label>
              <textarea
                id="job-desc-input"
                className="job-textarea"
                placeholder="Paste the full job description here..."
                rows="10"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <button className="paste-clipboard-btn" id="paste-clipboard-btn" onClick={handlePaste}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Paste from Clipboard
            </button>

            <div className="job-ai-options">
              <div className="job-model-selector">
                <label htmlFor="job-model-select">Model</label>
                <select
                  id="job-model-select"
                  className="job-model-select"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {availableModels.map((m, i) => (
                    <option key={i} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div className="job-reasoning-selector">
                <label htmlFor="job-reasoning-select">Reasoning</label>
                <select
                  id="job-reasoning-select"
                  className="job-reasoning-select"
                  value={reasoning}
                  disabled={!reasoningSupported}
                  onChange={(e) => setReasoning(e.target.value)}
                >
                  <option value="none">Off</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                {!reasoningSupported && <span className="reasoning-na-note">Reasoning not available</span>}
              </div>
            </div>
          </div>

          <div className="job-input-benefits">
            <div className="benefit-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>AI extracts key requirements and skills</span>
            </div>
            <div className="benefit-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Resume tailored with matching keywords</span>
            </div>
            <div className="benefit-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Experience prioritized for this role</span>
            </div>
          </div>
        </div>
      </div>
      <div className="onboarding-footer">
        <button
          className="btn btn-secondary"
          id="back-btn"
          onClick={() => onBack({ title: title.trim(), company: company.trim(), description: description.trim() })}
        >
          Back
        </button>
        <button className="btn btn-primary" id="generate-btn" disabled={generating} onClick={handleGenerate}>
          {generating ? (
            <>
              <span className="btn-spinner" /> AI is creating your resume...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Generate Resume
            </>
          )}
        </button>
      </div>
    </>
  );
}

// --- Step 3: Job descriptions ---------------------------------------------

export function JobDescriptionStep({ jobDescriptions, onAdd, onRemove, onBack, onNext }) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  const hasJobs = jobDescriptions.length > 0;

  const handleAdd = () => {
    const d = desc.trim();
    if (!d) {
      alert('Please paste a job description');
      return;
    }
    onAdd({ title: title.trim() || 'Target Role', company: company.trim() || 'Company', description: d });
    setTitle('');
    setCompany('');
    setDesc('');
  };

  const handleNext = async () => {
    setBusy(true);
    try {
      await onNext();
    } catch (e) {
      alert('Something went wrong: ' + e.message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="onboarding-content">
        <div className="onboarding-step jd-step">
          <h2>Target a Specific Job</h2>
          <p className="jd-explanation">
            <strong>Why add a job description?</strong> AI will analyze the job requirements and tailor your resume to highlight your most relevant skills and experience, making you stand out as the ideal candidate.
          </p>

          <div className="jd-benefits">
            <div className="jd-benefit">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Customized summary targeting the role</span>
            </div>
            <div className="jd-benefit">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Highlights that match key requirements</span>
            </div>
            <div className="jd-benefit">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Keywords from the job posting</span>
            </div>
          </div>

          <div className="jd-input-area">
            <input
              type="text"
              id="jd-title-input"
              className="jd-input-small"
              placeholder="Job Title (e.g. Senior Designer)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              type="text"
              id="jd-company-input"
              className="jd-input-small"
              placeholder="Company Name"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
            <textarea
              id="jd-desc-input"
              className="jd-textarea-small"
              placeholder="Paste the full job description here..."
              rows="5"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
            <button className="btn btn-primary" id="add-jd-btn" onClick={handleAdd}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add This Job
            </button>
          </div>

          {hasJobs && (
            <div className="jd-list-preview" id="jd-list-preview">
              <h4>Target Jobs Added:</h4>
              {jobDescriptions.map((jd, i) => (
                <div className="jd-preview-item" key={i}>
                  <div className="jd-preview-info">
                    <strong>{jd.title}</strong>
                    <span>at {jd.company}</span>
                  </div>
                  <button className="jd-remove-btn" data-index={i} onClick={() => onRemove(i)}>&times;</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="onboarding-footer">
        <button className="btn btn-secondary" id="back-btn" onClick={onBack}>Back</button>
        <button
          className={`btn ${hasJobs ? 'btn-primary' : 'btn-secondary'}`}
          id="next-btn"
          disabled={busy}
          onClick={handleNext}
        >
          {hasJobs ? (
            busy ? (
              <>
                <span className="btn-spinner" /> AI is tailoring your resume...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                Tailor My Resume
              </>
            )
          ) : (
            'Skip for Now'
          )}
        </button>
      </div>
    </>
  );
}

// --- Step 4: Review -------------------------------------------------------

export function ReviewStep({ resume, isTailored, onBack, onCreate }) {
  const hasName = resume?.name && resume.name !== 'Not set';
  const hasTagline = resume?.tagline && resume.tagline !== 'Not set';
  const hasSummary = resume?.summary;
  const hasHighlights = resume?.highlights?.length > 0;
  const hasExperience = resume?.experience?.length > 0;
  const hasSkills = resume?.skills?.length > 0;

  return (
    <>
      <div className="onboarding-content">
        <div className="onboarding-step review-step">
          <h2>{isTailored ? 'Your Tailored Resume' : 'Review Your Resume'}</h2>
          <p>{isTailored ? 'AI has customized your resume for your target role. Here\'s what we created:' : 'Here\'s what we extracted. You can edit everything in the main app.'}</p>

          <div className={`resume-preview-card ${isTailored ? 'tailored' : ''}`}>
            <div className="preview-section">
              <label>Name</label>
              <p className={!hasName ? 'not-set' : ''}>{resume?.name || 'Not detected'}</p>
            </div>

            <div className="preview-section">
              <label>Title</label>
              <p className={!hasTagline ? 'not-set' : ''}>{resume?.tagline || 'Not detected'}</p>
            </div>

            {hasSummary && (
              <div className={`preview-section ${isTailored ? 'ai-generated' : ''}`}>
                <label>
                  {isTailored && <span className="ai-badge-inline">✨ AI</span>}
                  Summary
                </label>
                <p>{resume.summary}</p>
              </div>
            )}

            {hasHighlights && (
              <div className="preview-section ai-generated">
                <label>
                  <span className="ai-badge-inline">✨ AI</span>
                  Highlights
                </label>
                <ul className="highlights-list">
                  {resume.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}

            {hasSkills && (
              <div className={`preview-section ${isTailored ? 'ai-generated' : ''}`}>
                <label>
                  {isTailored && <span className="ai-badge-inline">✨ AI</span>}
                  Key Skills
                </label>
                <p className="skills-list">
                  {resume.skills.slice(0, 12).map((s, i) => (
                    <span className="skill-tag" key={i}>{s}</span>
                  ))}
                </p>
              </div>
            )}

            {hasExperience && (
              <div className="preview-section">
                <label>Experience ({resume.experience.length} positions)</label>
                {resume.experience.slice(0, 3).map((exp, i) => (
                  <div className="preview-exp" key={i}>
                    <strong>{exp.title || 'Position'}</strong>
                    <span>{exp.company || 'Company'}</span>
                  </div>
                ))}
                {resume.experience.length > 3 && (
                  <span className="more-items">+{resume.experience.length - 3} more</span>
                )}
              </div>
            )}

            {resume?.education?.length > 0 && (
              <div className="preview-section">
                <label>Education</label>
                {resume.education.slice(0, 2).map((edu, i) => (
                  <div className="preview-exp" key={i}>
                    <strong>{typeof edu === 'string' ? edu : (edu.degree || 'Degree')}</strong>
                    {typeof edu !== 'string' && <span>{edu.school || ''}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {!hasSummary && !hasHighlights && (
            <div className="parse-warning">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Add a target job in the previous step to get AI-generated summary and highlights.</span>
            </div>
          )}
        </div>
      </div>
      <div className="onboarding-footer">
        <button className="btn btn-secondary" id="back-btn" onClick={onBack}>Back</button>
        <button className="btn btn-primary" id="next-btn" onClick={onCreate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Create My Resume
        </button>
      </div>
    </>
  );
}

// --- Step 5: Final --------------------------------------------------------

export function FinalStep({ onFinish }) {
  return (
    <>
      <div className="onboarding-content">
        <div className="onboarding-step final-step">
          <div className="success-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h1>Your Resume is Ready!</h1>
          <p>You can now edit, style, and export your resume.</p>

          <div className="final-tips">
            <div className="tip">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span>Click any text on the resume to edit it directly</span>
            </div>
            <div className="tip">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>Use the AI Assistant to help improve your content</span>
            </div>
            <div className="tip">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
              <span>Open the Edit panel on the right to reorganize sections</span>
            </div>
          </div>
        </div>
      </div>
      <div className="onboarding-footer">
        <button className="btn btn-primary btn-lg" id="finish-btn" onClick={onFinish}>Start Editing</button>
      </div>
    </>
  );
}
