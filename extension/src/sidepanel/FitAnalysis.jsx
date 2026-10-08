function itemText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return String(item ?? '');
  return [item.area, item.issue, item.suggestion, item.section, item.suggested, item.reason]
    .map((value) => String(value ?? '').trim()).filter(Boolean).join(' — ');
}

function concise(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 200) return clean;
  const sentence = clean.match(/^.{40,195}?[.!?](?:\s|$)/)?.[0];
  return sentence?.trim() || `${clean.slice(0, 197).replace(/\s+\S*$/, '')}…`;
}

function AnalysisList({ heading, items, limit = 2, className = '' }) {
  if (!Array.isArray(items) || !items.length) return null;
  return <section className={`fit-section ${className}`}>
    <h4>{heading}</h4>
    <ul>{items.slice(0, limit).map((item, index) => <li key={index}>{Number.isFinite(limit) ? concise(itemText(item)) : itemText(item)}</li>)}</ul>
  </section>;
}

export default function FitAnalysis({ analysis }) {
  if (!analysis) return null;
  const numericScore = Number(analysis.matchScore);
  const score = Number.isFinite(numericScore) ? Math.max(0, Math.min(100, Math.round(numericScore))) : null;
  const label = score === null ? 'Your fit at a glance' : score >= 80 ? 'Strong alignment' : score >= 60 ? 'A promising starting point' : 'Some gaps to consider';
  const keywords = Array.isArray(analysis.missingKeywords) ? analysis.missingKeywords : [];
  const hasMore = ['strengths', 'gaps', 'recommendations'].some((key) => (
    Array.isArray(analysis[key]) && (analysis[key].length > 2 || analysis[key].some((item) => itemText(item).length > 200))
  )) || keywords.length > 8;
  return (
    <section className="result-block fit-result" aria-labelledby="fit-result-heading">
      <div className="fit-overview">
        <div><p className="eyebrow">Role fit</p><h3 id="fit-result-heading">{label}</h3><p className="supporting-copy">AI estimate from the captured role and your selected source.</p></div>
        {score !== null ? <p className="fit-score"><strong>{score}%</strong>{' '}<span>match</span></p> : null}
      </div>
      <AnalysisList heading="What works" items={analysis.strengths} className="fit-strengths" />
      <AnalysisList heading="What needs attention" items={analysis.gaps} className="fit-gaps" />
      <AnalysisList heading="Your next steps" items={analysis.recommendations} className="fit-actions" />
      {keywords.length ? <section className="fit-section"><h4>Keywords to consider</h4><ul className="keyword-list">{keywords.slice(0, 8).map((keyword, index) => <li key={index}>{concise(itemText(keyword))}</li>)}</ul></section> : null}
      {hasMore ? <details className="fit-details"><summary>View full analysis</summary>
        <AnalysisList heading="Strengths" items={analysis.strengths} limit={Infinity} />
        <AnalysisList heading="Gaps" items={analysis.gaps} limit={Infinity} />
        <AnalysisList heading="Recommendations" items={analysis.recommendations} limit={Infinity} />
        {keywords.length > 8 ? <AnalysisList heading="All missing keywords" items={keywords} limit={Infinity} /> : null}
      </details> : null}
    </section>
  );
}
