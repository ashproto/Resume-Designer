import { cn } from '@/lib/utils';

// Presentational job-description card, ported from renderJobDescriptionCard in
// jobDescriptionPanel.js. Pure leaf component: all mutations go through the
// callback props supplied by the parent JobsDialog.

function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  if (diff < 86400000) return 'today';
  if (diff < 172800000) return 'yesterday';
  return date.toLocaleDateString();
}

export function JobCard({ jd, collapsed, onToggleCollapse, onToggleActive, onEdit, onDelete }) {
  const isCollapsed = collapsed;
  const preview =
    jd.description.length > 150 ? jd.description.substring(0, 150) + '...' : jd.description;

  return (
    <div
      className={cn('jd-card', jd.isActive && 'active', isCollapsed && 'collapsed')}
      data-id={jd.id}
    >
      <div className="jd-card-header">
        <button
          className={cn('jd-card-expand', !isCollapsed && 'expanded')}
          title={isCollapsed ? 'Expand' : 'Collapse'}
          onClick={onToggleCollapse}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <div className="jd-card-info">
          <h4 className="jd-card-title">{jd.title}</h4>
          <span className="jd-card-company">{jd.company}</span>
        </div>
        <div className="jd-card-actions">
          <button
            className={cn('jd-card-toggle', jd.isActive && 'active')}
            title={jd.isActive ? 'Deactivate' : 'Activate'}
            onClick={onToggleActive}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {jd.isActive ? (
                <>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </>
              ) : (
                <circle cx="12" cy="12" r="10" />
              )}
            </svg>
          </button>
          <button className="jd-card-edit" title="Edit" onClick={onEdit}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button className="jd-card-delete" title="Delete" onClick={onDelete}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
      <p className="jd-card-preview">{preview}</p>
      <div className="jd-card-footer">
        <span className="jd-card-date">Added {formatDate(jd.dateAdded)}</span>
      </div>
    </div>
  );
}
