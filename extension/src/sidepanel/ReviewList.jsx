function editorFor(item, controlId, onChange, { describedBy, disabled }) {
  if (item.manualCustom || item.manualSensitive) return null;

  if (item.type === 'file') {
    if (item.manualFile) return null;
    return <p className="file-value">Selected resume PDF</p>;
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

  if (item.type === 'textarea') {
    return (
      <textarea
        id={controlId}
        value={item.value}
        rows={5}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(event) => onChange(item.field_id, event.target.value)}
      />
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
          const manualOnly = item.manualFile || item.manualCustom || item.manualSensitive;
          const staticLabelId = manualOnly ? `${controlId}-label` : null;
          const questionId = item.question ? `${controlId}-question` : null;
          const draftId = item.aiDraft && !manualOnly ? `${controlId}-draft` : null;
          const unanswered = item.needsHuman && !manualOnly && !item.value.trim();
          const answerId = unanswered ? `${controlId}-answer-needed` : null;
          const confidenceId = item.lowConfidence && !manualOnly ? `${controlId}-confidence` : null;
          const manualWarningId = manualOnly ? `${controlId}-manual-warning` : null;
          const describedBy = [questionId, confidenceId, draftId, answerId].filter(Boolean).join(' ') || undefined;
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
                {item.type === 'file' || item.manualCustom || item.manualSensitive
                  ? <p id={staticLabelId || undefined} className="field-label">{item.label}</p>
                  : <label htmlFor={controlId}>{item.label}</label>}
                {answerId ? <span id={answerId} className="confidence-warning">Needs your answer</span> : null}
                {confidenceId ? (
                  <span id={confidenceId} className="confidence-warning">Low confidence</span>
                ) : null}
              </div>
              {draftId ? <p id={draftId} className="draft-note">AI draft — review before filling</p> : null}
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
              {item.manualSensitive ? (
                <p id={manualWarningId} className="manual-warning" role="note">
                  Complete this question yourself on the application page.
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
