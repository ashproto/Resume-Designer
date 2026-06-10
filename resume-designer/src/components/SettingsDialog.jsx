import { useCallback, useEffect, useState } from 'react';
import {
  Sun, Moon, Monitor, Eye, EyeOff, X,
  SlidersHorizontal, Sparkles, RefreshCw, Database, BarChart3,
} from 'lucide-react';

import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { confirmDestructive } from '@/components/ui/confirm';
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
import { triggerManualUpdateCheck } from '../updateFlow.js';
import { useUpdateBusy } from '../hooks/useUpdateBusy.js';
import { exportFullBackupWithFeedback, importBackupFromFile } from '../backupFlow.js';

// The Settings panel, rebuilt for the full-shadcn chrome redesign (spec §5.1):
// a multi-section dialog — header (title + muted description + ghost X) over a
// two-column body with a left rail (General / AI / Updates (Tauri-only) / Data /
// Usage) and a scrollable content pane composed entirely from shadcn primitives
// + Tailwind utilities. No bespoke per-panel CSS. It still opens via the
// `rd:open-settings` window event (header gear + chat gears route through
// settingsModal.js's openSettings() shim, which carries a {tab} deep-link — the
// chat panel deep-links to `api-keys`).
//
// All actions wire directly to the service modules: theme / API key / channel /
// auto-update / usage / replay / version, plus Check-for-Updates (updateFlow.js,
// surfacing through Sonner) and backup Export/Import (backupFlow.js). Destructive
// actions (Clear All Keys, Clear usage) confirm via the shared AlertDialog host
// (confirmDestructive) instead of window.confirm().

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

// Tab order matches the original settings modal. Updates is desktop-only.
const TABS = [
  { id: 'general', label: 'General', Icon: SlidersHorizontal },
  { id: 'api-keys', label: 'AI', Icon: Sparkles },
  ...(isTauri ? [{ id: 'updates', label: 'Updates', Icon: RefreshCw }] : []),
  { id: 'data', label: 'Data', Icon: Database },
  { id: 'usage', label: 'Usage', Icon: BarChart3 },
];

