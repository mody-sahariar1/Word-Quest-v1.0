// Word validator — `select:end` → match against placements → emit
// `word:found` / `word:rejected` / `level:complete`.
// Per BUILD_SPEC.md §6.4 (validator) + §3.4 (events) + issue #18.
//
// Pure data + events: no DOM, no rendering. Visual feedback (pillRenderer
// #19), score, sound, haptics land in their own issues per §6.4.
//
// Match algorithm (§6.4 + issue #18 §"Word check"): for each placement,
// compare path cell-sequence to placement cell-sequence forward AND
// reversed. Coordinate-checked, not just letter-checked, so a target
// accidentally re-spelled across filler in a non-allowed direction
// can never count.
//
// Spec ↔ issue delta: issue mandates `word:reject`; §3.4 + constants.js
// use `word:rejected`. CLAUDE.md → spec wins. This file emits the
// canonical `word:rejected`. Delta routed via #8.

import { on, off, emit } from '../engine/eventBus.js';
import { EVENTS } from '../engine/constants.js';

// Reasons surfaced on `word:rejected`. Exported so tests + downstream
// consumers (pillRenderer #19, future analytics) switch on the constant
// instead of a stringly-typed literal.
export const REJECT_REASONS = Object.freeze({
  TOO_SHORT: 'too-short',
  ILLEGAL_DIRECTION: 'illegal-direction',
  ALREADY_FOUND: 'already-found',
  NOT_A_TARGET: 'not-a-target',
});

// Mirror of generator.DIRECTION_VECTORS — duplicated here so the engine
// doesn't pull in the placement code path. Codes per BUILD_SPEC.md §8.
const DIRECTION_VECTORS = Object.freeze({
  H: [0, 1], V: [1, 0], D1: [1, 1], D2: [1, -1],
  HR: [0, -1], VR: [-1, 0], D1R: [-1, -1], D2R: [-1, 1],
});

// Derive a direction code from two cells. null = not 8-directional.
function _dirFromCells(a, b) {
  const dr = b.row - a.row;
  const dc = b.col - a.col;
  if (dr === 0 && dc === 0) return null;
  const sr = Math.sign(dr);
  const sc = Math.sign(dc);
  if (sr === 0 || sc === 0 || Math.abs(dr) === Math.abs(dc)) {
    for (const [code, vec] of Object.entries(DIRECTION_VECTORS)) {
      if (vec[0] === sr && vec[1] === sc) return code;
    }
  }
  return null;
}

// True iff `path` cell sequence equals placement's canonical sequence
// or its reverse. Single-pass, short-circuits on first mismatch on both
// sides.
function _pathMatchesPlacement(path, placement) {
  const vec = DIRECTION_VECTORS[placement.dir];
  if (!vec || path.length !== placement.word.length) return false;
  const [dr, dc] = vec;
  let forward = true;
  let backward = true;
  for (let i = 0; i < placement.word.length; i++) {
    const r = placement.startRow + dr * i;
    const c = placement.startCol + dc * i;
    if (path[i].row !== r || path[i].col !== c) forward = false;
    const j = placement.word.length - 1 - i;
    if (path[j].row !== r || path[j].col !== c) backward = false;
    if (!forward && !backward) return false;
  }
  return forward || backward;
}

const _reverse = (s) => s.split('').reverse().join('');

function _now() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

// Module-private state. attachValidator() resets to safe defaults each
// fresh attach so a test can stand up an isolated instance.
let _level = null;
let _placements = null;
let _foundWords = new Set();
let _attachedAt = 0;
let _onLevelReady = null;
let _onSelectEnd = null;

function _handleLevelReady(payload) {
  if (!payload || !payload.level) return;
  _level = payload.level;
  _placements = Array.isArray(payload.placements) ? payload.placements : [];
  _foundWords = new Set();
  _attachedAt = _now();
}

function _handleSelectEnd(payload) {
  if (!_level || !_placements) return;
  if (!payload || !Array.isArray(payload.path)) return;
  const { path } = payload;

  // Issue #18 §5 — single-cell drag short-circuits before direction check.
  if (path.length < 2) {
    emit(EVENTS.WORD_REJECTED, { path, reason: REJECT_REASONS.TOO_SHORT });
    return;
  }

  // §"Direction check" — derive direction from first two cells; reject
  // if not a legal 8-way line OR not in level.allowedDirs.
  const dir = _dirFromCells(path[0], path[1]);
  if (!dir || !_level.allowedDirs.includes(dir)) {
    emit(EVENTS.WORD_REJECTED, { path, reason: REJECT_REASONS.ILLEGAL_DIRECTION });
    return;
  }

  const candidate = typeof payload.word === 'string' ? payload.word : '';
  const reversed = _reverse(candidate);

  // §"Word check" — find the placement whose canonical cell sequence
  // (or reverse) equals this path. Text alone isn't enough — a target
  // can spell out across filler in a non-allowed direction.
  let matched = null;
  for (const p of _placements) {
    if (p.word !== candidate && p.word !== reversed) continue;
    if (_pathMatchesPlacement(path, p)) { matched = p; break; }
  }
  if (!matched) {
    emit(EVENTS.WORD_REJECTED, { path, reason: REJECT_REASONS.NOT_A_TARGET });
    return;
  }

  if (_foundWords.has(matched.word)) {
    emit(EVENTS.WORD_REJECTED, { path, reason: REJECT_REASONS.ALREADY_FOUND });
    return;
  }

  _foundWords.add(matched.word);
  const allFound = _level.words.every((w) => _foundWords.has(w));

  emit(EVENTS.WORD_FOUND, {
    word: matched.word,
    path: path.map((cell) => ({ row: cell.row, col: cell.col })),
    dir: matched.dir,
    levelComplete: allFound,
  });

  if (allFound) {
    emit(EVENTS.LEVEL_COMPLETE, {
      level: _level.id,
      totalMs: _now() - _attachedAt,
    });
  }
}

// Public entry. Subscribes to LEVEL_READY (resets tracker) + SELECT_END
// (validates). Returns idempotent detach() for screen teardown.
export function attachValidator() {
  // Drop any prior live listeners so screen hot-swaps + tests don't
  // double-fire from a stale attach.
  if (_onSelectEnd) off(EVENTS.SELECT_END, _onSelectEnd);
  if (_onLevelReady) off(EVENTS.LEVEL_READY, _onLevelReady);

  _foundWords = new Set();
  _level = null;
  _placements = null;
  _attachedAt = _now();

  _onLevelReady = (p) => _handleLevelReady(p);
  _onSelectEnd = (p) => _handleSelectEnd(p);
  on(EVENTS.LEVEL_READY, _onLevelReady);
  on(EVENTS.SELECT_END, _onSelectEnd);

  let detached = false;
  return function detach() {
    if (detached) return;
    detached = true;
    if (_onSelectEnd) { off(EVENTS.SELECT_END, _onSelectEnd); _onSelectEnd = null; }
    if (_onLevelReady) { off(EVENTS.LEVEL_READY, _onLevelReady); _onLevelReady = null; }
    _level = null;
    _placements = null;
    _foundWords = new Set();
  };
}

// Test/debug helper — exposes the found-words tracker so smoke tests
// assert positive state without re-deriving via emitted events.
export function _foundCountForTests() {
  return _foundWords.size;
}
