import JobContext from './JobContext.jsx';

export default function ProcessingView({ heading, message, reasoning, fields = [], job, step }) {
  // Keep a readable window of the provider's live notes rather than an
  // ever-growing transcript. The operation's real stage remains visible.
  const notes = String(reasoning ?? '').replace(/\s+/g, ' ').trim();
  const excerpt = notes.length > 360 ? `…${notes.slice(-360).replace(/^\S*\s/, '')}` : notes;
  return (
    <main className="processing-view" aria-label={heading}>
      <p className="processing-brand">On Paper <span>Companion</span></p>
      <div className="processing-center">
        <div className="processing-indicator" aria-hidden="true"><span /><span /><span /></div>
        <p className="eyebrow">{heading}</p>
        <div className="processing-status" role="status" aria-live="polite" aria-atomic="true">
          <h1 key={step || message}>{message}</h1>
        </div>
        {excerpt ? <div className="processing-notes"><p className="eyebrow">Live AI notes</p><p>{excerpt}</p></div> : null}
        {fields.length ? (
          <section className="discovered-fields" aria-label="Discovered application fields">
            <p>{fields.length} {fields.length === 1 ? 'field found' : 'fields found'}</p>
            <ul>{fields.slice(0, 8).map((field) => <li key={field.field_id}>{field.label || field.name || 'Application field'}</li>)}</ul>
            {fields.length > 8 ? <p className="supporting-copy">And {fields.length - 8} more to review.</p> : null}
          </section>
        ) : null}
        {job ? <JobContext job={job} compact /> : null}
      </div>
      <p className="processing-footnote">You’ll review the results before using them.</p>
    </main>
  );
}
