// Drag selector — pointer events → cell path.
// Per BUILD_SPEC.md §6 / §6.1 + issue #17. Pointer Events API (touch +
// mouse + stylus, single API). pointerdown preventDefault()s touch-scroll;
// setPointerCapture pins the drag when the finger drifts off the grid.
// elementFromPoint hit-detection per §6 — pointerover misses inter-cell
// gap drags. Cell #2 locks direction; veering snaps back to the last
// legal cell instead of ending; backtracking shrinks; no revisits.
// Validator (#18) + pillRenderer (#19) listen — selector commits nothing.
// Spec ↔ issue delta: §3.4 has `drag:begin/move/end`; #17 mandates a new
// SELECT_* block (richer payloads + cancel). Routed via #8.

import { emit } from '../engine/eventBus.js';
import { EVENTS } from '../engine/constants.js';

const BOUNDS_SLACK_PX = 4;

function _now() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function _cellFromElement(el) {
  if (!el || el.nodeType !== 1) return null;
  const cell = el.closest && el.closest('.cell');
  if (!cell) return null;
  const r = Number(cell.dataset && cell.dataset.row);
  const c = Number(cell.dataset && cell.dataset.col);
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  return { row: r, col: c, el: cell };
}

// Implied 8-way direction between two cells per §6.1, or null if not on
// a straight line: dr === 0 || dc === 0 || abs(dr) === abs(dc).
function _direction(a, b) {
  const dr = b.row - a.row;
  const dc = b.col - a.col;
  if (dr === 0 && dc === 0) return null;
  if (dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc)) {
    return { dr: Math.sign(dr), dc: Math.sign(dc) };
  }
  return null;
}

