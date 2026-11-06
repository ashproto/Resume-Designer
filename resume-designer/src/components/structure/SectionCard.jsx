import { ArrowDown, ArrowUp, ChevronDown, Trash2 } from 'lucide-react';
import { SortableItem, DragHandle } from '../Sortable.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented, SegmentedItem } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SectionTypography from './SectionTypography.jsx';

export default function SectionCard({
  node, title, titlePath, collapsed, onToggle, onTitleChange, onDelete,
  onMove, first, last, area, onAreaChange, parentKey, groups, onParentChange,
  onStyleChange, headerExtra, children,
}) {
  return (
    <SortableItem id={node.key} className="overflow-hidden rounded-lg border bg-background">
      <div data-editor-key={node.key}>
        <div className="flex items-center gap-1 bg-muted/40 p-2">
          <DragHandle title={`Reorder ${title}`} />
          <Input className="h-8 min-w-0 flex-1 font-semibold" aria-label={node.children ? 'Group title' : 'Section title'} data-field={titlePath} defaultValue={title} onChange={e => onTitleChange(e.target.value)} />
          <Button variant="ghost" size="icon" className="size-6" aria-label={`Move ${title} up`} disabled={first} onClick={() => onMove(-1)}><ArrowUp className="size-3" /></Button>
          <Button variant="ghost" size="icon" className="size-6" aria-label={`Move ${title} down`} disabled={last} onClick={() => onMove(1)}><ArrowDown className="size-3" /></Button>
          {headerExtra}
          <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-destructive" aria-label={node.children ? `Remove ${title} group` : `Delete ${title} section`} title={node.children ? 'Remove group' : 'Delete section'} onClick={onDelete}><Trash2 className="size-3.5" /></Button>
          <Button variant="ghost" size="icon" className="size-6" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`} onClick={onToggle}><ChevronDown className={`size-3.5 ${collapsed ? '' : 'rotate-180'}`} /></Button>
        </div>
        {!collapsed && (
          <div className="space-y-3 border-t p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Area</span>
              <Segmented size="xs">
                {[['sidebar', 'Sidebar'], ['main', 'Main']].map(([key, name]) => <SegmentedItem key={key} size="xs" active={area === key} onClick={() => onAreaChange(key)}>{name}</SegmentedItem>)}
              </Segmented>
            </div>
            {!node.children && groups.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Parent group</Label>
                <Select value={parentKey || 'none'} onValueChange={value => onParentChange(value === 'none' ? '' : value)}>
                  <SelectTrigger className="h-8" aria-label="Parent group"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No parent group</SelectItem>{groups.map(group => <SelectItem key={group.key} value={group.key}>{group.title || 'Untitled group'}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <SectionTypography node={node} onStyleChange={onStyleChange} />
            {children}
          </div>
        )}
      </div>
    </SortableItem>
  );
}
