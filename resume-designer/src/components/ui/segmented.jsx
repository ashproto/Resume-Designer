import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Segmented control — the iOS-style "muted track + white sliding pill" picker
 * from the approved redesign mockup (`.seg`). Used for small, mutually-exclusive
 * option sets (theme, display mode, header style, reasoning effort) where a row
 * of separate Buttons would read as heavier than intended.
 *
 * Controlled by the caller: render a <SegmentedItem active={…} onClick={…}> per
 * option. Geometry is pinned to the mockup (track radius 9, pill radius 7,
 * 29px tall; `size="xs"` → 25px) — these exact px are the spec, not magic
 * numbers to be "rounded" to the type scale.
 *
 * Full-width usage: pass `className="flex w-full"` on Segmented and
 * `className="flex-1"` on each item (e.g. the Settings theme grid).
 */
const Segmented = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    role="tablist"
    className={cn("inline-flex items-center gap-0.5 rounded-[9px] bg-muted p-[3px]", className)}
    {...props}
  />
))
Segmented.displayName = "Segmented"

const SegmentedItem = React.forwardRef(({ className, active = false, size, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="tab"
    aria-selected={active}
    data-state={active ? "active" : "inactive"}
    className={cn(
      "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] font-medium text-muted-foreground transition-colors",
      "hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
      "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      size === "xs" ? "h-[25px] px-2.5 text-xs" : "h-[29px] px-3 text-[13px]",
      className
    )}
    {...props}
  />
))
SegmentedItem.displayName = "SegmentedItem"

export { Segmented, SegmentedItem }
