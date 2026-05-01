// Tiny pub/sub. No deps.
// Per issue #3 + BUILD_SPEC.md §3.4 — multiple listeners per event,
// on/off/emit only. Defensive subscribe pattern: caller stores the fn
// reference and passes it back to off() in their teardown.

const listeners = new Map(); // name -> Set<fn>

export function on(name, fn) {
  if (typeof name !== 'string' || typeof fn !== 'function') return;
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(fn);
}

export function off(name, fn) {
  const set = listeners.get(name);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) listeners.delete(name);
}

export function emit(name, payload) {
  const set = listeners.get(name);
  if (!set || set.size === 0) return;
  // Copy before iterating so listeners that off() themselves mid-emit
  // (a common screen-teardown pattern) don't mutate the live set.
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (err) {
      // One bad listener must not break the rest. Log + continue.
      // eslint-disable-next-line no-console
      console.error(`[eventBus] listener for "${name}" threw:`, err);
    }
  }
}

// Test/debug helper — clears all listeners. Not used in app code.
export function _resetForTests() {
  listeners.clear();
}
