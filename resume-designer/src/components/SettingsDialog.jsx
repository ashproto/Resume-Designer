import { useCallback, useEffect, useState } from 'react';
import {
  Sun, Moon, Monitor, Eye, EyeOff,
  SlidersHorizontal, Sparkles, RefreshCw, Database, BarChart3,
} from 'lucide-react';

import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
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

// The Settings panel, converted from the static #settings-modal + settingsModal.js
// to a shadcn Dialog (Step 5), then restyled (consistency fix) to reuse the
// original `.settings-*` / `.modal-*` / `.usage-*` / `.btn` design language that
// still lives in styles/main.css. Like ProfileDialog and JobsDialog, it hosts
// bespoke-classed markup inside a glass shadcn Dialog shell rather than rendering
// raw shadcn Tabs/Button/Input/Switch (which defaulted to the unstyled shadcn
// look). It opens via the `rd:open-settings` window event dispatched by
// settingsModal.js's openSettings() shim (header + chat gears route through it).
//
// All actions wire directly to the service modules: theme / API key / channel /
// auto-update / usage / replay / version, plus Check-for-Updates (updateFlow.js,
// surfacing through Sonner) and backup Export/Import (backupFlow.js).

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

// Reusable breakdown table for the Usage tab (reuses the .usage-table styles).
function UsageTable({ headers, rows, firstColClass }) {
  return (
    <div className="usage-table-container">
      <div className="usage-table-scrollable">
        <table className="usage-table">
          <thead>
            <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="usage-empty-row"><td colSpan={headers.length}>No usage data yet</td></tr>
            ) : rows.map((cells, i) => (
              <tr key={i}>
                {cells.map((c, j) => (
                  <td key={j}>{j === 0 && firstColClass ? <span className={firstColClass}>{c}</span> : c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] w-[90vw] max-w-[640px] flex-col gap-0 overflow-hidden p-0 glass-card"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Application settings</DialogDescription>

        <div className="modal-header shrink-0">
          <h2 className="modal-title">Settings</h2>
          <button type="button" className="modal-close" title="Close" onClick={() => setOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-tabs shrink-0">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={cn('settings-tab', tab === id && 'active')}
              onClick={() => setTab(id)}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>

        <div className="modal-content min-h-0 flex-1">
          {/* General */}
          {tab === 'general' && (
            <>
              <div className="settings-section">
                <h3 className="settings-section-title">Appearance</h3>
                <div className="settings-theme-options">
                  {THEME_OPTIONS.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      className={cn('theme-option', theme === value && 'selected')}
                      onClick={() => pickTheme(value)}
                    >
                      <Icon size={16} /> {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-section">
                <h3 className="settings-section-title">Onboarding</h3>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setOpen(false); window.showOnboardingWizard?.(); }}
                >
                  Replay welcome guide
                </button>
                <p className="settings-hint">Re-run the first-time setup wizard. Your resumes and settings are kept.</p>
              </div>
              <div className="settings-section">
                <h3 className="settings-section-title">About</h3>
                <p className="settings-hint">Resume Designer {version}</p>
              </div>
            </>
          )}

          {/* AI */}
          {tab === 'api-keys' && (
            <>
              <div className="settings-section">
                <h3 className="settings-section-title">OpenRouter</h3>
                <label className="form-label" htmlFor="settings-openrouter-key">API Key</label>
                <div className="api-key-input-wrapper">
                  <input
                    id="settings-openrouter-key"
                    className="form-input api-key-input"
                    type={showKey ? 'text' : 'password'}
                    placeholder="sk-or-v1-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <button type="button" className="api-key-toggle" title="Show/hide key" onClick={() => setShowKey((v) => !v)}>
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="settings-hint">
                  Your key is stored locally and is sent only to OpenRouter — never share it. One key covers Claude,
                  GPT, Gemini and 300+ models. Get a key at openrouter.ai/keys
                </p>
              </div>
              <div className="settings-section">
                <h3 className="settings-section-title">Model fallback</h3>
                <label className="settings-checkbox">
                  <input type="checkbox" checked={autoFallback} onChange={(e) => setAutoFallback(e.target.checked)} />
                  <span>Retry an alternate model if the chosen one is unavailable or rate-limited.</span>
                </label>
              </div>
              <div className="settings-actions">
                <button type="button" className="btn btn-secondary" onClick={handleClearKeys}>Clear All Keys</button>
                <button type="button" className="btn btn-primary" onClick={handleSaveKeys}>Save Settings</button>
              </div>
            </>
          )}

          {/* Updates (desktop only) */}
          {isTauri && tab === 'updates' && (
            <>
              <div className="settings-section">
                <h3 className="settings-section-title">Update channel</h3>
                <div className="settings-segmented">
                  {[['stable', 'Stable'], ['beta', 'Beta']].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={cn('settings-segment', channel === value && 'active')}
                      onClick={() => pickChannel(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="settings-hint">
                  Beta installs pre-release builds from the <code>next</code> branch. Stable installs only versioned releases.
                </p>
                <label className="settings-checkbox mt-3">
                  <input type="checkbox" checked={autoUpdate} onChange={(e) => toggleAutoUpdate(e.target.checked)} />
                  <span>Check for updates automatically on launch</span>
                </label>
              </div>
              <div className="settings-section">
                <h3 className="settings-section-title">Check now</h3>
                <button type="button" className="btn btn-secondary" onClick={triggerManualUpdateCheck} disabled={updateBusy}>
                  {updateBusy ? 'Checking…' : 'Check for Updates'}
                </button>
                <p className="settings-hint">Current version: {version}</p>
              </div>
            </>
          )}

          {/* Data */}
          {tab === 'data' && (
            <div className="settings-section">
              <h3 className="settings-section-title">Backup &amp; restore</h3>
              <p className="settings-hint">Save or restore all resumes, settings, job descriptions, and history as a single JSON file.</p>
              <div className="settings-actions-left">
                <button type="button" className="btn btn-secondary" onClick={exportFullBackupWithFeedback}>Export Full Backup</button>
                <label className="btn btn-secondary">
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
              </div>
            </div>
          )}

          {/* Usage */}
          {tab === 'usage' && (
            <div className="usage-section">
              <div className="usage-summary">
                {[
                  ['Total Input', summary ? formatTokenCount(summary.totalInputTokens) : '0', false],
                  ['Total Output', summary ? formatTokenCount(summary.totalOutputTokens) : '0', false],
                  ['Est. Cost', summary ? formatCost(summary.totalCost) : '$0.00', true],
                  ['API Calls', String(totalCalls), false],
                ].map(([label, value, isCost]) => (
                  <div key={label} className="usage-stat-card">
                    <div className="usage-stat-label">{label}</div>
                    <div className={cn('usage-stat-value', isCost && 'usage-cost')}>{value}</div>
                  </div>
                ))}
              </div>

              <div className="usage-breakdown">
                <h4 className="usage-breakdown-title">Usage by Model</h4>
                <UsageTable
                  headers={['Model', 'Calls', 'Input', 'Output', 'Cost']}
                  firstColClass="usage-model-name"
                  rows={summary ? Object.values(summary.byModel).sort((a, b) => b.cost - a.cost).map((d) => [d.model, d.calls, formatTokenCount(d.inputTokens), formatTokenCount(d.outputTokens), formatCost(d.cost)]) : []}
                />
              </div>

              <div className="usage-breakdown">
                <h4 className="usage-breakdown-title">Usage by Feature</h4>
                <UsageTable
                  headers={['Feature', 'Calls', 'Input', 'Output', 'Cost']}
                  firstColClass="usage-feature-name"
                  rows={summary ? Object.entries(summary.byFeature).sort((a, b) => b[1].cost - a[1].cost).map(([feature, d]) => [feature, d.calls, formatTokenCount(d.inputTokens), formatTokenCount(d.outputTokens), formatCost(d.cost)]) : []}
                />
              </div>

              <div className="settings-actions-left">
                <button type="button" className="btn btn-secondary" onClick={handleExportUsage}>Export Data</button>
                <button type="button" className="btn btn-secondary" onClick={handleClearUsage}>Clear Data</button>
                <button type="button" className="btn btn-primary" onClick={refreshUsage}>Refresh</button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
