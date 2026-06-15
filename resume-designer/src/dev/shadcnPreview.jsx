// Dev-only gallery to validate the shadcn primitives + the glass theme layer
// (Steps 2-3) BEFORE the real shell is built on top (Step 4). Not an app entry;
// served via preview-shadcn.html on the Vite dev server. Removed in Step 9.
//
// Query params: ?theme=dark sets the theme; ?translucent (handled by the html
// inline script) turns on the desktop glass layer.
import '../../styles/shadcn.css';
import { createRoot } from 'react-dom/client';

import { Button } from '@/components/ui/button';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';

const params = new URLSearchParams(location.search);
const theme = params.get('theme');
if (theme) document.documentElement.dataset.theme = theme;

function Gallery() {
  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
      <h1 className="text-2xl font-semibold text-foreground">shadcn + glass preview</h1>

      <div className="flex flex-wrap gap-3 items-center">
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button disabled>Disabled</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Card title</CardTitle>
          <CardDescription>A frosted card under the desktop shell.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="n">Name</Label>
            <Input id="n" placeholder="Colleen Sinclair" />
          </div>
          <div className="flex items-center gap-2"><Switch id="s" defaultChecked /><Label htmlFor="s">Beta channel</Label></div>
          <div className="flex items-center gap-2"><Checkbox id="c" defaultChecked /><Label htmlFor="c">Check for updates on launch</Label></div>
        </CardContent>
        <CardFooter className="gap-2">
          <Button>Save</Button>
          <Button variant="outline">Cancel</Button>
        </CardFooter>
      </Card>

      <Tabs defaultValue="general" className="w-full">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="text-sm text-muted-foreground pt-2">
          General settings live here.
        </TabsContent>
      </Tabs>

      <div className="flex gap-4 items-start">
        <Popover defaultOpen>
          <PopoverTrigger asChild><Button variant="outline">Popover</Button></PopoverTrigger>
          <PopoverContent>
            <p className="text-sm">Portalled glass content — backdrop-blur samples the page behind it.</p>
          </PopoverContent>
        </Popover>
        <Select>
          <SelectTrigger className="w-40"><SelectValue placeholder="Theme" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Gallery />);
