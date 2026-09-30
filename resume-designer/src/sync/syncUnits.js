/**
 * Splitting `resume-designer-data` into sync units, and putting it back.
 *
 * That one file holds every résumé plus `currentVariantId`, `settings` and
 * `userProfile`. A record per storage key would therefore make editing résumé
 * A on a phone collide with résumé B on a Mac and silently discard one — the
 * central case for a résumé app, not an edge case. So the blob is decomposed.
 *
 * The on-disk format is untouched: this is a view for the sync layer only, and
 * `mergeData` reassembles exactly what was there.
 *
 * Pure — no storage, no DOM.
 */

import {
  withoutSettingsCredential, withoutDeadProviderSettings, CHANGELOG_SEEN_FIELD,
} from '../profileKeys.js';

export const RESUME_UNIT_PREFIX = 'resume:';

/** Top-level blob keys that become their own units. */
const PLAIN_FIELDS = ['settings', 'userProfile'];

/**
 * The credential never crosses this boundary, in EITHER direction.
 *
 * The API key lives in the OS keychain and syncs through iCloud Keychain, so
 * `settings.openrouterKey` is only ever a leftover — a blob whose plaintext
 * cleanup has not yet flushed, or an older backup restored over the top.
 * Leftover or not, it is a paid credential, and `splitData` would serialize it
 * into `data:settings` and put it in CloudKit. The standalone key's device-local
 * classification does not protect it here: that rule is about the key's OWN
 * storage key, and this is a different unit that merely contains it.
 *
 * Applied inbound as well, so a record uploaded by an older build cannot put
 * the plaintext copy back on a device that has already cleaned itself up.
 *
 * The same goes for the pre-OpenRouter provider keys the Electron migration
 * carried in (profileKeys.js's withoutDeadProviderSettings). Nothing reads them,
 * but a blob the boot sweep has not cleaned yet still holds them — and because
 * the payload is also what decides whether the unit CHANGED, the sweep removing
 * them used to stamp `data:settings` as a fresh edit.
 *
 * Nor do the fields of `settings` that describe THIS INSTALL rather than the
 * person (`DEVICE_SETTINGS_FIELDS`). They stay on the device the way
 * `currentVariantId` does, and for a reason beyond tidiness: a unit's payload is
 * also what decides whether it CHANGED (`changedDataUnits` in syncModel.js).
 * With the release-notes record inside it, every app update made each device's
 * settings the newest copy, and a fresh install's first-run record made its
 * DEFAULT settings look like something a person had written.
 */
const DEVICE_SETTINGS_FIELDS = [CHANGELOG_SEEN_FIELD];

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

const withoutDeviceSettings = (settings) => {
  if (!isPlainObject(settings)) return settings;
  if (!DEVICE_SETTINGS_FIELDS.some((key) => key in settings)) return settings;
  const next = { ...settings };
  for (const key of DEVICE_SETTINGS_FIELDS) delete next[key];
  return next;
};

/** A field's value as it crosses the boundary, in either direction. */
function withoutLocalOnly(field, value) {
  if (field !== 'settings') return value;
  return withoutDeviceSettings(withoutDeadProviderSettings(withoutSettingsCredential(value)));
}

/**
 * A landed `settings` keeps THIS device's own fields. The unit carried none of
 * them, and landing replaces the field whole, so without this a pull erased
 * which release's notes this install had shown and the next launch took it for
 * a first run.
 */
function keepDeviceSettings(field, landed, local) {
  if (field !== 'settings' || !isPlainObject(landed) || !isPlainObject(local)) return landed;
  const kept = DEVICE_SETTINGS_FIELDS.filter((key) => key in local);
  if (kept.length === 0) return landed;
  const next = { ...landed };
  for (const key of kept) next[key] = local[key];
  return next;
}

/**
 * `currentVariantId` is absent from this list ON PURPOSE and must stay absent:
 * which résumé is open is a property of a device.
 */
export function splitData(blob) {
  if (!blob || typeof blob !== 'object') return [];
  const units = [];

  const variants = blob.variants;
  if (variants && typeof variants === 'object') {
    for (const [id, variant] of Object.entries(variants)) {
      units.push({
        id: `${RESUME_UNIT_PREFIX}${id}`,
        kind: 'resume',
        payload: JSON.stringify(variant),
      });
    }
  }

  for (const field of PLAIN_FIELDS) {
    if (blob[field] !== undefined) {
      units.push({
        id: `data:${field}`,
        kind: 'plain',
        payload: JSON.stringify(withoutLocalOnly(field, blob[field])),
      });
    }
  }

  return units;
}

/**
 * Reassemble, without mutating `blob`.
 *
 * Unknown top-level keys are carried through untouched: a key added to the
 * document after this code was written must survive a sync round trip.
 */
export function mergeData(blob, units) {
  const base = blob && typeof blob === 'object' ? blob : {};
  const next = { ...base, variants: { ...(base.variants || {}) } };

  for (const unit of Array.isArray(units) ? units : []) {
    if (!unit || typeof unit.payload !== 'string') continue;
    let value;
    try {
      value = JSON.parse(unit.payload);
    } catch {
      // A corrupt payload is skipped rather than allowed to throw: one bad
      // record must not stop the rest of a sync landing.
      continue;
    }
    if (unit.id.startsWith(RESUME_UNIT_PREFIX)) {
      next.variants[unit.id.slice(RESUME_UNIT_PREFIX.length)] = value;
    } else if (unit.id.startsWith('data:')) {
      const field = unit.id.slice('data:'.length);
      if (PLAIN_FIELDS.includes(field)) {
        next[field] = keepDeviceSettings(field, withoutLocalOnly(field, value), base[field]);
      }
    }
  }

  return next;
}
