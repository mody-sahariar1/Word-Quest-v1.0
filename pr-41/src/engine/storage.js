// Persistence layer. Web (localStorage) now; Capacitor.Preferences
// behind feature detection later (Phase 2 — see BUILD_SPEC.md §13).
// No Capacitor dep added in Phase 1 — the native branch is a comment-only
// placeholder that falls through to localStorage.

import { emit } from './eventBus.js';
import {
  EVENTS,
  STORAGE_KEY,
  SAVE_DEBOUNCE_MS,
  PERSISTENT_KEYS,
} from './constants.js';
import {
  _persistentSnapshot,
  _hydrate,
  registerSaveHook,
} from './state.js';

// Single setTimeout-based debouncer. No lodash, no deps.
let _saveTimer = null;

function _readRaw() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  // TODO Phase 2: if window.Capacitor?.isNativePlatform() route to
  // @capacitor/preferences (async). For now both branches use localStorage.
  if (window.Capacitor?.isNativePlatform?.()) {
    // Falls through to localStorage until the dep lands.
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (_err) {
    return null;
  }
}

function _writeRaw(json) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  // TODO Phase 2: route to @capacitor/preferences on native. Until then,
  // both web + (synthetic) native paths use localStorage so behavior is
  // identical between `npm run dev` and a Capacitor wrap.
  if (window.Capacitor?.isNativePlatform?.()) {
    // Falls through to localStorage until the dep lands.
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, json);
  } catch (_err) {
    // Quota exceeded / private mode / SSR — ignore silently.
  }
}

// Restores persistent slice from storage. Called from main.js at boot.
// Missing-or-corrupt → silently fall back to defaults (no migration at v1).
// Emits storage:loaded once when done so screens can render the right state.
export function load() {
  const raw = _readRaw();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        // Only accept known persistent keys — defends against tampered
        // localStorage and prevents unknown keys leaking into state.
        const clean = {};
        for (const k of PERSISTENT_KEYS) {
          if (Object.prototype.hasOwnProperty.call(parsed, k)) {
            clean[k] = parsed[k];
          }
        }
        _hydrate(clean);
      }
    } catch (_err) {
      // Corrupt JSON — fall back to defaults silently.
    }
  }
  emit(EVENTS.STORAGE_LOADED, { hadSavedState: raw !== null });
}

// Debounced persistence — flushed SAVE_DEBOUNCE_MS after the latest call.
// state.set() calls this on every persistent-key write.
export function save() {
  if (_saveTimer !== null) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    const snapshot = _persistentSnapshot();
    try {
      _writeRaw(JSON.stringify(snapshot));
    } catch (_err) {
      // Stringify failure (circular refs etc) — skip this flush.
    }
  }, SAVE_DEBOUNCE_MS);
}

// Synchronous flush — useful for tests + future page-hide handlers.
export function flush() {
  if (_saveTimer !== null) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  const snapshot = _persistentSnapshot();
  try {
    _writeRaw(JSON.stringify(snapshot));
  } catch (_err) {
    // ignore
  }
}

// Wire state.set() → save() (debounced) at module-load time so callers
// don't need to remember to do it. State holds the hook reference and
// only invokes it for persistent keys.
registerSaveHook(save);
