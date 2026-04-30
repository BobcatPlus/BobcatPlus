// ============================================================
// TERM PREFS — calendar blocks + avoid-days keyed by Banner
// term code and plan key (SCRUM-21).
// Storage structure: calendarBlocksByTerm[term][planKey] = blocks[]
// Legacy flat keys and old per-term arrays are migrated on load.
// ============================================================

import * as State from "./state.js";

export const KEYS = {
  blocksByTerm: "calendarBlocksByTerm",
  daysByTerm: "avoidDaysByTerm",
};

export const LEGACY_BLOCKS = "calendarBlocks";
export const LEGACY_DAYS = "avoidDays";

/** Keys to read on boot / when switching terms (legacy + new). */
export const CALENDAR_PREFS_STORAGE_KEYS = [
  KEYS.blocksByTerm,
  KEYS.daysByTerm,
  LEGACY_BLOCKS,
  LEGACY_DAYS,
];

// In-memory cache so plan switches don't need a storage round-trip.
let _blocksByTermPlan = Object.create(null); // { term: { planKey: blocks[] } }
let _daysByTermPlan = Object.create(null);

export function storageLocalGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

export function storageLocalSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, resolve);
  });
}

export function storageLocalRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

/**
 * Hydrate State.calendarBlocks / State.avoidDays from the in-memory cache
 * for the given term + planKey.
 */
export function hydrateCalendarPrefsForTerm(term, planKey) {
  const t = String(term);
  const pk = String(planKey || "registered");
  const termBlocks = _blocksByTermPlan[t];
  const termDays = _daysByTermPlan[t];
  const b = termBlocks && termBlocks[pk];
  const d = termDays && termDays[pk];
  State.setCalendarBlocks(Array.isArray(b) ? b : []);
  State.setAvoidDays(Array.isArray(d) ? d : []);
  if (State.studentProfile) {
    State.studentProfile.calendarBlocks = State.calendarBlocks;
    State.studentProfile.avoidDays = State.avoidDays;
  }
}

/**
 * Resolve maps from a chrome.storage.local result, migrate legacy flat
 * keys and old array-format values, persist if anything changed,
 * populate the in-memory cache, and return the maps.
 */
export async function resolveAndMigrateCalendarPrefs(raw, term) {
  const t = String(term);
  let blocksByTermPlan = Object.create(null);
  let daysByTermPlan = Object.create(null);
  let mapsChanged = false;
  const removeLegacy = [];

  // Parse calendarBlocksByTerm — may be old { term: blocks[] } or new { term: { planKey: blocks[] } }
  const rawBlocks = raw[KEYS.blocksByTerm];
  if (rawBlocks && typeof rawBlocks === "object") {
    for (const termCode of Object.keys(rawBlocks)) {
      const val = rawBlocks[termCode];
      if (Array.isArray(val)) {
        // Old format: migrate to { registered: [...] }
        blocksByTermPlan[termCode] = Object.create(null);
        blocksByTermPlan[termCode]["registered"] = val.slice();
        mapsChanged = true;
      } else if (val && typeof val === "object") {
        blocksByTermPlan[termCode] = Object.create(null);
        for (const pk of Object.keys(val)) {
          const v = val[pk];
          blocksByTermPlan[termCode][pk] = Array.isArray(v) ? v.slice() : [];
        }
      }
    }
  }

  // Parse avoidDaysByTerm — same two-format handling
  const rawDays = raw[KEYS.daysByTerm];
  if (rawDays && typeof rawDays === "object") {
    for (const termCode of Object.keys(rawDays)) {
      const val = rawDays[termCode];
      if (Array.isArray(val)) {
        daysByTermPlan[termCode] = Object.create(null);
        daysByTermPlan[termCode]["registered"] = val.slice();
        mapsChanged = true;
      } else if (val && typeof val === "object") {
        daysByTermPlan[termCode] = Object.create(null);
        for (const pk of Object.keys(val)) {
          const v = val[pk];
          daysByTermPlan[termCode][pk] = Array.isArray(v) ? v.slice() : [];
        }
      }
    }
  }

  // Migrate legacy flat calendarBlocks key into registered slot
  if (Object.prototype.hasOwnProperty.call(raw, LEGACY_BLOCKS)) {
    if (!blocksByTermPlan[t]) blocksByTermPlan[t] = Object.create(null);
    if (blocksByTermPlan[t]["registered"] === undefined) {
      blocksByTermPlan[t]["registered"] = Array.isArray(raw[LEGACY_BLOCKS]) ? raw[LEGACY_BLOCKS] : [];
      mapsChanged = true;
    }
    removeLegacy.push(LEGACY_BLOCKS);
  }

  // Migrate legacy flat avoidDays key into registered slot
  if (Object.prototype.hasOwnProperty.call(raw, LEGACY_DAYS)) {
    if (!daysByTermPlan[t]) daysByTermPlan[t] = Object.create(null);
    if (daysByTermPlan[t]["registered"] === undefined) {
      const a = raw[LEGACY_DAYS];
      daysByTermPlan[t]["registered"] = Array.isArray(a) ? a.slice() : [];
      mapsChanged = true;
    }
    removeLegacy.push(LEGACY_DAYS);
  }

  if (mapsChanged) {
    await storageLocalSet({
      [KEYS.blocksByTerm]: blocksByTermPlan,
      [KEYS.daysByTerm]: daysByTermPlan,
    });
  }
  if (removeLegacy.length) {
    await storageLocalRemove([...new Set(removeLegacy)]);
  }

  _blocksByTermPlan = blocksByTermPlan;
  _daysByTermPlan = daysByTermPlan;

  return { blocksByTermPlan, daysByTermPlan };
}