export function attachSelector(gridRoot) {
  if (!gridRoot || typeof gridRoot.addEventListener !== 'function') {
    throw new TypeError('attachSelector: gridRoot must be a DOM element');
  }
  const doc =
    gridRoot.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('attachSelector: no document available');

  let dragging = false;
  let pointerId = null;
  let startedAt = 0;
  let path = [];
  let lockedDir = null;

  const cellAt = (x, y) =>
    typeof doc.elementFromPoint === 'function'
      ? _cellFromElement(doc.elementFromPoint(x, y))
      : null;

  const indexOf = (row, col) => {
    for (let i = 0; i < path.length; i++) {
      if (path[i].row === row && path[i].col === col) return i;
    }
    return -1;
  };

  // Single-step walk `from` → `to` along `dir`. Returns intermediate
  // cells (excluding `from`, including `to`) or null if any step is
  // off-grid.
  function stepsAlong(from, to, dir) {
    const steps = [];
    const guard =
      Math.max(Math.abs(to.row - from.row), Math.abs(to.col - from.col)) + 2;
    let r = from.row + dir.dr;
    let c = from.col + dir.dc;
    for (let i = 0; i < guard; i++) {
      const el = gridRoot.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
      if (!el) return null;
      steps.push({ row: r, col: c, el });
      if (r === to.row && c === to.col) return steps;
      r += dir.dr;
      c += dir.dc;
    }
    return null;
  }

  function emitExtend() {
    const tail = path[path.length - 1];
    emit(EVENTS.SELECT_EXTEND, {
      path: path.map((p) => ({ row: p.row, col: p.col })),
      lastChar: tail && tail.el ? tail.el.textContent : '',
    });
  }

  function release() {
    if (pointerId != null && typeof gridRoot.releasePointerCapture === 'function') {
      try {
        const has = typeof gridRoot.hasPointerCapture !== 'function' || gridRoot.hasPointerCapture(pointerId);
        if (has) gridRoot.releasePointerCapture(pointerId);
      } catch (_) { /* already released */ }
    }
    dragging = false;
    pointerId = null;
    path = [];
    lockedDir = null;
    startedAt = 0;
  }

  function emitCancel(reason) {
    if (!dragging) return;
    release();
    emit(EVENTS.SELECT_CANCEL, { reason });
  }

  function onPointerDown(ev) {
    if (typeof ev.button === 'number' && ev.button >= 2) {
      emitCancel('right-click');
      return;
    }
    if (typeof ev.button === 'number' && ev.button > 0) return;

    const cell = _cellFromElement(ev.target);
    if (!cell) return;

    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    if (typeof gridRoot.setPointerCapture === 'function' && ev.pointerId != null) {
      try { gridRoot.setPointerCapture(ev.pointerId); } catch (_) { /* non-fatal */ }
    }

    dragging = true;
    pointerId = ev.pointerId != null ? ev.pointerId : null;
    startedAt = _now();
    path = [cell];
    lockedDir = null;

    emit(EVENTS.SELECT_START, { row: cell.row, col: cell.col });
  }

  function onPointerMove(ev) {
    if (!dragging) return;
    if (pointerId != null && ev.pointerId != null && ev.pointerId !== pointerId) return;

    if (typeof gridRoot.getBoundingClientRect === 'function') {
      const r = gridRoot.getBoundingClientRect();
      const x = ev.clientX;
      const y = ev.clientY;
      const slack = BOUNDS_SLACK_PX;
      const out =
        typeof x === 'number' && typeof y === 'number' &&
        (x < r.left - slack || x > r.right + slack || y < r.top - slack || y > r.bottom + slack);
      if (out) { emitCancel('out-of-bounds'); return; }
    }

    const cell = cellAt(ev.clientX, ev.clientY);
    if (!cell) return;
    const tail = path[path.length - 1];
    if (!tail || (cell.row === tail.row && cell.col === tail.col)) return;

    // Backtracking — pointer over an earlier path cell shrinks.
    const existing = indexOf(cell.row, cell.col);
    if (existing !== -1) {
      path = path.slice(0, existing + 1);
      if (path.length === 1) lockedDir = null;
      emitExtend();
      return;
    }

    const start = path[0];

    // Pre-lock — second cell picks the direction.
    if (path.length === 1) {
      const dir = _direction(start, cell);
      if (!dir) return;
      const steps = stepsAlong(start, cell, dir);
      if (!steps || steps.length === 0) return;
      lockedDir = dir;
      path = path.concat(steps);
      emitExtend();
      return;
    }

    // Locked — candidate must extend along the locked line. Veer-off
    // leaves path unchanged (snap-back), per §6.1.
    const dirFromStart = _direction(start, cell);
    if (!dirFromStart || dirFromStart.dr !== lockedDir.dr || dirFromStart.dc !== lockedDir.dc) return;
    const steps = stepsAlong(tail, cell, lockedDir);
    if (!steps || steps.length === 0) return;
    for (const s of steps) if (indexOf(s.row, s.col) !== -1) return;
    path = path.concat(steps);
    emitExtend();
  }

  function onPointerUp(ev) {
    if (!dragging) return;
    if (pointerId != null && ev && ev.pointerId != null && ev.pointerId !== pointerId) return;

    const finished = path;
    let word = '';
    for (const step of finished) {
      if (step.el && typeof step.el.textContent === 'string') word += step.el.textContent;
    }
    const durationMs = _now() - startedAt;

    release();
    emit(EVENTS.SELECT_END, {
      path: finished.map((p) => ({ row: p.row, col: p.col })),
      word,
      durationMs,
    });
  }

  function onPointerCancel(ev) {
    if (!dragging) return;
    if (pointerId != null && ev && ev.pointerId != null && ev.pointerId !== pointerId) return;
    emitCancel('pointercancel');
  }

  function onContextMenu(ev) {
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    if (dragging) emitCancel('right-click');
  }

  gridRoot.addEventListener('pointerdown', onPointerDown);
  gridRoot.addEventListener('pointermove', onPointerMove);
  gridRoot.addEventListener('pointerup', onPointerUp);
  gridRoot.addEventListener('pointercancel', onPointerCancel);
  gridRoot.addEventListener('contextmenu', onContextMenu);

  let detached = false;
  return function detach() {
    if (detached) return;
    detached = true;
    if (dragging) emitCancel('detach');
    gridRoot.removeEventListener('pointerdown', onPointerDown);
    gridRoot.removeEventListener('pointermove', onPointerMove);
    gridRoot.removeEventListener('pointerup', onPointerUp);
    gridRoot.removeEventListener('pointercancel', onPointerCancel);
    gridRoot.removeEventListener('contextmenu', onContextMenu);
  };
}
