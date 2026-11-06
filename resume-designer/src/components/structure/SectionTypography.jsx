import { useRef, useState } from 'react';
import { Bold, Italic, Underline } from 'lucide-react';
import { clampSectionScale } from '../../sectionLayout.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function SectionScaleInput({ value, onCommit, label }) {
  const [draft, setDraft] = useState(() => String(Math.round((value ?? 1) * 100)));
  const committed = useRef(value);
  const commit = () => {
    const parsed = draft.trim() === '' ? undefined : Number(draft);
    const next = parsed === undefined ? undefined : clampSectionScale(parsed / 100);
    setDraft(String(Math.round((next ?? 1) * 100)));
    if (next !== committed.current) {
      committed.current = next;
      onCommit(next);
    }
  };
  return <Input type="number" className="h-8" min="50" max="200" step="5" aria-label={label}
    value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.blur(); } }} />;
}

export default function SectionTypography({ node, onStyleChange }) {
  return (
    <details className="rounded-md border p-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">{node.children ? 'Heading typography' : 'Title & content typography'}</summary>
      <div className={`mt-3 grid gap-2 ${node.children ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {(node.children ? ['title'] : ['title', 'content']).map(part => {
          const label = part === 'title' ? 'Title' : 'Content';
          return <div key={part} className="space-y-2">
            <Label className="block space-y-1 text-xs text-muted-foreground">{label} size
              <SectionScaleInput value={node[`${part}Scale`]} label={`${label} size`} onCommit={value => onStyleChange(`${part}Scale`, value)} />
            </Label>
            <Select value={node[`${part}Font`] || 'inherit'} onValueChange={value => onStyleChange(`${part}Font`, value === 'inherit' ? undefined : value)}>
              <SelectTrigger className="h-8 text-xs" aria-label={`${label} font`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="inherit">Default font</SelectItem><SelectItem value="display">Display font</SelectItem><SelectItem value="body">Body font</SelectItem></SelectContent>
            </Select>
            <div className="flex gap-1" role="group" aria-label={`${label} formatting`}>
              {[["Bold", Bold], ["Italic", Italic], ["Underline", Underline]].map(([style, Icon]) => {
                const selected = node[`${part}${style}`] ?? (part === 'title' && style === 'Bold');
                return <Button key={style} type="button" variant={selected ? 'secondary' : 'outline'} size="icon" className="size-8"
                  aria-label={`${label} ${style.toLowerCase()}`} aria-pressed={selected} onClick={() => onStyleChange(`${part}${style}`, !selected)}><Icon className="size-3.5" /></Button>;
              })}
            </div>
          </div>;
        })}
      </div>
    </details>
  );
}
