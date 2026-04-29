// Word Quest — boot.
// Engine layer (eventBus + state + storage) wired in #3.
// Router / screens / splash mount in #4–#5 per BUILD_SPEC.md §3.1 / §3.3.

import './engine/eventBus.js';
import './engine/state.js';
import { load } from './engine/storage.js';

load();

console.log('Word Quest boot');
