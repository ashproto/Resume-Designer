import { useEffect, useReducer, useState } from 'react';
import { ArrowLeft, ArrowRight, MoreHorizontal } from 'lucide-react';
import { CONTACT_FIELDS, getContactLayout, setContactLayoutRows, resetContactLayout } from '../../contactFields.js';
import { readRenderedContactRows } from '../../contactMeasurement.js';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export default function ContactLayoutEditor({ data, layout = 'sidebar', onChange, readData }) {
  const [measured, setMeasured] = useState(null);
  const [, refresh] = useReducer(value => value + 1, 0);
  const current = readData?.() || data;
  const arrangement = getContactLayout(current, layout);
  const custom = arrangement.mode === 'custom';

  useEffect(() => {
    const canvas = document.getElementById('resume');
    if (!canvas) return;
    let live = true;
    const measure = () => {
      if (!live) return;
      const next = readRenderedContactRows(canvas);
      setMeasured(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      refresh();
    };
    measure();
    // The main renderer replaces the header after field, layout and font edits.
    // Observe that canvas, rather than reading an assumed template row count.
    const observer = new MutationObserver(measure);
    observer.observe(canvas, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    resize?.observe(canvas);
    document.fonts?.ready?.then(measure);
    return () => { live = false; observer.disconnect(); resize?.disconnect(); };
  }, [layout]);

  const rows = custom ? arrangement.rows : measured || [];
  const commit = change => {
    const next = rows.map(row => [...row]);
    change(next);
    onChange(setContactLayoutRows(readData?.() || data, layout, next));
  };
  const moveWithin = (row, index, direction) => commit(next => {
    const [field] = next[row].splice(index, 1);
    next[row].splice(index + direction, 0, field);
  });
  const moveTo = (row, index, destination) => commit(next => {
    const [field] = next[row].splice(index, 1);
    if (destination === next.length) next.push([field]);
    else next[destination].push(field);
  });
  const split = (row, index) => commit(next => {
    const remaining = next[row].splice(index);
    next.splice(row + 1, 0, remaining);
  });

  return <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
    <div className="space-y-1">
      <h4 className="text-sm font-medium">Contact arrangement</h4>
      <p className="text-xs text-muted-foreground">For the <span className="capitalize">{layout.replaceAll('-', ' ')}</span> layout. Automatic follows this template’s flow and wrapping.</p>
    </div>
    <div className="flex gap-2" role="group" aria-label="Contact arrangement mode">
      <Button type="button" size="sm" variant={!custom ? 'secondary' : 'outline'} aria-pressed={!custom}
        onClick={() => onChange(resetContactLayout(readData?.() || data, layout))}>Automatic</Button>
      <Button type="button" size="sm" variant={custom ? 'secondary' : 'outline'} aria-pressed={custom} disabled={!measured?.length}
        onClick={() => { if (!custom || arrangement.source === 'legacy') onChange(setContactLayoutRows(readData?.() || data, layout, measured)); }}>Customize</Button>
    </div>
    {custom && arrangement.source === 'legacy' && <p className="text-xs text-muted-foreground">Using your earlier saved arrangement. Changes here will apply only to this layout.</p>}
    {rows.length ? <div className="space-y-2">
      {rows.map((row, rowIndex) => <div key={rowIndex} className="space-y-2 rounded-md border bg-background p-2" role="group" aria-label={`Line ${rowIndex + 1} contacts`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">Line {rowIndex + 1}</span>
          {custom && rowIndex > 0 && <Button type="button" size="sm" variant="ghost" className="h-6 px-1 text-xs" aria-label={`Join line ${rowIndex + 1} with previous line`}
            onClick={() => commit(next => { next[rowIndex - 1].push(...next[rowIndex]); next.splice(rowIndex, 1); })}>Join previous</Button>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {row.map((field, index) => {
            const label = CONTACT_FIELDS[field]?.label || field;
            const value = current.contact?.[field] || '(empty)';
            return <div key={field} className="flex min-w-0 max-w-full items-center gap-1 rounded-md bg-muted/70 px-2 py-1.5">
              <div className="min-w-0">
                <span className="block text-[10px] text-muted-foreground">{label}</span>
                <span className="block max-w-[180px] truncate text-xs" title={value}>{value}</span>
              </div>
              {custom && <>
                <Button type="button" variant="ghost" size="icon" className="size-5" aria-label={`Move ${label} left`} disabled={index === 0} onClick={() => moveWithin(rowIndex, index, -1)}><ArrowLeft className="size-3" /></Button>
                <Button type="button" variant="ghost" size="icon" className="size-5" aria-label={`Move ${label} right`} disabled={index === row.length - 1} onClick={() => moveWithin(rowIndex, index, 1)}><ArrowRight className="size-3" /></Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-6" aria-label={`Arrange ${label}`}><MoreHorizontal className="size-3.5" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={index === 0} onSelect={() => split(rowIndex, index)}>New line before {label}</DropdownMenuItem>
                    {rows.map((_, destination) => destination !== rowIndex && <DropdownMenuItem key={destination} onSelect={() => moveTo(rowIndex, index, destination)}>Move {label} to line {destination + 1}</DropdownMenuItem>)}
                    <DropdownMenuItem onSelect={() => moveTo(rowIndex, index, rows.length)}>Move {label} to a new line</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>}
            </div>;
          })}
        </div>
      </div>)}
    </div> : <p className="text-xs text-muted-foreground">Add contact details below. Customization becomes available when the resume preview is ready.</p>}
    {custom && <p className="text-xs text-muted-foreground">Join or split lines, or use an item’s menu to move it. Long lines can still wrap to fit this template.{measured?.length ? ` The header currently renders on ${measured.length} line${measured.length === 1 ? '' : 's'}.` : ''}</p>}
  </div>;
}
