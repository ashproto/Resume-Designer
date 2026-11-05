import { useId, useState } from 'react';

import './GeneratedResume.css';

function previewSource(preview) {
  const base64 = preview?.imageBase64;
  if (
    (preview?.mimeType && preview.mimeType !== 'image/png')
    || typeof base64 !== 'string'
    || !base64.startsWith('iVBORw0KGgo')
    || base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  ) return null;
  return `data:image/png;base64,${base64}`;
}

export default function GeneratedResume({
  resume,
  preview,
  previewLoading = false,
  previewError,
  onRetryPreview,
  onOpenInApp,
  opening = false,
  openError,
  onPrepareAutofill,
  disabled = false,
}) {
  const headingId = useId();
  const [failedSource, setFailedSource] = useState(null);
  const source = previewSource(preview);
  const imageVisible = source && source !== failedSource;
  const previewUnavailable = previewError?.code === 'app_update_required';
  const openUnavailable = openError?.code === 'app_update_required' || !onOpenInApp;
  const name = resume?.name || 'Tailored resume';
  const pageCount = Number.isInteger(preview?.pageCount) && preview.pageCount > 0
    ? preview.pageCount
    : null;
  const previewFailed = Boolean(previewError || (preview && !imageVisible));

  return (
    <section className="panel-section generated-resume" aria-labelledby={headingId}>
      <header className="generated-resume-heading">
        <span className="generated-resume-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="m6 12 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <div>
          <p className="eyebrow">Saved in On Paper</p>
          <h2 id={headingId}>Your resume is ready</h2>
        </div>
      </header>

      <figure className="generated-resume-preview">
        <div className="generated-resume-sheet" aria-busy={previewLoading}>
          {imageVisible ? (
            <img
              src={source}
              alt={`First page of ${name}`}
              onError={() => setFailedSource(source)}
            />
          ) : (
            <div className="generated-resume-placeholder">
              <svg viewBox="0 0 32 40" fill="none" aria-hidden="true">
                <path d="M6 2h13l7 7v29H6zM19 2v8h7M11 17h10M11 23h10M11 29h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p role="status">{previewLoading ? 'Preparing your preview…' : 'Preview unavailable'}</p>
            </div>
          )}
        </div>
        <figcaption>
          <strong>{name}</strong>
          <span>{imageVisible ? 'First page preview' : 'Saved resume'}{pageCount ? ` · ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}` : ''}</span>
        </figcaption>
      </figure>

      {!previewLoading && previewFailed ? (
        <div className="generated-resume-preview-message" role="status">
          <p>{previewUnavailable
            ? 'Update On Paper to see resume previews here. Your resume is saved and ready to view in the app.'
            : 'Your resume is saved. The preview couldn’t be loaded.'}</p>
          {!previewUnavailable && onRetryPreview ? (
            <button className="text-button" type="button" disabled={disabled} onClick={() => { setFailedSource(null); onRetryPreview(); }}>Try preview again</button>
          ) : null}
        </div>
      ) : null}

      <button className="primary-button generated-resume-open" type="button" disabled={disabled || opening || !onOpenInApp} onClick={onOpenInApp}>
        {opening ? 'Opening On Paper…' : 'View in On Paper'}
      </button>
      {openError || openUnavailable ? (
        <p className="generated-resume-open-error" role="alert">
          {openUnavailable ? 'Update On Paper to open this resume from Companion. ' : 'The resume couldn’t be opened. '}
          You can open On Paper and choose “{name}” in Resumes.
        </p>
      ) : null}

      <div className="generated-resume-next-step">
        <p>Ready to apply? Open the application page first, then prepare the fields for review.</p>
        <button className="secondary-button" type="button" disabled={disabled || !onPrepareAutofill} onClick={onPrepareAutofill}>
          Prepare application autofill
        </button>
      </div>
    </section>
  );
}
