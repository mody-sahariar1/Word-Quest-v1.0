// Word Quest — boot.
// Engine layer (eventBus + state + storage) wired in #3.
// Router mounts in #4; real screens (splash → menu → game) land in #5+.
// Per BUILD_SPEC.md §3.1 / §3.3.

import './engine/eventBus.js';
import './engine/state.js';
import { load } from './engine/storage.js';
import { router, SCREENS } from './engine/router.js';

load();
router.show(SCREENS.SPLASH);

console.log('Word Quest boot');