/** Load maps from storage for `term` + `planKey`, migrate legacy if present, hydrate State. */
export async function loadCalendarPrefsForTerm(term, planKey) {
  const raw = await storageLocalGet([
    KEYS.blocksByTerm,
    KEYS.daysByTerm,
    LEGACY_BLOCKS,
    LEGACY_DAYS,
  ]);
  await resolveAndMigrateCalendarPrefs(raw, term);
  hydrateCalendarPrefsForTerm(term, planKey);
}

export async function persistCalendarBlocksForTerm(term, planKey, blocks) {
  const t = String(term);
  const pk = String(planKey || "registered");
  if (!_blocksByTermPlan[t]) _blocksByTermPlan[t] = Object.create(null);
  _blocksByTermPlan[t][pk] = blocks;
  await storageLocalSet({ [KEYS.blocksByTerm]: _blocksByTermPlan });
}

export async function persistAvoidDaysForTerm(term, planKey, days) {
  const t = String(term);
  const pk = String(planKey || "registered");
  if (!_daysByTermPlan[t]) _daysByTermPlan[t] = Object.create(null);
  _daysByTermPlan[t][pk] = days;
  await storageLocalSet({ [KEYS.daysByTerm]: _daysByTermPlan });
}

/**
 * Remove stored prefs for a deleted saved plan and shift remaining saved:i keys
 * down so indices stay consistent with the savedSchedules array.
 */
export async function deleteSavedPlanPrefs(term, deletedIdx, totalPlansBefore) {
  const t = String(term);
  let changed = false;

  for (const map of [_blocksByTermPlan, _daysByTermPlan]) {
    if (!map[t]) continue;
    delete map[t][`saved:${deletedIdx}`];
    for (let i = deletedIdx + 1; i < totalPlansBefore; i++) {
      const src = `saved:${i}`;
      const dst = `saved:${i - 1}`;
      if (map[t][src] !== undefined) {
        map[t][dst] = map[t][src];
        delete map[t][src];
      }
    }
    changed = true;
  }

  if (changed) {
    await storageLocalSet({
      [KEYS.blocksByTerm]: _blocksByTermPlan,
      [KEYS.daysByTerm]: _daysByTermPlan,
    });
  }
}
