import { useCallback, useEffect, useState } from 'react';
import { Sun, Moon, Monitor, Eye, EyeOff } from 'lucide-react';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { getSettings, saveSettings } from '../persistence.js';
import { refreshChatPanel } from '../chatPanel.js';
import { getTheme, setTheme } from '../theme.js';
import {
  isTauri, getAppInfo, getUpdateChannel, setUpdateChannel,
  getAutoUpdateCheck, setAutoUpdateCheck,
} from '../native.js';
import {
  getUsageSummary, getUsageByDate, exportUsageData, clearUsageData,
  formatTokenCount, formatCost,
} from '../tokenTrackingService.js';

// The Settings panel, converted from the static #settings-modal + settingsModal.js
// to a shadcn Dialog. It opens via the `rd:open-settings` window event dispatched
// by settingsModal.js's openSettings() shim (header + chat gears route through it).
//
// Wiring split (temporary, until headerBar converts in Step 6): this component
// drives theme / API key / channel / auto-update / usage / replay / version
// directly through the service modules. The Check-for-Updates and backup
// Export/Import buttons keep their legacy ids so headerBar.js's document-level
// delegated handlers (which own the update-status toast + backup/reload flows)
// continue to handle them unchanged.

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

function UsageTable({ headers, rows, firstCol }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>{headers.map((h) => <th key={h} className="px-3 py-1.5 text-left font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} className="px-3 py-3 text-center text-muted-foreground">No usage data yet</td></tr>
          ) : rows.map((cells, i) => (
            <tr key={i} className="border-t border-border">
              {cells.map((c, j) => (
                <td key={j} className={cn('px-3 py-1.5', j === 0 && firstCol)}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('general');

  // Form/display state, seeded from the services each time the dialog opens.
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [autoFallback, setAutoFallback] = useState(false);
  const [theme, setThemeState] = useState('system');
  const [channel, setChannel] = useState('stable');
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [version, setVersion] = useState('—');
  const [usage, setUsage] = useState(null);

  const refreshUsage = useCallback(() => {
    setUsage({ summary: getUsageSummary(), byDate: getUsageByDate() });
  }, []);

  // Seed all fields from persisted state.
  const seed = useCallback(() => {
    const s = getSettings();
    setApiKey(s.openrouterKey || '');
    setAutoFallback(!!s.autoFallback);
    setThemeState(getTheme());
    if (isTauri) {
      setChannel(getUpdateChannel());
      setAutoUpdate(getAutoUpdateCheck());
      getAppInfo().then((info) => setVersion(info?.version || '—')).catch(() => {});
    }
    refreshUsage();
  }, [refreshUsage]);

  // Open via the gears (window event), seeding to the requested tab.
  useEffect(() => {
    const onOpen = (e) => {
      seed();
      setTab(e.detail?.tab || 'general');
      setOpen(true);
    };
    window.addEventListener('rd:open-settings', onOpen);
    return () => window.removeEventListener('rd:open-settings', onOpen);
  }, [seed]);

  // Keep the theme selection in sync if it's changed elsewhere (header toggle).
  useEffect(() => {
    const onThemeChange = (e) => setThemeState(e.detail?.theme ?? getTheme());
    window.addEventListener('themechange', onThemeChange);
    return () => window.removeEventListener('themechange', onThemeChange);
  }, []);

  const pickTheme = (value) => { setTheme(value); setThemeState(value); };

  const handleSaveKeys = () => {
    saveSettings({ openrouterKey: apiKey, autoFallback });
    refreshChatPanel();
    setOpen(false);
  };

  const handleClearKeys = () => {
    if (!window.confirm('Are you sure you want to clear all API keys?')) return;
    saveSettings({ openrouterKey: '' });
    refreshChatPanel();
    setApiKey('');
  };

  const handleExportUsage = () => {
    const blob = new Blob([exportUsageData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `token-usage-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleClearUsage = () => {
    if (!window.confirm('Are you sure you want to clear all usage data? This cannot be undone.')) return;
    clearUsageData();
    refreshUsage();
  };

  const pickChannel = (value) => { setUpdateChannel(value); setChannel(value); };
  const toggleAutoUpdate = (checked) => { setAutoUpdateCheck(checked); setAutoUpdate(checked); };

  const summary = usage?.summary;
  const totalCalls = summary ? Object.values(summary.byModel).reduce((n, m) => n + m.calls, 0) : 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl glass-card">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">Application settings</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="api-keys">AI</TabsTrigger>
            {isTauri && <TabsTrigger value="updates">Updates</TabsTrigger>}
            <TabsTrigger value="data">Data</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>

          {/* General */}
          <TabsContent value="general" className="space-y-6 pt-4">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Appearance</h3>
              <Label>Theme</Label>
              <div className="flex gap-2">
                {THEME_OPTIONS.map(({ value, label, Icon }) => (
                  <Button
                    key={value}
                    type="button"
                    variant={theme === value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => pickTheme(value)}
                  >
                    <Icon /> {label}
                  </Button>
                ))}
              </div>
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Onboarding</h3>
              <Button
                variant="secondary"
                onClick={() => { setOpen(false); window.showOnboardingWizard?.(); }}
              >
                Replay welcome guide
              </Button>
              <p className="text-xs text-muted-foreground">Re-run the first-time setup wizard. Your resumes and settings are kept.</p>
            </section>
            <section className="space-y-1">
              <h3 className="text-sm font-semibold">About</h3>
              <p className="text-xs text-muted-foreground">Resume Designer <span>{version}</span></p>
            </section>
          </TabsContent>

          {/* AI */}
          <TabsContent value="api-keys" className="space-y-6 pt-4">
            <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              Your OpenRouter API key is stored locally and is sent only to OpenRouter. Never share it.
            </p>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">OpenRouter</h3>
              <Label htmlFor="settings-openrouter-key">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="settings-openrouter-key"
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-or-v1-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((v) => !v)} title="Show/hide">
                  {showKey ? <EyeOff /> : <Eye />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">One key for Claude, GPT, Gemini and 300+ models. Get a key at openrouter.ai/keys</p>
            </section>
            <section className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Model fallback</h3>
                <p className="text-xs text-muted-foreground">Retry an alternate model if the chosen one is unavailable or rate-limited.</p>
              </div>
              <Switch checked={autoFallback} onCheckedChange={setAutoFallback} />
            </section>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={handleClearKeys}>Clear All Keys</Button>
              <Button onClick={handleSaveKeys}>Save Settings</Button>
            </div>
          </TabsContent>

          {/* Updates (Tauri only) */}
          {isTauri && (
            <TabsContent value="updates" className="space-y-6 pt-4">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Update channel</h3>
                <div className="inline-flex rounded-md border border-border p-0.5">
                  {['stable', 'beta'].map((c) => (
                    <Button key={c} type="button" size="sm" variant={channel === c ? 'default' : 'ghost'} onClick={() => pickChannel(c)} className="capitalize">
                      {c}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Beta installs pre-release builds from the <code>next</code> branch. Stable installs only versioned releases.</p>
                <label className="flex items-center gap-2 pt-1 text-sm">
                  <Switch checked={autoUpdate} onCheckedChange={toggleAutoUpdate} />
                  Check for updates automatically on launch
                </label>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Check now</h3>
                {/* Legacy id: headerBar.js's delegated handler owns the check flow + toast. */}
                <Button id="settings-check-updates" variant="secondary">Check for Updates</Button>
                <p className="text-xs text-muted-foreground">Current version: <span>{version}</span></p>
              </section>
            </TabsContent>
          )}

          {/* Data */}
          <TabsContent value="data" className="space-y-4 pt-4">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Backup &amp; restore</h3>
              <p className="text-xs text-muted-foreground">Save or restore all resumes, settings, job descriptions, and history as a single JSON file.</p>
              <div className="flex gap-2">
                {/* Legacy ids: headerBar.js's delegated click/change handlers own the backup flow. */}
                <Button id="settings-export-backup" variant="secondary">Export Full Backup</Button>
                <label id="settings-import-backup" className={cn(buttonVariants({ variant: 'secondary' }), 'cursor-pointer')}>
                  Import Backup…
                  <input id="settings-import-backup-file" type="file" accept="application/json,.json" hidden />
                </label>
              </div>
            </section>
          </TabsContent>

          {/* Usage */}
          <TabsContent value="usage" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Total Input', summary ? formatTokenCount(summary.totalInputTokens) : '0'],
                ['Total Output', summary ? formatTokenCount(summary.totalOutputTokens) : '0'],
                ['Est. Cost', summary ? formatCost(summary.totalCost) : '$0.00'],
                ['API Calls', String(totalCalls)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-lg font-semibold">{value}</div>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <h4 className="text-sm font-medium">Usage by Model</h4>
              <UsageTable
                headers={['Model', 'Calls', 'Input', 'Output', 'Cost']}
                firstCol="font-medium"
                rows={summary ? Object.values(summary.byModel).sort((a, b) => b.cost - a.cost).map((d) => [d.model, d.calls, formatTokenCount(d.inputTokens), formatTokenCount(d.outputTokens), formatCost(d.cost)]) : []}
              />
            </div>

            <div className="space-y-1">
              <h4 className="text-sm font-medium">Usage by Feature</h4>
              <UsageTable
                headers={['Feature', 'Calls', 'Input', 'Output', 'Cost']}
                rows={summary ? Object.entries(summary.byFeature).sort((a, b) => b[1].cost - a[1].cost).map(([feature, d]) => [feature, d.calls, formatTokenCount(d.inputTokens), formatTokenCount(d.outputTokens), formatCost(d.cost)]) : []}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={handleExportUsage}>Export Data</Button>
              <Button variant="secondary" onClick={handleClearUsage}>Clear Data</Button>
              <Button onClick={refreshUsage}>Refresh</Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
