// Analysis-results renderer, ported from renderAnalysisResults +
// renderRecommendationCard + the impact helpers in jobDescriptionPanel.js.
// Pure presentational: applying a recommendation is delegated to onApply.

function getImpactPriority(impact) {
  return ({ high: 0, medium: 1, low: 2 })[impact] ?? 1;
}

function getImpactLabel(impact) {
  return ({ high: 'High Impact', medium: 'Medium Impact', low: 'Low Impact' })[impact] || 'Medium Impact';
}

function ImpactIcon({ impact }) {
  switch (impact) {
    case 'high':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      );
    case 'medium':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case 'low':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12h8" />
        </svg>
      );
    default:
      return null;
  }
}

function RecommendationCard({ rec, originalIndex, appliedIndexes, onApply }) {
  const isApplied = appliedIndexes.has(originalIndex);
  const impact = rec.impact || 'medium';

  return (
    <div className={`jd-recommendation ${isApplied ? 'applied' : ''}`} data-impact={impact}>
      <div className="jd-rec-header">
        <div className="jd-rec-header-left">
          <span className={`jd-impact-badge ${impact}`} title={rec.impactReason || ''}>
            <ImpactIcon impact={impact} /> {getImpactLabel(impact)}
          </span>
          <span className="jd-rec-section">{rec.section}</span>
        </div>
        {isApplied ? (
          <span className="jd-applied-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg> Applied
          </span>
        ) : (
          <button className="btn btn-sm jd-apply-rec" onClick={() => onApply(originalIndex)}>Apply</button>
        )}
      </div>
      <div className="jd-rec-content">
        <div className="jd-rec-current">{rec.current}</div>
        <div className="jd-rec-arrow">→</div>
        <div className="jd-rec-suggested">{rec.suggested}</div>
      </div>
      <p className="jd-rec-reason">{rec.reason}</p>
      {rec.impactReason && <p className="jd-rec-impact-reason">{rec.impactReason}</p>}
    </div>
  );
}

export function AnalysisResults({ results, appliedIndexes, onApply }) {
  if (!results) return null;

  const recommendations = (results.recommendations || [])
    .map((rec, i) => ({ ...rec, originalIndex: i }))
    .sort((a, b) => getImpactPriority(a.impact) - getImpactPriority(b.impact));

  const highImpact = recommendations.filter((r) => r.impact === 'high');
  const mediumImpact = recommendations.filter((r) => r.impact === 'medium' || !r.impact);
  const lowImpact = recommendations.filter((r) => r.impact === 'low');

  const impactCounts = {
    high: highImpact.length,
    medium: mediumImpact.length,
    low: lowImpact.length,
  };

  const groups = [
    { key: 'high', items: highImpact, label: 'High Impact Changes', hint: 'Address these first for maximum improvement' },
    { key: 'medium', items: mediumImpact, label: 'Medium Impact Changes', hint: 'Important improvements to consider' },
    { key: 'low', items: lowImpact, label: 'Low Impact Changes', hint: 'Nice-to-have optimizations' },
  ];

  return (
    <div className="jd-results">
      <div className="jd-score">
        <div className="jd-score-circle">
          <span className="jd-score-value">{results.matchScore}</span>
          <span className="jd-score-label">Match</span>
        </div>
      </div>

      <div className="jd-results-section">
        <h4>Matching Keywords</h4>
        <div className="jd-keywords">
          {(results.keywordMatches || []).map((k, i) => (
            <span key={i} className="jd-keyword match">{k}</span>
          ))}
        </div>
      </div>

      <div className="jd-results-section">
        <h4>Missing Keywords</h4>
        <div className="jd-keywords">
          {(results.missingKeywords || []).map((k, i) => (
            <span key={i} className="jd-keyword missing">{k}</span>
          ))}
        </div>
      </div>

      <div className="jd-results-section">
        <h4>Strengths</h4>
        <ul className="jd-list-simple">
          {(results.strengths || []).map((s, i) => (
            <li key={i} className="jd-strength">{s}</li>
          ))}
        </ul>
      </div>

      <div className="jd-results-section">
        <h4>Gaps to Address</h4>
        <ul className="jd-list-simple">
          {(results.gaps || []).map((g, i) => (
            <li key={i} className="jd-gap">
              <strong>{g.area}:</strong> {g.issue}
              <span className="jd-suggestion">{g.suggestion}</span>
            </li>
          ))}
        </ul>
      </div>

      {recommendations.length > 0 && (
        <div className="jd-results-section jd-recommendations-section">
          <div className="jd-rec-section-header">
            <h4>Recommended Changes</h4>
            <div className="jd-impact-summary">
              {impactCounts.high > 0 && <span className="jd-impact-count high">{impactCounts.high} high</span>}
              {impactCounts.medium > 0 && <span className="jd-impact-count medium">{impactCounts.medium} medium</span>}
              {impactCounts.low > 0 && <span className="jd-impact-count low">{impactCounts.low} low</span>}
            </div>
          </div>

          {groups.map((group) =>
            group.items.length > 0 ? (
              <div key={group.key} className={`jd-impact-group ${group.key}`}>
                <div className="jd-impact-group-header">
                  <span className="jd-impact-group-icon"><ImpactIcon impact={group.key} /></span>
                  <span className="jd-impact-group-label">{group.label}</span>
                  <span className="jd-impact-group-hint">{group.hint}</span>
                </div>
                {group.items.map((rec) => (
                  <RecommendationCard
                    key={rec.originalIndex}
                    rec={rec}
                    originalIndex={rec.originalIndex}
                    appliedIndexes={appliedIndexes}
                    onApply={onApply}
                  />
                ))}
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
