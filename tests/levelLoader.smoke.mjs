// Runtime-fidelity smoke for levelLoader + state.getCurrentLevelData (#15).
// Per CLAUDE.md Step 3 rule 9:
//   (a) call the runtime entry the player reaches
//   (b) pass runtime args
//   (c) assert positive states, NEVER negation
//
// Node 20 doesn't support `fetch('file://...')`, so we read the JSON via
// fs and seed the loader cache through the same validator the browser
// path runs. getLevel() and state.getCurrentLevelData() then exercise
// the real runtime entries.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  validateLevel,
  getLevel,
  _resetForTests,
  _seedCacheForTests,
} from '../src/data/levelLoader.js';
import { getCurrentLevelData, _resetForTests as resetState } from '../src/engine/state.js';

const here = dirname(fileURLToPath(import.meta.url));
const jsonPath = join(here, '..', 'src', 'data', 'classicLevels.json');

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('PASS ' + msg);
  } else {
    console.error('FAIL ' + msg);
    failed++;
  }
}

// Reset module-level state from any prior import.
_resetForTests();
resetState();

const raw = readFileSync(jsonPath, 'utf8');
const parsed = JSON.parse(raw);

// 1. Schema-shape: parses to an array of exactly 5 entries.
assert(Array.isArray(parsed), 'classicLevels.json parses to an array');
assert(parsed.length === 5, 'classicLevels.json has length 5');

// 2. Per-level §8 schema (validator throws on violation).
for (let i = 0; i < parsed.length; i++) {
  let ok = false;
  try {
    validateLevel(parsed[i], i);
    ok = true;
  } catch (err) {
    console.error(`validateLevel threw on index ${i}: ${err.message}`);
  }
  assert(ok, `validateLevel passes for level index ${i}`);
}

// 3. Acceptance criteria specifics.
const ids = parsed.map((l) => l.id);
assert(JSON.stringify(ids) === JSON.stringify([1, 2, 3, 4, 5]), 'ids are 1..5 in order');

const themes = parsed.map((l) => l.theme);
assert(themes[0] === "LET'S EXPLORE", "L1 theme is LET'S EXPLORE");
assert(themes[1] === 'COLORS', 'L2 theme is COLORS');
assert(themes[2] === 'ANIMALS', 'L3 theme is ANIMALS');
assert(themes[3] === 'FOOD', 'L4 theme is FOOD');
assert(themes[4] === 'WEATHER', 'L5 theme is WEATHER');

assert(parsed[0].rows === 4 && parsed[0].cols === 4, 'L1 is 4×4');
assert(parsed[1].rows === 5 && parsed[1].cols === 5, 'L2 is 5×5');
assert(parsed[2].rows === 5 && parsed[2].cols === 5, 'L3 is 5×5');
assert(parsed[3].rows === 6 && parsed[3].cols === 6, 'L4 is 6×6');
assert(parsed[4].rows === 6 && parsed[4].cols === 6, 'L5 is 6×6');

// Word counts 3–5 per acceptance criteria.
const counts = parsed.map((l) => l.words.length);
assert(counts[0] === 3, 'L1 has 3 words');
assert(counts[1] === 4, 'L2 has 4 words');
assert(counts[2] === 4, 'L3 has 4 words');
assert(counts[3] === 5, 'L4 has 5 words');
assert(counts[4] === 5, 'L5 has 5 words');

// All words 3–8 letters.
const allWords = parsed.flatMap((l) => l.words);
const lenInRange = allWords.every((w) => w.length >= 3 && w.length <= 8);
assert(lenInRange === true, 'every word is 3–8 letters');

// No reversed dirs in L1–L5 (gentle onboarding).
const REVERSED = new Set(['HR', 'VR', 'D1R', 'D2R']);
const noReverses = parsed.every((l) => l.allowedDirs.every((d) => REVERSED.has(d) === false));
assert(noReverses === true, 'L1–L5 have zero reversed directions');

// Direction coverage matches issue body.
assert(JSON.stringify(parsed[0].allowedDirs) === JSON.stringify(['H', 'V']), 'L1 dirs = H,V');
assert(JSON.stringify(parsed[1].allowedDirs) === JSON.stringify(['H', 'V']), 'L2 dirs = H,V');
assert(JSON.stringify(parsed[2].allowedDirs) === JSON.stringify(['H', 'V', 'D1']), 'L3 dirs = H,V,D1');
assert(
  JSON.stringify(parsed[3].allowedDirs) === JSON.stringify(['H', 'V', 'D1', 'D2']),
  'L4 dirs = H,V,D1,D2'
);
assert(
  JSON.stringify(parsed[4].allowedDirs) === JSON.stringify(['H', 'V', 'D1', 'D2']),
  'L5 dirs = H,V,D1,D2'
);

// fixedGrid is null on every level (§8 default).
const allFixedNull = parsed.every((l) => l.fixedGrid === null);
assert(allFixedNull === true, 'every level has fixedGrid: null');

// 4. Seed cache + exercise runtime-entry getLevel().
const seeded = _seedCacheForTests(parsed);
assert(seeded.length === 5, 'seeded cache has length 5');

const l1 = getLevel(1);
assert(l1 !== null && l1.id === 1, 'getLevel(1) returns level with id 1');
assert(l1.theme === "LET'S EXPLORE", 'getLevel(1).theme is LET\'S EXPLORE');

const l5 = getLevel(5);
assert(l5 !== null && l5.id === 5, 'getLevel(5) returns level with id 5');

// Positive miss assertion — getLevel for a missing id returns null.
const missing = getLevel(99);
assert(missing === null, 'getLevel(99) returns null for missing id');

// 5. state.getCurrentLevelData() — default classicLevel is 1, so we
// expect Level 1 back per acceptance criteria.
const current = getCurrentLevelData();
assert(current !== null, 'getCurrentLevelData() returns a level (cache seeded)');
assert(current.id === 1, 'getCurrentLevelData() returns Level 1 by default');
assert(current.theme === "LET'S EXPLORE", 'getCurrentLevelData().theme is LET\'S EXPLORE');

// 6. Validator rejects malformed shapes (defensive).
let rejectedTooShort = false;
try {
  validateLevel(
    { id: 1, theme: 'X', rows: 4, cols: 4, words: ['HI'], allowedDirs: ['H'], fixedGrid: null },
    0
  );
} catch (_e) {
  rejectedTooShort = true;
}
assert(rejectedTooShort === true, 'validator rejects 2-letter word (below MIN_WORD_LEN)');

let rejectedBadDir = false;
try {
  validateLevel(
    { id: 1, theme: 'X', rows: 4, cols: 4, words: ['HII'], allowedDirs: ['Z'], fixedGrid: null },
    0
  );
} catch (_e) {
  rejectedBadDir = true;
}
assert(rejectedBadDir === true, 'validator rejects unknown direction code');

if (failed > 0) {
  console.error(`\n${failed} smoke assertion(s) failed`);
  process.exit(1);
}
console.log('\nlevelLoader.smoke.mjs — all assertions passed');
