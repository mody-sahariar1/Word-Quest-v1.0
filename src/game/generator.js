// Word placement + filler letter generator.
// Per BUILD_SPEC.md §6.3 (word placement) + §6 (direction codes), issue #16.
// Consumes a level shape from levelLoader (§8) and produces a
// {rows, cols, letters, placements} payload.
//
// Determinism: tiny inline mulberry32 PRNG seeded from `seed` (default
// = level.id) so L1 always renders identically across reloads. No deps.
// Direction codes (§8): H, V, D1, D2 + reversed HR/VR/D1R/D2R. L1–L5
// don't use reverses; algorithm supports them for forward-compat.

import { validateLevel } from '../data/levelLoader.js';

const MAX_PLACE_ATTEMPTS = 200;
const MAX_FILLER_REROLLS = 12;

// Direction (deltaRow, deltaCol) per §8. Exported so the validator,
// tests, and the filler scan share one canonical map.
export const DIRECTION_VECTORS = Object.freeze({
  H: [0, 1],
  V: [1, 0],
  D1: [1, 1],
  D2: [1, -1],
  HR: [0, -1],
  VR: [-1, 0],
  D1R: [-1, -1],
  D2R: [-1, 1],
});

// English letter frequency (Norvig / Project Gutenberg). Filler picker
// samples against this so the grid reads as natural English noise, not
// uniform A–Z (per §6.3 + better-than item #7).
const FREQ_WEIGHTS = Object.freeze({
  E: 12.49, T: 9.28, A: 8.04, O: 7.64, I: 7.57, N: 7.23, S: 6.51,
  R: 6.28, H: 5.05, L: 4.07, D: 3.82, C: 3.34, U: 2.73, M: 2.51,
  F: 2.40, P: 2.14, G: 1.87, W: 1.68, Y: 1.66, B: 1.48, V: 1.05,
  K: 0.54, X: 0.23, J: 0.16, Q: 0.12, Z: 0.09,
});
const FREQ_LETTERS = Object.freeze(Object.keys(FREQ_WEIGHTS));
const FREQ_TOTAL = FREQ_LETTERS.reduce((s, ch) => s + FREQ_WEIGHTS[ch], 0);

// Inline mulberry32 — no deps, uniform-enough for level layout.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit hash so callers can pass either numbers (level.id) or
// strings (custom-mode theme name) as `seed`.
function _seedToUint32(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const str = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function _emptyLetters(rows, cols) {
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) out[r] = new Array(cols).fill(null);
  return out;
}

// Walk `word`'s path; null if any cell falls off-grid.
function _walkPath(rows, cols, word, sr, sc, dr, dc) {
  const path = new Array(word.length);
  for (let i = 0; i < word.length; i++) {
    const r = sr + dr * i;
    const c = sc + dc * i;
    if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
    path[i] = { r, c };
  }
  return path;
}

// Empty cells fine; matching letters at intersections fine; mismatch blocks.
function _canPlace(letters, word, sr, sc, dr, dc) {
  const rows = letters.length;
  const cols = letters[0].length;
  const path = _walkPath(rows, cols, word, sr, sc, dr, dc);
  if (!path) return false;
  for (let i = 0; i < word.length; i++) {
    const cell = letters[path[i].r][path[i].c];
    if (cell !== null && cell !== word[i]) return false;
  }
  return true;
}

function _applyPlacement(letters, word, sr, sc, dr, dc) {
  for (let i = 0; i < word.length; i++) {
    letters[sr + dr * i][sc + dc * i] = word[i];
  }
}

function _pickWeightedLetter(rng) {
  let target = rng() * FREQ_TOTAL;
  for (let i = 0; i < FREQ_LETTERS.length; i++) {
    target -= FREQ_WEIGHTS[FREQ_LETTERS[i]];
    if (target <= 0) return FREQ_LETTERS[i];
  }
  return FREQ_LETTERS[FREQ_LETTERS.length - 1];
}

