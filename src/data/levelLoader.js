// Classic-mode level loader + schema validator.
// Per BUILD_SPEC.md §8 (level data structure) + issue #15.
//
// Shape: async fetch of `classicLevels.json`, cached after first call,
// with strict §8 schema validation at the boundary so malformed data
// never reaches the generator/validator/HUD downstream.
//
// Direction codes per §8: H, V, D1, D2 plus optional R suffix
// (HR, VR, D1R, D2R) for reversed. Word lengths 3–8 per §8.

const ALLOWED_DIRS = new Set(['H', 'V', 'D1', 'D2', 'HR', 'VR', 'D1R', 'D2R']);
const MIN_DIM = 4;
const MAX_DIM = 8;
const MIN_WORD_LEN = 3;
const MAX_WORD_LEN = 8;

let _cache = null;
let _inflight = null;

function _fail(msg) {
  throw new Error(`levelLoader: ${msg}`);
}

// Strict §8 schema. Throws on the first violation so malformed JSON
// surfaces at boot, not at gameplay time.
export function validateLevel(level, indexHint) {
  const where = indexHint != null ? `level[${indexHint}]` : 'level';
  if (!level || typeof level !== 'object' || Array.isArray(level)) {
    _fail(`${where} must be an object`);
  }
  if (!Number.isInteger(level.id) || level.id < 1) {
    _fail(`${where}.id must be a positive integer, got ${JSON.stringify(level.id)}`);
  }
  if (typeof level.theme !== 'string' || level.theme.length === 0) {
    _fail(`${where}.theme must be a non-empty string`);
  }
  if (!Number.isInteger(level.rows) || level.rows < MIN_DIM || level.rows > MAX_DIM) {
    _fail(`${where}.rows must be integer in [${MIN_DIM}, ${MAX_DIM}], got ${JSON.stringify(level.rows)}`);
  }
  if (!Number.isInteger(level.cols) || level.cols < MIN_DIM || level.cols > MAX_DIM) {
    _fail(`${where}.cols must be integer in [${MIN_DIM}, ${MAX_DIM}], got ${JSON.stringify(level.cols)}`);
  }
  if (!Array.isArray(level.words) || level.words.length === 0) {
    _fail(`${where}.words must be a non-empty array`);
  }
  for (let i = 0; i < level.words.length; i++) {
    const w = level.words[i];
    if (typeof w !== 'string') {
      _fail(`${where}.words[${i}] must be a string, got ${typeof w}`);
    }
    if (w.length < MIN_WORD_LEN || w.length > MAX_WORD_LEN) {
      _fail(
        `${where}.words[${i}] "${w}" length ${w.length} outside ${MIN_WORD_LEN}–${MAX_WORD_LEN}`
      );
    }
    if (!/^[A-Z]+$/.test(w)) {
      _fail(`${where}.words[${i}] "${w}" must be A–Z uppercase only`);
    }
  }
  if (!Array.isArray(level.allowedDirs) || level.allowedDirs.length === 0) {
    _fail(`${where}.allowedDirs must be a non-empty array`);
  }
  for (let i = 0; i < level.allowedDirs.length; i++) {
    const d = level.allowedDirs[i];
    if (!ALLOWED_DIRS.has(d)) {
      _fail(
        `${where}.allowedDirs[${i}] "${d}" not in {H,V,D1,D2,HR,VR,D1R,D2R}`
      );
    }
  }
  // fixedGrid: null OR rows×cols 2D array of single-character strings.
  if (level.fixedGrid !== null) {
    if (!Array.isArray(level.fixedGrid) || level.fixedGrid.length !== level.rows) {
      _fail(`${where}.fixedGrid must be null or a ${level.rows}-row array`);
    }
    for (let r = 0; r < level.rows; r++) {
      const row = level.fixedGrid[r];
      if (!Array.isArray(row) || row.length !== level.cols) {
        _fail(`${where}.fixedGrid[${r}] must be a ${level.cols}-column array`);
      }
      for (let c = 0; c < level.cols; c++) {
        const ch = row[c];
        if (typeof ch !== 'string' || ch.length !== 1) {
          _fail(`${where}.fixedGrid[${r}][${c}] must be a single character`);
        }
      }
    }
  }
  return level;
}

function _validateAll(levels) {
  if (!Array.isArray(levels)) _fail('classicLevels.json root must be an array');
  if (levels.length === 0) _fail('classicLevels.json is empty');
  const seen = new Set();
  for (let i = 0; i < levels.length; i++) {
    validateLevel(levels[i], i);
    if (seen.has(levels[i].id)) {
      _fail(`duplicate level id ${levels[i].id} at index ${i}`);
    }
    seen.add(levels[i].id);
  }
  return levels;
}

// Async fetch + cache. Resolves to the validated levels array.
// Concurrent callers share the in-flight Promise so we never fetch twice.
export async function loadClassicLevels() {
  if (_cache !== null) return _cache;
  if (_inflight !== null) return _inflight;

  const url = new URL('./classicLevels.json', import.meta.url);
  _inflight = (async () => {
    let parsed;
    try {
      const res = await fetch(url);
      if (!res.ok) _fail(`fetch failed: HTTP ${res.status}`);
      parsed = await res.json();
    } catch (err) {
      _inflight = null;
      throw new Error(`levelLoader: could not load classicLevels.json — ${err.message}`);
    }
    try {
      _cache = _validateAll(parsed);
    } catch (err) {
      _inflight = null;
      throw err;
    }
    _inflight = null;
    return _cache;
  })();
  return _inflight;
}

// Synchronous lookup against the cached array. Returns null if id missing
// OR if loadClassicLevels() has not resolved yet — callers (like
// state.getCurrentLevelData) treat null as "not ready" and gate accordingly.
export function getLevel(id) {
  if (_cache === null) return null;
  if (!Number.isInteger(id)) return null;
  for (let i = 0; i < _cache.length; i++) {
    if (_cache[i].id === id) return _cache[i];
  }
  return null;
}

// Test/debug helper — clears cache + in-flight promise. Not used in app code.
export function _resetForTests() {
  _cache = null;
  _inflight = null;
}

// Test/debug helper — seeds the cache from a parsed array, running it
// through the same validator as loadClassicLevels(). Used by the Node
// runtime-smoke harness where `fetch('file://...')` is unsupported on
// Node 20; the browser path always goes through loadClassicLevels().
export function _seedCacheForTests(levels) {
  _cache = _validateAll(levels);
  _inflight = null;
  return _cache;
}
