/**
 * Settings modal — single owner of the app Settings panel.
 *
 * Promoted from a chat-anchored "API settings" modal into a top-level panel
 * reachable from the header gear (and still from the chat panel gear). Every
 * setting is read/written through its existing owner module (persistence.js,
 * theme.js, native.js) so backup/restore (BACKUP_FIXED_KEYS) and the
 * SETTINGS_UPDATED_EVENT bus keep working.
 */

import { getSettings, saveSettings } from './persistence.js';
import { refreshChatPanel } from './chatPanel.js';
import {
  getUsageSummary,
  getUsageByDate,
  exportUsageData,
  clearUsageData,
  formatTokenCount,
  formatCost,
} from './tokenTrackingService.js';
import { setTheme } from './theme.js';
import {
  isTauri,
  getAppInfo,
  getUpdateChannel,
  setUpdateChannel,
  getAutoUpdateCheck,
  setAutoUpdateCheck,
} from './native.js';

// ===== Tab routing =====

/** Activate a settings tab by id (e.g. 'api-keys', 'usage'). */
function activateTab(tabId) {
  if (!tabId) return;
  document.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });
  document.querySelectorAll('.settings-tab-content').forEach((content) => {
    content.classList.toggle('active', content.id === `tab-${tabId}`);
  });
  // The usage tab's numbers can change between opens, so refresh on show.
  if (tabId === 'usage') renderUsageData();
}

// ===== Open / init =====

/**
 * Open the settings panel, optionally to a specific tab. Loads current values
 * into the form first so the panel always reflects persisted state.
 */
export function openSettings(tabId) {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  loadApiKeysToModal();
  syncUpdatesSection();
  loadVersionInfo();
  activateTab(tabId);
  modal.classList.add('show');
}

function closeSettings() {
  document.getElementById('settings-modal')?.classList.remove('show');
}

export function initSettingsModal() {
  const settingsBtn = document.getElementById('chat-settings-btn');
  const modal = document.getElementById('settings-modal');
  const closeBtn = document.getElementById('close-settings-modal');
  const saveBtn = document.getElementById('save-api-keys');
  const clearBtn = document.getElementById('clear-api-keys');

  if (!modal) return;

  // Chat-panel gear opens the panel to the AI tab (preserves prior behavior).
  settingsBtn?.addEventListener('click', () => openSettings('api-keys'));

  closeBtn?.addEventListener('click', closeSettings);

  // Close on overlay (backdrop) click.
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSettings();
  });

  // Close on Escape while the panel is open.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeSettings();
  });

  // Save API keys
  saveBtn?.addEventListener('click', () => {
    saveApiKeysFromModal();
    closeSettings();
  });

  // Clear all keys
  clearBtn?.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all API keys?')) {
      clearAllApiKeys();
      loadApiKeysToModal();
    }
  });

  // Toggle password visibility
  document.querySelectorAll('.api-key-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
      }
    });
  });

  initSettingsTabs();
  initUsagePanel();
  wireGeneralSection();
  wireUpdatesSection();
  applyTauriGating();
}

function initSettingsTabs() {
  document.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });
}

// ===== General tab (appearance + onboarding) =====

function wireGeneralSection() {
  // The theme buttons reuse the `.theme-option` markup, so theme.js's
  // updateThemeUI() keeps their `.selected` state in sync with the header
  // toggle automatically — we only need to drive setTheme on click.
  document.getElementById('settings-theme-options')?.addEventListener('click', (e) => {
    const option = e.target.closest('.theme-option');
    if (option?.dataset.theme) setTheme(option.dataset.theme);
  });

  // Replay the first-time onboarding wizard (exposed on window by main.js).
  // Close Settings first so two modals don't stack.
  document.getElementById('settings-replay-welcome')?.addEventListener('click', () => {
    closeSettings();
    window.showOnboardingWizard?.();
  });
}

// ===== Updates tab (channel + auto-check) =====

function wireUpdatesSection() {
  // Channel segmented control (Stable / Beta). The endpoint switch happens
  // Rust-side at check time; here we just persist the choice.
  document.getElementById('settings-channel-options')?.addEventListener('click', (e) => {
    const seg = e.target.closest('.settings-segment');
    if (!seg?.dataset.channel) return;
    setUpdateChannel(seg.dataset.channel);
    syncChannelSegments();
  });

  // Auto-check-on-launch toggle.
  document.getElementById('auto-update-check-toggle')?.addEventListener('change', (e) => {
    setAutoUpdateCheck(e.target.checked);
  });

  // The "Check for Updates" button is handled by headerBar's delegated click
  // listener, which owns the update-status toast + button-disable flow.
}

function syncChannelSegments() {
  const channel = getUpdateChannel();
  document.querySelectorAll('#settings-channel-options .settings-segment').forEach((seg) => {
    seg.classList.toggle('active', seg.dataset.channel === channel);
  });
}

// Sync Updates-tab controls from persisted state (called on open).
function syncUpdatesSection() {
  syncChannelSegments();
  const autoToggle = document.getElementById('auto-update-check-toggle');
  if (autoToggle) autoToggle.checked = getAutoUpdateCheck();
}

