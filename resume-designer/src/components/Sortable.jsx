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
// into the parent list — the isolation that the vanilla code achieved by
// resolving the list from `draggedItem.closest('[data-sortable]')`. The
// restrictToParentElement modifier also keeps the drag image inside its list.

/**
 * A single, self-contained sortable list. `ids` are the stable item ids in
 * order; `onReorder(fromIndex, toIndex)` is called on drop (wire it to
 * store.moveInArray). Handle-only drag is enforced by SortableItem.
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

/**
 * One sortable item. Renders a drag handle (the only drag-initiating element —
 * handle-only drag) followed by the item content. `className` carries the
 * existing item classes (e.g. "sortable-item tool-item"); `.dragging` is added
 * while dragging, matching the vanilla styling hooks.
 */
export function SortableItem({
  id, className, children,
  handleClassName = 'drag-handle', handleContent = '⋮⋮', handleTitle = 'Drag to reorder',
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={cn(className, isDragging && 'dragging')}>
      <span className={handleClassName} title={handleTitle} {...attributes} {...listeners}>
        {handleContent}
      </span>
      {children}
    </div>
  );
}
