/**
 * Token Usage Tracking Service
 * Tracks AI API usage across all providers for cost analysis and debugging
 */

import { randomSuffix } from './store.js';

const STORAGE_KEY = 'resume-designer-token-usage';

// Cost is taken from OpenRouter's reported `usage.cost` (see trackUsage), which
// is accurate for the actual model used — including custom slugs. No local
// pricing table is maintained: slugs span 300+ models and OpenRouter prices drift.

// Default storage structure
const DEFAULT_STORAGE = {
  events: [],
  summary: {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    byModel: {},
    byFeature: {}
  }
};

/**
 * Generate a unique ID for events
 */
function generateEventId() {
  return `evt_${Date.now()}_${randomSuffix()}`;
}

/**
 * Load usage data from localStorage
 */
export function loadUsageData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      // Ensure structure is valid
      return {
        events: data.events || [],
        summary: data.summary || { ...DEFAULT_STORAGE.summary }
      };
    }
  } catch (e) {
    console.error('[TokenTracking] Failed to load usage data:', e);
  }
  return { ...DEFAULT_STORAGE, summary: { ...DEFAULT_STORAGE.summary } };
}

/**
 * Save usage data to localStorage
 */
function saveUsageData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('[TokenTracking] Failed to save usage data:', e);
    return false;
  }
}

/**
 * Track a usage event
 */
export function trackUsage({ provider, model, feature, inputTokens, outputTokens, cacheRead = 0, cacheCreation = 0, cost: reportedCost }) {
  const data = loadUsageData();

  // Cost comes from OpenRouter's reported usage.cost (requested via
  // usage:{include:true} in aiService); 0 if the API didn't return one.
  const cost = (typeof reportedCost === 'number' && !Number.isNaN(reportedCost))
    ? reportedCost
    : 0;
  
  // Create event record
  const event = {
    id: generateEventId(),
    timestamp: new Date().toISOString(),
    provider,
    model,
    feature: feature || 'unknown',
    inputTokens: inputTokens || 0,
    outputTokens: outputTokens || 0,
    cacheRead: cacheRead || 0,
    cacheCreation: cacheCreation || 0,
    cost
  };
  
  // Add to events array
  data.events.push(event);
  
  // Update summary
  data.summary.totalInputTokens += event.inputTokens;
  data.summary.totalOutputTokens += event.outputTokens;
  data.summary.totalCost += cost;
  
  // Update by model. The slug already encodes the provider (provider/model) and
  // is globally unique, so key on it directly — no `anthropic:anthropic/...` doubling.
  const modelKey = model;
  if (!data.summary.byModel[modelKey]) {
    data.summary.byModel[modelKey] = {
      provider,
      model,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      calls: 0
    };
  }
  data.summary.byModel[modelKey].inputTokens += event.inputTokens;
  data.summary.byModel[modelKey].outputTokens += event.outputTokens;
  data.summary.byModel[modelKey].cost += cost;
  data.summary.byModel[modelKey].calls += 1;
  
  // Update by feature
  if (!data.summary.byFeature[feature]) {
    data.summary.byFeature[feature] = {
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      calls: 0
    };
  }
  data.summary.byFeature[feature].inputTokens += event.inputTokens;
  data.summary.byFeature[feature].outputTokens += event.outputTokens;
  data.summary.byFeature[feature].cost += cost;
  data.summary.byFeature[feature].calls += 1;
  
  // Save updated data
  saveUsageData(data);
  
  console.log(`[TokenTracking] Tracked: ${model} - ${feature} - ${inputTokens} in / ${outputTokens} out - $${cost.toFixed(6)}`);
  
  return event;
}

/**
 * Get usage summary
 */
export function getUsageSummary() {
  const data = loadUsageData();
  return data.summary;
}

/**
 * Get all usage events
 */
export function getUsageEvents() {
  const data = loadUsageData();
  return data.events;
}

/**
 * Get usage by date (grouped by day)
 */
export function getUsageByDate() {
  const data = loadUsageData();
  const byDate = {};
  
  for (const event of data.events) {
    const date = event.timestamp.split('T')[0]; // Get YYYY-MM-DD
    if (!byDate[date]) {
      byDate[date] = {
        date,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        calls: 0
      };
    }
    byDate[date].inputTokens += event.inputTokens;
    byDate[date].outputTokens += event.outputTokens;
    byDate[date].cost += event.cost;
    byDate[date].calls += 1;
  }
  
  // Sort by date descending
  return Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Export usage data as JSON
 */
export function exportUsageData() {
  const data = loadUsageData();
  return JSON.stringify(data, null, 2);
}

/**
 * Clear all usage data
 */
export function clearUsageData() {
  const emptyData = { 
    ...DEFAULT_STORAGE, 
    summary: { 
      ...DEFAULT_STORAGE.summary,
      byModel: {},
      byFeature: {}
    } 
  };
  saveUsageData(emptyData);
  console.log('[TokenTracking] Usage data cleared');
  return true;
}

/**
 * Format token count for display
 */
export function formatTokenCount(count) {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(2)}M`;
  } else if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Format cost for display
 */
export function formatCost(cost) {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  } else if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(2)}`;
}
