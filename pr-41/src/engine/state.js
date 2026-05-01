// Central state — single source of truth.
// Per BUILD_SPEC.md §3.2 (initial values copied verbatim) and §10.
// Private module-scoped object; readers go through get(); writers
// through set() so we can swap to a Proxy-backed model later if needed.

import { emit } from './eventBus.js';
import { EVENTS, PERSISTENT_KEYS } from './constants.js';
import { getLevel } from '../data/levelLoader.js';

// Default state — BUILD_SPEC.md §3.2 verbatim.
// Factory function so each load/reset starts from a fresh, isolated copy
// (avoids accidental shared-reference mutation of nested objects/arrays).
export function defaultState() {
  return {
    // Persistent
    coins: 200,
    classicLevel: 1,
    storyProgress: { chapter: 0, level: 0 },
    unlockedCategories: ['animals', 'food', 'nature'],
    ownedCategories: [],
    powerups: { wand: 0, lightning: 0, hint: 1 },
    powerupTutorialsSeen: { wand: false, lightning: false, hint: false },
    settings: { sfx: true, music: true, haptics: true, adsEnabled: true },
    dailyCheckIn: { lastClaim: null, streak: 0 },
    hasSeenHowToPlay: false,

    // Transient (NOT persisted) — per §3.2 last paragraph
    currentLevel: null,
    activeDrag: null,
  };
}

// Module-private state. Never exported directly.
let _state = defaultState();

// save() injection — storage.js calls registerSaveHook(save) at boot
// so state.set() can trigger debounced persistence without a circular
// import (storage imports state for the persistent slice; if state
// imported storage too we'd loop).
let _saveHook = null;
export function registerSaveHook(fn) {
  _saveHook = typeof fn === 'function' ? fn : null;
}

export function get(key) {
  if (!Object.prototype.hasOwnProperty.call(_state, key)) return undefined;
  return _state[key];
}

export function set(key, value) {
  if (!Object.prototype.hasOwnProperty.call(_state, key)) {
    // eslint-disable-next-line no-console
    console.warn(`[state] unknown key "${key}" — refusing to set`);
    return;
  }
  const prev = _state[key];
  _state[key] = value;
  emit(EVENTS.STATE_CHANGE, { key, value, prev });
  if (_saveHook && PERSISTENT_KEYS.includes(key)) {
    _saveHook();
  }
}

// Bulk replace — used by storage.load() to hydrate persisted slice
// without firing per-key state:change events for every restored field.
// Emits storage:loaded once via storage.js; no per-key emit here.
export function _hydrate(partial) {
  if (!partial || typeof partial !== 'object') return;
  for (const key of PERSISTENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(partial, key)) {
      _state[key] = partial[key];
    }
  }
}

// Test/debug helper — restores defaults. Not used in app code.
export function _resetForTests() {
  _state = defaultState();
  _saveHook = null;
}

// Issue #15 — read the active classic-mode level data via levelLoader.
// Returns null until loadClassicLevels() has resolved (cache empty);
// callers gate on null as "level data not ready yet".
export function getCurrentLevelData() {
  return getLevel(_state.classicLevel);
}

// Snapshot of the persistent slice for storage.save().
export function _persistentSnapshot() {
  const out = {};
  for (const key of PERSISTENT_KEYS) {
    out[key] = _state[key];
  }
  return out;
}