// Does `letters` contain `word` along any direction in `dirs`?
// Used by the filler placement check + exported for the smoke test.
export function gridContainsWord(letters, word, dirs) {
  const rows = letters.length;
  const cols = letters[0].length;
  for (const d of dirs) {
    const vec = DIRECTION_VECTORS[d];
    if (!vec) continue;
    const [dr, dc] = vec;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const path = _walkPath(rows, cols, word, r, c, dr, dc);
        if (!path) continue;
        let ok = true;
        for (let i = 0; i < word.length; i++) {
          if (letters[path[i].r][path[i].c] !== word[i]) {
            ok = false;
            break;
          }
        }
        if (ok) return true;
      }
    }
  }
  return false;
}

// Place `word` along any allowed direction at a random cell. Up to
// MAX_PLACE_ATTEMPTS uniform samples — overlap encouraged when letters
// match. Returns the placement record or null on exhaustion.
function _tryPlaceWord(letters, word, allowedDirs, rng) {
  const rows = letters.length;
  const cols = letters[0].length;
  for (let attempt = 0; attempt < MAX_PLACE_ATTEMPTS; attempt++) {
    const dir = allowedDirs[Math.floor(rng() * allowedDirs.length)];
    const vec = DIRECTION_VECTORS[dir];
    if (!vec) continue;
    const [dr, dc] = vec;
    const sr = Math.floor(rng() * rows);
    const sc = Math.floor(rng() * cols);
    if (_canPlace(letters, word, sr, sc, dr, dc)) {
      _applyPlacement(letters, word, sr, sc, dr, dc);
      return { word, startRow: sr, startCol: sc, dir };
    }
  }
  return null;
}

// Fill empty cells with frequency-weighted A–Z, re-rolling if the new
// letter accidentally completes a target word in any allowed direction
// (per §6.3). Falls back to 'Z' after MAX_FILLER_REROLLS — §6.3 calls
// this "rare" and accepts the small risk vs blocking the boot path.
function _fillEmpties(letters, words, allowedDirs, rng) {
  const rows = letters.length;
  const cols = letters[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (letters[r][c] !== null) continue;
      let placed = false;
      for (let attempt = 0; attempt < MAX_FILLER_REROLLS; attempt++) {
        const candidate = _pickWeightedLetter(rng);
        letters[r][c] = candidate;
        let leaks = false;
        for (const w of words) {
          if (gridContainsWord(letters, w, allowedDirs)) {
            // Cell-attribution check: if the word still appears with
            // this cell back to null, it was the legit placement, not
            // a filler-induced leak.
            const before = letters[r][c];
            letters[r][c] = null;
            const stillThere = gridContainsWord(letters, w, allowedDirs);
            letters[r][c] = before;
            if (!stillThere) {
              leaks = true;
              break;
            }
          }
        }
        if (!leaks) {
          placed = true;
          break;
        }
        letters[r][c] = null;
      }
      if (!placed) letters[r][c] = 'Z';
    }
  }
}

// Public entry. Validates the level (defense-in-depth — Custom mode
// will pass freshly-typed shapes), places every word longest-first per
// §6.3, fills empties, returns the playable payload. Throws on
// unsolvable levels (§6.3 / §16 acceptance).
export function generateGrid(level, seed) {
  validateLevel(level);

  const { rows, cols, words, allowedDirs } = level;
  const seedValue = seed != null ? seed : level.id;
  const rng = mulberry32(_seedToUint32(seedValue));

  const letters = _emptyLetters(rows, cols);
  const placements = [];

  // Longest-first leaves more room for shorter words to slot in.
  const sorted = [...words].sort((a, b) => b.length - a.length);

  for (const word of sorted) {
    const placed = _tryPlaceWord(letters, word, allowedDirs, rng);
    if (!placed) {
      throw new Error(
        `generator: cannot place "${word}" after ${MAX_PLACE_ATTEMPTS} attempts ` +
          `on ${rows}×${cols} grid with dirs ${JSON.stringify(allowedDirs)}`
      );
    }
    placements.push(placed);
  }

  _fillEmpties(letters, words, allowedDirs, rng);

  return { rows, cols, letters, placements };
}
