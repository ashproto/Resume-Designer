import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Collapsible section for the structure panel's tabs — the React port of the
 * vanilla renderCollapsibleSection(). Reuses the existing `.panel-section` CSS
 * so it looks identical.
 *
 * Collapse is UNCONTROLLED by default (internal useState) — used by the design
 * tab, which never remounts on resume-data changes. The content tabs DO remount
 * (uncontrolled inputs refresh via a dataVersion key), so they CONTROL collapse
 * from the parent (pass `collapsed` + `onToggleCollapse`) to keep it across
 * remounts — matching the vanilla collapsedSections behavior.
 */
export function PanelSection({
  title, headerExtra, children,
  collapsed: collapsedProp, onToggleCollapse, defaultCollapsed = false,
}) {
  const [internal, setInternal] = useState(defaultCollapsed);
  const isControlled = collapsedProp !== undefined;
  const collapsed = isControlled ? collapsedProp : internal;
  const toggle = () => { if (isControlled) onToggleCollapse?.(); else setInternal((c) => !c); };

  return (
    <section className={cn('panel-section', collapsed && 'collapsed')}>
      <div className="panel-section-header" onClick={toggle}>
        <h3 className="panel-section-title">{title}</h3>
        <div className="panel-section-actions">
          {/* Header buttons (e.g. add / reset) must not also toggle collapse. */}
          {headerExtra && <span onClick={(e) => e.stopPropagation()}>{headerExtra}</span>}
          <button
            className="panel-collapse-btn"
            type="button"
            onClick={(e) => { e.stopPropagation(); toggle(); }}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points={collapsed ? '6 9 12 15 18 9' : '18 15 12 9 6 15'} />
            </svg>
          </button>
        </div>
      </div>
      <div className="panel-section-content">{children}</div>
    </section>
  );
}
