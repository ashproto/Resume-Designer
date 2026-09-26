import { getSettings } from './persistence.js';
import {
  getAllModels,
  getCustomModels,
  getDefaultModelId,
  getSelectableChatModels,
  isSafeModelSlug,
  validateModelId,
} from './aiService.js';

/** Cached app catalog and model preferences only; never returns credentials. */
export function getCompanionModels() {
  const settings = getSettings();
  const mapping = validateModelId(settings.defaultModel || getDefaultModelId());
  const defaults = {
    mapping,
    analysis: validateModelId(settings.analysisModel || mapping),
    tailoring: validateModelId(settings.tailorModel || mapping),
  };
  const models = new Map();
  const add = (id, name = id) => {
    if (isSafeModelSlug(id) && id.includes('/') && id.length <= 256) {
      models.set(id, { id, name: typeof name === 'string' && name ? name : id });
    }
  };
  // Featured entries provide a useful order and an offline first-run fallback.
  for (const model of Object.values(getAllModels()).flat()) add(model.id, model.label);
  for (const model of getSelectableChatModels()) add(model.id, model.name);
  for (const id of [...getCustomModels(), ...Object.values(defaults)]) {
    if (!models.has(id)) add(id);
  }
  return { models: [...models.values()], defaults, autoFallback: Boolean(settings.autoFallback) };
}
