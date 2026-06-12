import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Collapsible section card for the structure panel's tabs, composed from shadcn
 * primitives + Tailwind utilities (no bespoke CSS). Each section is a bordered
 * `.st-card` from the approved mockup: rounded-lg (10px) border, a clickable
 * `bg-muted/40` head (title 13.5px + actions), and a `border-t` body. Cards
 * stack with vertical gap (provided by the tab-content wrapper in StructurePanel).
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
    <section className="overflow-hidden rounded-lg border">
      <div
        className="flex w-full cursor-pointer select-none items-center justify-between gap-2 bg-muted/40 px-3 py-2.5"
        onClick={toggle}
      >
        <h3 className="text-[13.5px] font-semibold">{title}</h3>
        <div className="flex items-center gap-1">
          {/* Header buttons (e.g. add / reset) must not also toggle collapse. */}
          {headerExtra && <span onClick={(e) => e.stopPropagation()}>{headerExtra}</span>}
          <button
            type="button"
            className="flex size-5 items-center justify-center text-muted-foreground"
            onClick={(e) => { e.stopPropagation(); toggle(); }}
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            <ChevronDown className={cn('size-4 transition-transform', !collapsed && 'rotate-180')} />
          </button>
        </div>
      </div>
      {!collapsed && <div className="space-y-3 border-t p-3">{children}</div>}
    </section>
  );
}
