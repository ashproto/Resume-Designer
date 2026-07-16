function editorFor(item, controlId, onChange) {
  if (item.type === 'file') {
    if (item.manualFile) return null;
    return <p className="file-value">Selected résumé PDF</p>;
  }

  if (item.type === 'select' || item.type === 'radio') {
    return (
      <select
        id={controlId}
        value={item.value}
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
          const canSave = item.needsHuman
            && !item.manualFile
            && Boolean(item.value.trim());
          const saving = savingAnswers.has(item.field_id);
          const saved = savedAnswers.has(item.field_id);

          return (
            <li className="review-item" key={item.field_id}>
              <div className="review-label-row">
                {item.type === 'file'
                  ? <p className="field-label">{item.label}</p>
                  : <label htmlFor={controlId}>{item.label}</label>}
                {item.lowConfidence ? <span className="confidence-warning">Low confidence</span> : null}
              </div>
              {item.question ? <p className="field-question">{item.question}</p> : null}
              {editorFor(item, controlId, onChange)}
              {item.manualFile ? (
                <p className="manual-warning" role="note">Complete this file field manually.</p>
              ) : null}
              {canSave ? (
                <button
                  type="button"
                  className="secondary-button compact-button"
                  aria-label={`Save answer for ${item.label}`}
                  disabled={saving || saved}
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
