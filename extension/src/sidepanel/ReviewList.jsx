function editorFor(item, controlId, onChange, { describedBy, disabled }) {
  if (item.manualCustom) return null;

  if (item.type === 'file') {
    if (item.manualFile) return null;
    return <p className="file-value">Selected résumé PDF</p>;
  }

  if (item.type === 'select' || item.type === 'radio') {
    return (
      <select
        id={controlId}
        value={item.value}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(event) => onChange(item.field_id, event.target.value)}
      >
        {item.needsHuman ? <option value="">Choose…</option> : null}
        {item.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  }

  if (item.type === 'checkbox') {
    return (
      <select
        id={controlId}
        value={item.value}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(event) => onChange(item.field_id, event.target.value)}
      >
        {item.needsHuman ? <option value="">Choose…</option> : null}
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  return (
    <input
      id={controlId}
      type="text"
      value={item.value}
      aria-describedby={describedBy}
      disabled={disabled}
      onChange={(event) => onChange(item.field_id, event.target.value)}
    />
  );
}

export default function ReviewList({
  items,
  onChange,
  onSaveAnswer,
  savedAnswers,
  savingAnswers,
  disabled = false,
}) {
  return (
    <section className="panel-section" aria-labelledby="review-heading">
      <div className="section-heading">
        <h2 id="review-heading">Review fields</h2>
        <span>{items.length} fields</span>
      </div>
      <ol className="review-list">
        {items.map((item, index) => {
          const controlId = `review-field-${index}`;
          const manualOnly = item.manualFile || item.manualCustom;
          const staticLabelId = manualOnly ? `${controlId}-label` : null;
          const questionId = item.question ? `${controlId}-question` : null;
          const confidenceId = item.lowConfidence && !manualOnly ? `${controlId}-confidence` : null;
          const manualWarningId = manualOnly ? `${controlId}-manual-warning` : null;
          const describedBy = [questionId, confidenceId].filter(Boolean).join(' ') || undefined;
          const cardDescribedBy = manualOnly
            ? [questionId, manualWarningId].filter(Boolean).join(' ') || undefined
            : undefined;
          const canSave = item.needsHuman
            && !manualOnly
            && Boolean(item.value.trim());
          const saving = savingAnswers.has(item.field_id);
          const saved = savedAnswers.get(item.field_id) === item.value.trim();

          return (
            <li
              className="review-item"
              key={item.field_id}
              aria-labelledby={staticLabelId || undefined}
              aria-describedby={cardDescribedBy}
            >
              <div className="review-label-row">
                {item.type === 'file' || item.manualCustom
                  ? <p id={staticLabelId || undefined} className="field-label">{item.label}</p>
                  : <label htmlFor={controlId}>{item.label}</label>}
                {confidenceId ? (
                  <span id={confidenceId} className="confidence-warning">Low confidence</span>
                ) : null}
              </div>
              {item.question ? (
                <p id={questionId} className="field-question">{item.question}</p>
              ) : null}
              {editorFor(item, controlId, onChange, {
                describedBy,
                disabled: disabled || saving,
              })}
              {item.manualFile ? (
                <p id={manualWarningId} className="manual-warning" role="note">
                  Complete this file field manually.
                </p>
              ) : null}
              {item.manualCustom ? (
                <p id={manualWarningId} className="manual-warning" role="note">
                  This field can’t be autofilled. Complete it on the application page.
                </p>
              ) : null}
              {canSave ? (
                <button
                  type="button"
                  className="secondary-button compact-button"
                  aria-label={`Save answer for ${item.label}`}
                  disabled={disabled || saving || saved}
                  onClick={() => onSaveAnswer(item)}
                >
                  {saved ? 'Answer saved' : saving ? 'Saving…' : 'Save answer'}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
