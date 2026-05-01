// Screen router — show/hide + cross-fade transitions.
// Per BUILD_SPEC.md §3.3 (Routing) and §4.5 (220ms screen fade, ease-out).
// The router is the ONLY place that toggles screen visibility; screens
// must never show/hide siblings directly. This keeps the boot graph and
// the user flow legible from one file. Issue #4.

import { emit } from './eventBus.js';
import { EVENTS, SCREENS } from './constants.js';

export { SCREENS };

const SECTION_SELECTOR = 'section[data-screen]';
const ATTR_ACTIVE = 'data-active';

// Single-step history per issue body — `back()` toggles between the two
// most recent screens. Deep history is Phase 2.
let _current = null;
let _previous = null;
let _transitioning = false;

function _section(name) {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`section[data-screen="${name}"]`);
}

function _allSections() {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll(SECTION_SELECTOR));
}

// Cross-fade pattern: new section is mounted display:flex with opacity:0,
// a forced reflow (rAF) ensures the next style mutation animates, then we
// flip both opacities simultaneously so old fades to 0 and new to 1 with
// no black gap. After the transition settles, the old gets display:none.
function _crossFade(fromName, toName) {
  const fromEl = fromName ? _section(fromName) : null;
  const toEl = _section(toName);
  if (!toEl) return;

  toEl.setAttribute(ATTR_ACTIVE, '');
  // Force reflow so the [data-active] display:flex applies before opacity
  // animates from 0 → 1 (display:none would otherwise short-circuit it).
  // requestAnimationFrame is the standard cross-fade trigger.
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      toEl.classList.add('is-visible');
      if (fromEl) fromEl.classList.remove('is-visible');
    });
  } else {
    toEl.classList.add('is-visible');
    if (fromEl) fromEl.classList.remove('is-visible');
  }

  if (!fromEl) return;
  // Tear down the outgoing section after the fade completes. Listen once
  // on the opacity transition end — falls back to a setTimeout so a
  // skipped transition (e.g. reduced-motion) still cleans up.
  const finalize = () => {
    fromEl.removeEventListener('transitionend', onEnd);
    fromEl.removeAttribute(ATTR_ACTIVE);
    _transitioning = false;
  };
  const onEnd = (ev) => {
    if (ev && ev.propertyName && ev.propertyName !== 'opacity') return;
    finalize();
  };
  fromEl.addEventListener('transitionend', onEnd);
  // Safety net — covers test envs and reduced-motion users where
  // transitionend may never fire. 400ms > 220ms token + jitter buffer.
  setTimeout(finalize, 400);
}

export function show(name, payload) {
  if (!name || typeof name !== 'string') return;
  // Idempotent: re-showing the active screen is a no-op (no events, no
  // CSS churn). Saves cycles during boot when something double-calls show.
  if (_current === name) return;

  const from = _current;
  _previous = _current;
  _current = name;
  _transitioning = true;

  if (from) emit(EVENTS.SCREEN_EXIT, { screen: from, to: name });
  emit(EVENTS.SCREEN_ENTER, { screen: name, from, payload });

  _crossFade(from, name);
}

export function current() {
  return _current;
}

export function back() {
  if (!_previous) return;
  // Single-step toggle — after show('a') then show('b'), back() returns
  // to 'a'; another back() returns to 'b'. Deep history is Phase 2.
  show(_previous);
}

// Test/debug helper — not used by app code.
export function _resetForTests() {
  _current = null;
  _previous = null;
  _transitioning = false;
  for (const el of _allSections()) {
    el.removeAttribute(ATTR_ACTIVE);
    el.classList.remove('is-visible');
  }
}

export const router = { show, current, back };
