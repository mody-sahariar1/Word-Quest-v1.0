// Word Quest — boot.
// Engine layer (eventBus + state + storage) wired in #3.
// Router mounts in #4; grid model + render lands in #5.
// Per BUILD_SPEC.md §3.1 / §3.3.

import './engine/eventBus.js';
import './engine/state.js';
import { load } from './engine/storage.js';
import { router, SCREENS, _resetForTests as _resetRouterForTests } from './engine/router.js';
import { on, off, emit, _resetForTests as _resetBusForTests } from './engine/eventBus.js';
import { EVENTS } from './engine/constants.js';
import { createGrid, renderGrid } from './game/grid.js';

// G1 demo grid — fixture from issue #5 body. Real grids come from
// generator.js (#~7) reading classicLevels.json (#1 stub).
const DEMO_LETTERS = [
  ['S', 'U', 'N', 'X', 'X'],
  ['A', 'X', 'X', 'X', 'X'],
  ['B', 'X', 'X', 'X', 'X'],
  ['X', 'X', 'X', 'X', 'X'],
  ['X', 'X', 'X', 'X', 'X'],
];

// Diagnostic mount: expose runtime entries on window so the Playwright e2e
// suite can drive the real router/bus from page context (issue #11). Always
// on for now; gating behind ?dev=1 is deferred to spec-reconciliation #8.
if (typeof window !== 'undefined') {
  window.router = router;
  window.SCREENS = SCREENS;
  window.bus = { on, off, emit };
  window.EVENTS = EVENTS;
  window.__wq = {
    resetBus: _resetBusForTests,
    resetRouter: _resetRouterForTests,
  };
}

load();
router.show(SCREENS.SPLASH);

// Render the grid the moment the game screen becomes active.
on(EVENTS.SCREEN_ENTER, ({ screen }) => {
  if (screen !== SCREENS.GAME) return;
  const mount = document.getElementById('grid-root');
  if (!mount) return;
  renderGrid(createGrid(5, 5, DEMO_LETTERS), mount);
});

// Proves the grid:ready event fires end-to-end. Removed when real
// game-screen consumers (selector, pillRenderer) take over.
on(EVENTS.GRID_READY, (payload) => {
  console.log('[main] grid:ready', payload);
});

// TODO #6+: replace with real splash → menu → game flow.
// G1-only auto-advance so the grid is visible end-to-end without a
// menu yet. 1.2s delay matches the splash-min-display window from
// BUILD_SPEC.md §5.1.
setTimeout(() => router.show(SCREENS.GAME), 1200);

console.log('Word Quest boot');