// Hide desktop-only surfaces in the web build (no updater there).
function applyTauriGating() {
  if (isTauri) return;
  document.getElementById('settings-tab-updates')?.style.setProperty('display', 'none');
  document.getElementById('tab-updates')?.classList.remove('active');
}

// Populate app-version labels (desktop only; getAppInfo is a Tauri call).
function loadVersionInfo() {
  if (!isTauri) return;
  getAppInfo()
    .then((info) => {
      const version = info?.version || '—';
      const generalEl = document.getElementById('settings-app-version');
      const updatesEl = document.getElementById('settings-updates-version');
      if (generalEl) generalEl.textContent = version;
      if (updatesEl) updatesEl.textContent = version;
    })
    .catch(() => {});
}

// ===== Usage tab (token usage) =====

function initUsagePanel() {
  document.getElementById('refresh-usage-data')?.addEventListener('click', renderUsageData);

  document.getElementById('export-usage-data')?.addEventListener('click', () => {
    const data = exportUsageData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `token-usage-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

  document.getElementById('clear-usage-data')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all usage data? This cannot be undone.')) {
      clearUsageData();
      renderUsageData();
    }
  });
}

/** Build a <tr> from an array of cell values; cells are set via textContent. */
function usageRow(cells, firstCellClass) {
  const tr = document.createElement('tr');
  cells.forEach((value, i) => {
    const td = document.createElement('td');
    if (i === 0 && firstCellClass) td.className = firstCellClass;
    td.textContent = String(value);
    tr.appendChild(td);
  });
  return tr;
}

/** Replace a tbody's rows, or show the empty-state row when there are none. */
function fillUsageTable(tbody, rows) {
  if (!tbody) return;
  tbody.replaceChildren();
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'usage-empty-row';
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = 'No usage data yet';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  rows.forEach((row) => tbody.appendChild(row));
}

// Render token-usage stats into the usage tab. Values are set via
// textContent (not innerHTML) so usage labels can never inject markup.
function renderUsageData() {
  const summary = getUsageSummary();
  const byDate = getUsageByDate();

  // Summary stat cards
  const inputEl = document.getElementById('total-input-tokens');
  const outputEl = document.getElementById('total-output-tokens');
  const costEl = document.getElementById('total-cost');
  const callsEl = document.getElementById('total-calls');
  if (inputEl) inputEl.textContent = formatTokenCount(summary.totalInputTokens);
  if (outputEl) outputEl.textContent = formatTokenCount(summary.totalOutputTokens);
  if (costEl) costEl.textContent = formatCost(summary.totalCost);

  let totalCalls = 0;
  Object.values(summary.byModel).forEach((m) => (totalCalls += m.calls));
  if (callsEl) callsEl.textContent = String(totalCalls);

  // Usage by model
  const modelRows = Object.entries(summary.byModel)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([, data]) =>
      usageRow(
        [data.model, data.calls, formatTokenCount(data.inputTokens), formatTokenCount(data.outputTokens), formatCost(data.cost)],
        'usage-model-name'
      )
    );
  fillUsageTable(document.getElementById('usage-by-model'), modelRows);

  // Usage by feature
  const featureRows = Object.entries(summary.byFeature)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([feature, data]) =>
      usageRow(
        [feature, data.calls, formatTokenCount(data.inputTokens), formatTokenCount(data.outputTokens), formatCost(data.cost)],
        'usage-feature-name'
      )
    );
  fillUsageTable(document.getElementById('usage-by-feature'), featureRows);

  // Usage by date (last 30 days)
  const dateRows = byDate
    .slice(0, 30)
    .map((data) =>
      usageRow([data.date, data.calls, formatTokenCount(data.inputTokens), formatTokenCount(data.outputTokens), formatCost(data.cost)])
    );
  fillUsageTable(document.getElementById('usage-by-date'), dateRows);
}

// ===== AI tab (API key + fallback) =====

/** Load API key + settings into modal inputs. Exported: main.js re-syncs the
 *  panel when SETTINGS_UPDATED_EVENT fires while it's open. */
export function loadApiKeysToModal() {
  const settings = getSettings();
  const keyInput = document.getElementById('openrouter-key');
  const fallbackToggle = document.getElementById('auto-fallback-toggle');

  if (keyInput) keyInput.value = settings.openrouterKey || '';
  if (fallbackToggle) fallbackToggle.checked = !!settings.autoFallback;
}

function saveApiKeysFromModal() {
  const keyInput = document.getElementById('openrouter-key');
  const fallbackToggle = document.getElementById('auto-fallback-toggle');

  saveSettings({
    openrouterKey: keyInput?.value || '',
    autoFallback: !!fallbackToggle?.checked,
  });

  // Refresh chat panel UI to reflect the new configuration
  refreshChatPanel();
}

function clearAllApiKeys() {
  saveSettings({ openrouterKey: '' });

  // Refresh chat panel UI to reflect the cleared key
  refreshChatPanel();
}
