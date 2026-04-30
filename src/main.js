// Word Quest — boot.
// Engine layer (eventBus + state + storage) wired in #3.
// Router mounts in #4; grid model + render lands in #5;
// level data + loader land in #15; generator + level:ready land in #16.
// Per BUILD_SPEC.md §3.1 / §3.3 / §6.3 / §8.

import './engine/eventBus.js';
import './engine/state.js';
import { load } from './engine/storage.js';
import { router, SCREENS } from './engine/router.js';
import { on, emit } from './engine/eventBus.js';
import { EVENTS } from './engine/constants.js';
import { createGrid, renderGrid } from './game/grid.js';
import { generateGrid } from './game/generator.js';
import { loadClassicLevels } from './data/levelLoader.js';
import { getCurrentLevelData } from './engine/state.js';

load();
router.show(SCREENS.SPLASH);

// Track whether the level data has loaded so the screen:enter handler
// renders only once we have a real level. The auto-advance below waits
// for the same flag, so cold boots without cache don't render an empty
// grid before the JSON arrives.
let _levelsReady = false;

function _renderActiveLevel() {
  const mount = document.getElementById('grid-root');
  if (!mount) return;
  const level = getCurrentLevelData();
  if (!level) return; // loadClassicLevels() not yet resolved.

  // Generator owns deterministic placement + filler-letter logic per
  // BUILD_SPEC.md §6.3. Default seed = level.id so the same level
  // always renders the same letters across reloads (§16 acceptance).
  const grid = generateGrid(level);
  renderGrid(createGrid(grid.rows, grid.cols, grid.letters), mount);

  // §3.4 extension — downstream consumers (validator, HUD, theme banner)
  // subscribe to one canonical event for "a fresh level is on screen".
  emit(EVENTS.LEVEL_READY, {
    level,
    grid,
    placements: grid.placements,
  });
}

// Render whenever the game screen activates. The level is also rendered
// directly after levels finish loading in case the game screen was
// already active before the JSON resolved.
on(EVENTS.SCREEN_ENTER, ({ screen }) => {
  if (screen !== SCREENS.GAME) return;
  if (!_levelsReady) return;
  _renderActiveLevel();
});

// Proves the grid:ready event fires end-to-end. Removed when real
// game-screen consumers (selector, pillRenderer) take over.
on(EVENTS.GRID_READY, (payload) => {
  console.log('[main] grid:ready', payload);
});

// Kick off the level-data fetch in parallel with the splash. Once it
// resolves, mark levels ready and (re-)render if the game screen is the
// current one — handles the common case where loadClassicLevels()
// resolves after router.show(GAME) below.
loadClassicLevels()
  .then(() => {
    _levelsReady = true;
    if (router.current() === SCREENS.GAME) {
      _renderActiveLevel();
    }
  })
  .catch((err) => {
    console.error('[main] level data failed to load', err);
  });

// G1-only auto-advance so the grid is visible end-to-end without a
// menu yet. 1.2s delay matches the splash-min-display window from
// BUILD_SPEC.md §5.1; the screen:enter handler above renders once the
// levels are ready.
setTimeout(() => router.show(SCREENS.GAME), 1200);

console.log('Word Quest boot');
