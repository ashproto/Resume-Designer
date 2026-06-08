import { createContext, useContext } from 'react';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';

// Reusable dnd-kit sortable primitives for the panel editors (structure, and
// later profile/jobs). Replaces the bespoke draggable/dragover/drop handlers in
// the vanilla panels.
//
// NESTED-LIST SCOPING (the #8 fix, restated structurally): each SortableList
// owns its OWN DndContext. A drag begun inside a nested list (e.g. an
// experience's bullets) is captured by that inner context and can never cross
// into the parent list — the isolation the vanilla code achieved by resolving
// the list from `draggedItem.closest('[data-sortable]')`. restrictToParentElement
// also keeps the drag image inside its own list.

/**
 * A single, self-contained sortable list. `ids` are the stable item ids in
 * order; `onReorder(fromIndex, toIndex)` fires on drop (wire to store.moveInArray).
 */
export function SortableList({ ids, onReorder, children, className }) {
  const sensors = useSensors(
    // 4px activation distance so a click on an input/button inside the item
    // isn't swallowed as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(active.id);
    const to = ids.indexOf(over.id);
    if (from !== -1 && to !== -1) onReorder(from, to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  );
}

// Provides the active item's drag attributes/listeners to a <DragHandle> placed
// anywhere within the item — so the handle can sit as a direct child (tool /
// bullet / education rows) OR nested inside another element (the experience
// accordion header), matching the original markup in each case.
const SortableItemContext = createContext({ attributes: {}, listeners: undefined });

/**
 * One sortable item. Renders the draggable container; the caller places a
 * <DragHandle> wherever the original markup had it (handle-only drag).
 * `.dragging` is added while dragging, matching the existing styling hooks.
 */
export function SortableItem({ id, className, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };
  return (
    <SortableItemContext.Provider value={{ attributes, listeners }}>
      <div ref={setNodeRef} style={style} className={cn(className, isDragging && 'dragging')}>
        {children}
      </div>
    </SortableItemContext.Provider>
  );
}

/** The drag-initiating handle for the enclosing SortableItem. */
export function DragHandle({ className = 'drag-handle', children = '⋮⋮', title = 'Drag to reorder' }) {
  const { attributes, listeners } = useContext(SortableItemContext);
  return (
    <span className={className} title={title} {...attributes} {...listeners}>
      {children}
    </span>
  );
}