// Group heading: 14px/600 title + optional 13px muted subtitle (spec §2.4 / §4).
function GroupTitle({ title, subtitle }) {
  return (
    <div className={subtitle ? 'mb-3.5' : 'mb-2'}>
      <h3 className="text-sm font-semibold leading-none tracking-tight">{title}</h3>
      {subtitle && <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

// Hairline group separator.
function Separator() {
  return <div className="my-5 h-px bg-border" />;
}

// A settings row: label + optional hint on the left, a control on the right.
function SettingRow({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{label}</div>
        {hint && <p className="mt-0.5 max-w-[380px] text-[12.5px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// One of the four Usage stat cards.
function StatCard({ label, value, accent }) {
  return (
    <div className="rounded-lg border bg-background p-3 text-center">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-xl font-semibold tabular-nums', accent ? 'text-primary' : 'text-foreground')}>
        {value}
      </div>
    </div>
  );
}

// A breakdown table for the Usage tab, styled with shadcn Table primitives.
function UsageTable({ headers, rows }) {
  return (
    <div className="max-h-[200px] overflow-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow className="hover:bg-transparent">
            {headers.map((h, i) => (
              <TableHead
                key={h}
                className={cn(
                  'h-9 text-[11px] font-semibold uppercase tracking-wider',
                  i > 0 && 'text-right',
                )}
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={headers.length} className="py-6 text-center italic text-muted-foreground">
                No usage data yet
              </TableCell>
            </TableRow>
          ) : rows.map((cells, i) => (
            <TableRow key={i}>
              {cells.map((c, j) => (
                <TableCell
                  key={j}
                  className={cn(
                    j === 0 ? 'font-medium' : 'text-right tabular-nums',
                  )}
                >
                  {c}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
  const updateBusy = useUpdateBusy();

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

  const handleClearKeys = async () => {
    const ok = await confirmDestructive({
      title: 'Clear all API keys?',
      description: 'Are you sure you want to clear all API keys?',
      actionLabel: 'Clear All Keys',
    });
    if (!ok) return;
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

  const handleClearUsage = async () => {
    const ok = await confirmDestructive({
      title: 'Clear usage data?',
      description: 'Are you sure you want to clear all usage data? This cannot be undone.',
      actionLabel: 'Clear Data',
    });
    if (!ok) return;
    clearUsageData();
    refreshUsage();
  };

  const pickChannel = (value) => { setUpdateChannel(value); setChannel(value); };
  const toggleAutoUpdate = (checked) => { setAutoUpdateCheck(checked); setAutoUpdate(checked); };

  const summary = usage?.summary;
  const totalCalls = summary ? Object.values(summary.byModel).reduce((n, m) => n + m.calls, 0) : 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] w-[90vw] max-w-[720px] flex-col gap-0 overflow-hidden p-0 glass-card"
      >
        <DialogDescription className="sr-only">Manage your preferences and account.</DialogDescription>

        {/* Header */}
        <div className="flex shrink-0 items-start justify-between px-6 py-5">
          <div>
            <DialogTitle className="text-[17px] font-semibold tracking-tight">Settings</DialogTitle>
            <p className="mt-1 text-[13px] text-muted-foreground">Manage your preferences and account.</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="-mr-1 -mt-0.5 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body: rail + content */}
        <div className="grid min-h-0 flex-1 grid-cols-[180px_1fr] border-t">
          <nav className="flex flex-col gap-0.5 border-r bg-muted/40 p-3">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                data-active={tab === id}
                onClick={() => setTab(id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 overflow-y-auto px-6 py-5">
            {/* General */}
            {tab === 'general' && (
              <>
                <section>
                  <GroupTitle title="Appearance" subtitle="Customize how Resume Designer looks on this device." />
                  <label className="mb-2 block text-[13.5px] font-medium">Theme</label>
                  <div className="grid grid-cols-3 gap-2.5">
                    {THEME_OPTIONS.map(({ value, label, Icon }) => {
                      const selected = theme === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => pickTheme(value)}
                          className={cn(
                            'flex flex-col items-center gap-2 rounded-lg border bg-background px-2 py-3.5 text-[13px] font-medium transition-colors',
                            selected
                              ? 'border-primary text-primary shadow-[0_0_0_1px_var(--primary)] [background:color-mix(in_srgb,var(--primary)_4%,var(--background))]'
                              : 'text-foreground hover:bg-accent',
                          )}
                        >
                          <Icon className={cn('h-5 w-5', selected ? 'text-primary' : 'text-muted-foreground')} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {isTauri && (
                  <>
                    <Separator />
                    <section>
                      <GroupTitle title="Updates" />
                      <SettingRow
                        label="Check for updates on launch"
                        hint="Automatically look for new versions when the app starts."
                      >
                        <Switch checked={autoUpdate} onCheckedChange={toggleAutoUpdate} />
                      </SettingRow>
                    </section>
                  </>
                )}

                <Separator />
                <section>
                  <GroupTitle title="Onboarding" />
                  <SettingRow
                    label="Replay welcome guide"
                    hint="Re-run the first-time setup wizard. Your resumes and settings are kept."
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setOpen(false); window.showOnboardingWizard?.(); }}
                    >
                      Replay
                    </Button>
                  </SettingRow>
                </section>

                <Separator />
                <section>
                  <GroupTitle title="About" />
                  <SettingRow label="Version">
                    <Badge variant="secondary" className="font-medium">Resume Designer {version}</Badge>
                  </SettingRow>
                </section>
              </>
            )}

            {/* AI */}
            {tab === 'api-keys' && (
              <>
                <section>
                  <GroupTitle title="OpenRouter" />
                  <label className="mb-2 block text-[13.5px] font-medium" htmlFor="settings-openrouter-key">API Key</label>
                  <div className="flex gap-2">
                    <Input
                      id="settings-openrouter-key"
                      className="flex-1 font-mono"
                      type={showKey ? 'text' : 'password'}
                      placeholder="sk-or-v1-..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Show/hide key"
                      aria-label="Show/hide key"
                      onClick={() => setShowKey((v) => !v)}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
                    Your key is stored locally and is sent only to OpenRouter — never share it. One key covers Claude,
                    GPT, Gemini and 300+ models. Get a key at openrouter.ai/keys
                  </p>
                </section>

                <Separator />
                <section>
                  <GroupTitle title="Model fallback" />
                  <SettingRow
                    label="Automatic fallback"
                    hint="Retry an alternate model if the chosen one is unavailable or rate-limited."
                  >
                    <Switch checked={autoFallback} onCheckedChange={setAutoFallback} />
                  </SettingRow>
                </section>

                <Separator />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={handleClearKeys}>Clear All Keys</Button>
                  <Button type="button" onClick={handleSaveKeys}>Save Settings</Button>
                </div>
              </>
            )}

            {/* Updates (desktop only) */}
            {isTauri && tab === 'updates' && (
              <>
                <section>
                  <GroupTitle title="Update channel" />
                  <Tabs value={channel} onValueChange={pickChannel}>
                    <TabsList>
                      <TabsTrigger value="stable">Stable</TabsTrigger>
                      <TabsTrigger value="beta">Beta</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <p className="mt-2.5 text-[12.5px] leading-snug text-muted-foreground">
                    Beta installs pre-release builds from the{' '}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">next</code> branch.
                    Stable installs only versioned releases.
                  </p>
                  <div className="mt-4">
                    <SettingRow label="Check for updates automatically on launch">
                      <Switch checked={autoUpdate} onCheckedChange={toggleAutoUpdate} />
                    </SettingRow>
                  </div>
                </section>

                <Separator />
                <section>
                  <GroupTitle title="Check now" subtitle={`Current version: ${version}`} />
                  <Button type="button" variant="outline" onClick={triggerManualUpdateCheck} disabled={updateBusy}>
                    {updateBusy ? 'Checking…' : 'Check for Updates'}
                  </Button>
                </section>
              </>
            )}

            {/* Data */}
            {tab === 'data' && (
              <section>
                <GroupTitle
                  title="Backup & restore"
                  subtitle="Save or restore all resumes, settings, job descriptions, and history as a single JSON file."
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={exportFullBackupWithFeedback}>Export Full Backup</Button>
                  <Button asChild variant="outline">
                    <label className="cursor-pointer">
                      Import Backup…
                      <input
                        type="file"
                        accept="application/json,.json"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = ''; // allow re-selecting the same file
                          if (file) importBackupFromFile(file);
                        }}
                      />
                    </label>
                  </Button>
                </div>
              </section>
            )}

            {/* Usage */}
            {tab === 'usage' && (
              <div className="flex flex-col gap-5">
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Total Input" value={summary ? formatTokenCount(summary.totalInputTokens) : '0'} />
                  <StatCard label="Total Output" value={summary ? formatTokenCount(summary.totalOutputTokens) : '0'} />
                  <StatCard label="Est. Cost" value={summary ? formatCost(summary.totalCost) : '$0.00'} accent />
                  <StatCard label="API Calls" value={String(totalCalls)} />
                </div>

                <section>
                  <GroupTitle title="Usage by Model" />
                  <UsageTable
                    headers={['Model', 'Calls', 'Input', 'Output', 'Cost']}
                    rows={summary ? Object.values(summary.byModel).sort((a, b) => b.cost - a.cost).map((d) => [d.model, d.calls, formatTokenCount(d.inputTokens), formatTokenCount(d.outputTokens), formatCost(d.cost)]) : []}
                  />
                </section>

                <section>
                  <GroupTitle title="Usage by Feature" />
                  <UsageTable
                    headers={['Feature', 'Calls', 'Input', 'Output', 'Cost']}
                    rows={summary ? Object.entries(summary.byFeature).sort((a, b) => b[1].cost - a[1].cost).map(([feature, d]) => [feature, d.calls, formatTokenCount(d.inputTokens), formatTokenCount(d.outputTokens), formatCost(d.cost)]) : []}
                  />
                </section>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={handleExportUsage}>Export Data</Button>
                  <Button type="button" variant="outline" onClick={handleClearUsage}>Clear Data</Button>
                  <Button type="button" onClick={refreshUsage}>Refresh</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
