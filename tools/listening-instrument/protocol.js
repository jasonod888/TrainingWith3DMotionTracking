// Pure protocol helpers for the listening instrument.
//
// Kept free of DOM access so the resume and export logic can be tested directly with node
// (see selftest.mjs). The browser application imports these functions.

export const INSTRUMENT_VERSION = '0.3.0';
export const STORAGE_PREFIX = 'piano-listening-v2:';

// Raw sum of UTF-16 code units. Participant codes are ASCII, so Python's ord() sum agrees.
export function sumCodeUnits(value) {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total += value.charCodeAt(index);
  }
  return total;
}

export function rotationFor(study, listenerId) {
  return sumCodeUnits(listenerId) % study.rotation_count;
}

export function progressKey(analystSha, listenerId, version = INSTRUMENT_VERSION) {
  return `${STORAGE_PREFIX}${String(analystSha)}:${version}:${listenerId}`;
}

export function sanitizeRatings(ratings, items) {
  const valid = {};
  for (const [key, value] of Object.entries(ratings || {})) {
    const parts = key.split('|');
    if (parts.length !== 2) return null;
    const [itemId, rawIndex] = parts;
    const item = items.find((entry) => entry.item_id === itemId);
    if (!item) return null;
    const labelIndex = Number(rawIndex);
    if (!Number.isInteger(labelIndex) || labelIndex < 0 || labelIndex >= item.candidates.length) {
      return null;
    }
    if (!value || typeof value.score !== 'number') return null;
    if (value.item_id !== itemId || value.label_index !== labelIndex) return null;
    if (String(labelIndex) !== rawIndex) return null;
    if (!Number.isFinite(value.score) || value.score < 0 || value.score > 100) return null;
    valid[key] = value;
  }
  return valid;
}

// A saved session is only usable when it belongs to the same study build, instrument version,
// listener and rotation. Anything else is discarded rather than silently resumed.
export function validateProgress(saved, context) {
  if (!saved || typeof saved !== 'object') return { ok: false, reason: 'unreadable progress' };
  if (saved.instrumentVersion !== context.version) {
    return { ok: false, reason: 'instrument version changed' };
  }
  if (saved.studySha !== context.analystSha) return { ok: false, reason: 'study changed' };
  if (saved.rotation !== context.rotation) return { ok: false, reason: 'rotation changed' };
  if (saved.listenerId !== context.listenerId) return { ok: false, reason: 'listener changed' };
  const index = Number(saved.index);
  if (!Number.isInteger(index) || index < 0 || index > context.itemOrderLength) {
    return { ok: false, reason: 'position out of range' };
  }
  const ratings = sanitizeRatings(saved.ratings, context.items);
  if (ratings === null) return { ok: false, reason: 'invalid rating key or score' };
  return {
    ok: true,
    index,
    ratings,
    finished: index >= context.itemOrderLength,
    startedAt: saved.startedAt,
    equipment: saved.equipment,
  };
}

export function sessionPayload({
  listenerId, analystSha, rotation, startedAt, finishedAt, equipment, ratings,
  version = INSTRUMENT_VERSION,
}) {
  const ordered = Object.values(ratings || {}).sort((first, second) =>
    first.item_id.localeCompare(second.item_id) || first.label_index - second.label_index);
  return {
    schema: 'piano-listening-ratings-1',
    instrument_version: version,
    listener_id: listenerId,
    study_sha256: analystSha,
    rotation,
    started_at: startedAt,
    finished_at: finishedAt,
    equipment,
    ratings: ordered,
  };
}
