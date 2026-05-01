// Runtime-fidelity smoke for generator.generateGrid (#16).
// Per CLAUDE.md Step 3 rule 9:
//   (a) call the runtime entry the player reaches — generateGrid(getLevel(N))
//   (b) pass runtime args — let the loader resolve the level shape
//   (c) assert positive states (counts > 0, deep-equal on same seed,
//       gridContainsWord(target) === true), never the negation
//
// Node 20 doesn't support fetch('file://...'), so we read the JSON via
// fs and seed the loader cache through its own validator — same path
// the levelLoader smoke uses. The generator then runs against fully
// validated level shapes the browser would see.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  getLevel,
  _resetForTests,
  _seedCacheForTests,
} from '../src/data/levelLoader.js';
import {
  generateGrid,
  gridContainsWord,
  DIRECTION_VECTORS,
} from '../src/game/generator.js';

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

_resetForTests();
const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
_seedCacheForTests(parsed);

// 1. Runtime entry — generateGrid(getLevel(1)) returns a level-shaped payload.
const l1 = getLevel(1);
assert(l1 !== null && l1.id === 1, 'getLevel(1) returns Level 1');

const g1 = generateGrid(l1);
assert(g1.rows === l1.rows, `generateGrid(L1).rows === ${l1.rows}`);
assert(g1.cols === l1.cols, `generateGrid(L1).cols === ${l1.cols}`);
assert(Array.isArray(g1.letters) && g1.letters.length === l1.rows, 'letters has rows rows');
assert(
  g1.letters.every((row) => Array.isArray(row) && row.length === l1.cols),
  'every letter row has cols entries'
);
assert(
  g1.letters.every((row) => row.every((ch) => typeof ch === 'string' && ch.length === 1)),
  'every letter cell is a single character'
);

// 2. Placement count matches level.words.length for every level (§16 AC).
for (const level of parsed) {
  const grid = generateGrid(level);
  assert(
    grid.placements.length === level.words.length,
    `L${level.id}: placements.length === words.length (${level.words.length})`
  );

  // Each placement actually puts the word at the recorded coordinates.
  for (const p of grid.placements) {
    const vec = DIRECTION_VECTORS[p.dir];
    let ok = vec !== undefined;
    if (ok) {
      for (let i = 0; i < p.word.length; i++) {
        const r = p.startRow + vec[0] * i;
        const c = p.startCol + vec[1] * i;
        if (
          r < 0 ||
          r >= grid.rows ||
          c < 0 ||
          c >= grid.cols ||
          grid.letters[r][c] !== p.word[i]
        ) {
          ok = false;
          break;
        }
      }
    }
    assert(ok, `L${level.id}: placement of "${p.word}" along ${p.dir} matches grid letters`);
  }

  // gridContainsWord proves the runtime entry the validator will use
  // can find every target (positive assertion).
  for (const w of level.words) {
    assert(
      gridContainsWord(grid.letters, w, level.allowedDirs) === true,
      `L${level.id}: "${w}" is findable in grid along allowedDirs`
    );
  }
}

// 3. Determinism — same seed → identical letter arrays.
const a = generateGrid(l1, 42);
const b = generateGrid(l1, 42);
assert(
  JSON.stringify(a.letters) === JSON.stringify(b.letters),
  'same seed → deep-equal letters arrays'
);
assert(
  JSON.stringify(a.placements) === JSON.stringify(b.placements),
  'same seed → deep-equal placements'
);

// Default seed = level.id — repeat invocations match.
const def1 = generateGrid(l1);
const def2 = generateGrid(l1);
assert(
  JSON.stringify(def1.letters) === JSON.stringify(def2.letters),
  'default seed (level.id) is deterministic across calls'
);

// Different seeds → different grids (positive distinctness check).
const seedA = generateGrid(l1, 1);
const seedB = generateGrid(l1, 2);
assert(
  JSON.stringify(seedA.letters) !== JSON.stringify(seedB.letters),
  'different seeds produce different letters (PRNG diverges)'
);

// 4. No-accidental-target-spell guard — for each level, every target
// word appears EXACTLY once (no filler accidentally re-spelled it).
for (const level of parsed) {
  const grid = generateGrid(level);
  for (const w of level.words) {
    let count = 0;
    const rows = grid.rows;
    const cols = grid.cols;
    for (const dir of level.allowedDirs) {
      const vec = DIRECTION_VECTORS[dir];
      const [dr, dc] = vec;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let ok = true;
          for (let i = 0; i < w.length; i++) {
            const rr = r + dr * i;
            const cc = c + dc * i;
            if (
              rr < 0 ||
              rr >= rows ||
              cc < 0 ||
              cc >= cols ||
              grid.letters[rr][cc] !== w[i]
            ) {
              ok = false;
              break;
            }
          }
          if (ok) count++;
        }
      }
    }
    assert(
      count === 1,
      `L${level.id}: "${w}" appears exactly once across allowedDirs (got ${count})`
    );
  }
}

// 5. Refuses cleanly on an unsolvable level.
const unsolvable = {
  id: 999,
  theme: 'TOO TIGHT',
  rows: 4,
  cols: 4,
  // 4 words of 4 letters each = 16 letters, no overlaps possible at H only.
  // The runtime entry must throw rather than silently return a half-grid.
  words: ['ABCD', 'EFGH', 'IJKL', 'MNOP'],
  allowedDirs: ['H'],
  fixedGrid: null,
};
let threw = false;
try {
  // Force placement collision by seeding deterministically — even with
  // overlap-friendly intersect logic, four 4-letter words with disjoint
  // alphabets can't share rows, and a 4×4 grid has only 4 rows.
  generateGrid(unsolvable);
} catch (err) {
  threw = err instanceof Error;
}
// Note: with 4 disjoint H-only words on 4 rows it's actually solvable
// (one per row). We need a truly-unsolvable case: 5 disjoint words on 4 rows.
if (!threw) {
  const reallyUnsolvable = {
    id: 998,
    theme: 'TOO TIGHT',
    rows: 4,
    cols: 4,
    words: ['ABCD', 'EFGH', 'IJKL', 'MNOP', 'QRST'],
    allowedDirs: ['H'],
    fixedGrid: null,
  };
  try {
    generateGrid(reallyUnsolvable);
  } catch (err) {
    threw = err instanceof Error;
  }
}
assert(threw, 'generateGrid throws Error on unsolvable level');

if (failed > 0) {
  console.error(`\n${failed} smoke assertion(s) failed`);
  process.exit(1);
}
console.log('\ngenerator.smoke.mjs — all assertions passed');
