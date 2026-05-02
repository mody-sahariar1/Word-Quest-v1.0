// Pill renderer — SVG overlay for active drag pill + committed
// found-word pills. Per BUILD_SPEC.md §4 + §6.2 (stadium-path geometry,
// cell-space viewBox). Issue #19.
//
// Topology: one <svg id="pill-layer"> child of #grid-root,
// viewBox="0 0 cols rows". Active pill = one <path>; committed = N
// <path>s colored via colors.nextPillColor (§4 cycle).
//
// Spec ↔ issue body deltas (routed via #8): (1) issue says <rect> with
// rotation; §6.2 specs stadium path handling diagonals natively → spec
// wins. (2) "screen:enter game with new level id" — router doesn't carry
// level id; canonical signal is grid:ready (renderGrid each level).
// (3) Validator emits `word:rejected` (canonical), NOT `word:reject`.

import { on, off } from '../engine/eventBus.js';
import { EVENTS } from '../engine/constants.js';
import { nextPillColor, resetPillColors } from './colors.js';

// §6.2: "Width perpendicular = 0.78 × cell size" → half-width 0.39 in
// cell-space. Issue #47: operator reports the 0.78 figure leaves a
// visible white band above + below the pill (cell white background
// peeks through ~11% top + ~11% bottom). Issue #47 directs Option A —
// widen halfWidth to 0.5 (1.0 × cell, full perpendicular coverage).
// Spec conflict with §6.2's literal 0.78 figure flagged in PR #38
// comment; operator resolves the spec offline (BUILD_SPEC.md is a
// hard-excluded path per CLAUDE.md, never silently amended).
const PILL_HALF_WIDTH_CELLS = 0.5;
// §6.1: 220ms fade-out (no dedicated --dur-pill-fade token; gap → #8).
const ACTIVE_FADE_OUT_MS = 220;

const SVG_NS = 'http://www.w3.org/2000/svg';
const PILL_LAYER_ID = 'pill-layer';
const PILL_ACTIVE_CLASS = 'pill-active';
const PILL_COMMITTED_CLASS = 'pill-committed';

// Stadium path between two cell-space points (§6.2 pseudocode).
// Exported for the smoke test.
export function pillPath(startXY, endXY, halfWidth) {
  const [sx, sy] = startXY;
  const [ex, ey] = endXY;
  const dx = ex - sx;
  const dy = ey - sy;
  const len = Math.hypot(dx, dy);
  if (len < 0.0001) {
    // Degenerate single-cell pill — full circle.
    const r = halfWidth;
    return `M ${sx + r} ${sy} A ${r} ${r} 0 0 1 ${sx - r} ${sy} A ${r} ${r} 0 0 1 ${sx + r} ${sy} Z`;
  }
  const px = (-dy / len) * halfWidth;
  const py = (dx / len) * halfWidth;
  const p1x = sx + px, p1y = sy + py;
  const p2x = ex + px, p2y = ey + py;
  const p3x = ex - px, p3y = ey - py;
  const p4x = sx - px, p4y = sy - py;
  return (
    `M ${p1x} ${p1y} ` +
    `L ${p2x} ${p2y} ` +
    `A ${halfWidth} ${halfWidth} 0 0 1 ${p3x} ${p3y} ` +
    `L ${p4x} ${p4y} ` +
    `A ${halfWidth} ${halfWidth} 0 0 1 ${p1x} ${p1y} Z`
  );
}

// Cell → (x, y) center in cell-space. Exported for smoke.
export function cellCenter(cell) {
  return [cell.col + 0.5, cell.row + 0.5];
}

// Stadium-path string for a path of cells. Exported for smoke.
export function pathForCells(cells, halfWidth = PILL_HALF_WIDTH_CELLS) {
  if (!Array.isArray(cells) || cells.length === 0) return '';
  if (cells.length === 1) {
    return pillPath(cellCenter(cells[0]), cellCenter(cells[0]), halfWidth);
  }
  return pillPath(
    cellCenter(cells[0]),
    cellCenter(cells[cells.length - 1]),
    halfWidth
  );
}

// Read grid dims from data-rows/data-cols set by renderGrid (#5).
function readGridDims(gridRoot) {
  if (!gridRoot || !gridRoot.getAttribute) return null;
  const rows = Number(gridRoot.getAttribute('data-rows'));
  const cols = Number(gridRoot.getAttribute('data-cols'));
  if (Number.isInteger(rows) && Number.isInteger(cols) && rows > 0 && cols > 0) {
    return { rows, cols };
  }
  return null;
}

// Mount/re-mount the SVG pill layer into gridRoot. Idempotent.
function mountPillLayer(gridRoot) {
  if (!gridRoot || typeof gridRoot.querySelector !== 'function') return null;
  if (typeof document === 'undefined' || typeof document.createElementNS !== 'function') {
    return null;
  }
  const existing = gridRoot.querySelector(`#${PILL_LAYER_ID}`);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  const dims = readGridDims(gridRoot);
  if (!dims) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('id', PILL_LAYER_ID);
  svg.setAttribute('viewBox', `0 0 ${dims.cols} ${dims.rows}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  // Layering — #46 operator-approved fix (after #43 + #45 attempts at
  // sibling z-index failed on real iOS Safari + Android Chrome):
  //   - #grid-root establishes a positioned ancestor (position:relative
  //     in grid.css).
  //   - The SVG is `position: absolute; inset: 0` so it covers the entire
  //     grid card AND is pulled out of normal CSS Grid flow.
  //   - z-index: 2 lifts it above any cell stacking-context. Because the
  //     SVG is no longer a normal-flow grid item sibling-of-cells, cell
  //     stacking contexts created by transform / opacity / isolation
  //     can't wall off the SVG the way they did at #43/#45 — a
  //     position:absolute element resolves against its containing block
  //     (#grid-root), not against any cell's stacking context.
  //   - pointer-events:none lets pointermove pass through to the cells
  //     underneath so the selector keeps receiving drag events.
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '2';
  // Append last so the SVG paints AFTER cells regardless of z-index
  // (defensive — z-index + absolute makes the layering deterministic).
  gridRoot.appendChild(svg);
  return svg;
}

function makePathEl(d, colorVar, className, opacity) {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('class', className);
  // Token-driven fill — no literal hex per §4.
  path.setAttribute('fill', `var(${colorVar})`);
  path.setAttribute('stroke', 'none');
  if (typeof opacity === 'number') path.style.opacity = String(opacity);
  return path;
}

// Public entry. Returns idempotent detach() that tears down listeners +
// removes the SVG layer.
export function attachPillRenderer(gridRoot) {
  if (!gridRoot) {
    throw new TypeError('attachPillRenderer: gridRoot must be provided');
  }

  let detached = false;
  let svg = null;
  let activePathEl = null;
  let committedCount = 0;
  // Issue #47 Path 1 — current cell-space path of the active drag, kept
  // here so SELECT_MOVE handlers can rebuild the pill geometry from
  // path[0] (the locked start cell) to the live finger position.
  let activePath = [];

  function remount() {
    svg = mountPillLayer(gridRoot);
    activePathEl = null;
    committedCount = 0;
    activePath = [];
  }
  // Initial mount — grid:ready re-mounts once cells exist if needed.
  remount();

  function clearActive() {
    if (activePathEl && activePathEl.parentNode) {
      activePathEl.parentNode.removeChild(activePathEl);
    }
    activePathEl = null;
    activePath = [];
  }

  // §6.1 220ms fade-out via CSS transition + setTimeout cleanup.
  function fadeOutActive() {
    if (!activePathEl) return;
    const el = activePathEl;
    activePathEl = null;
    if (el.style) {
      el.style.transition = `opacity ${ACTIVE_FADE_OUT_MS}ms ease-out`;
      const apply = () => { if (el.style) el.style.opacity = '0'; };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
      else apply();
    }
    setTimeout(() => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, ACTIVE_FADE_OUT_MS + 30);
  }

  // Internal: ensure the active <path> element exists with the given d
  // string. Called by both the cell-crossing renderer and the live
  // pointer-tracking renderer (#47 Path 1).
  function ensureActivePath(d) {
    if (!activePathEl) {
      activePathEl = makePathEl(d, '--pill-active', PILL_ACTIVE_CLASS);
      svg.appendChild(activePathEl);
    } else {
      activePathEl.setAttribute('d', d);
      // Reset opacity in case a fade-out was mid-flight.
      if (activePathEl.style) {
        activePathEl.style.transition = '';
        activePathEl.style.opacity = '';
      }
    }
  }

  // Render the active pill (select:start + each select:extend).
  // Cell-crossing path: pill spans path[0] → path[N-1] cell centers.
  function renderActive(cells) {
    if (!svg) return;
    const path = Array.isArray(cells) ? cells : [];
    if (path.length === 0) { clearActive(); return; }
    activePath = path.map((p) => ({ row: p.row, col: p.col }));
    const d = pathForCells(activePath, PILL_HALF_WIDTH_CELLS);
    ensureActivePath(d);
  }

  // Issue #47 Path 1 — live pointer tracking. Re-render the active pill
  // with `endXY` bound to the finger's cell-space position rather than
  // the last cell-center, so the visual leading edge follows the finger
  // smoothly between cell crossings. Called on every SELECT_MOVE.
  function renderActiveLive(cellX, cellY) {
    if (!svg) return;
    if (!Array.isArray(activePath) || activePath.length === 0) return;
    const start = cellCenter(activePath[0]);
    const d = pillPath(start, [cellX, cellY], PILL_HALF_WIDTH_CELLS);
    ensureActivePath(d);
  }

  // Commit found word as permanent pill. §6.2 alpha 0→0.55 over
  // --dur-pill-draw; geometry-expand deferred to Phase 2.
  function commitFound(payload) {
    if (!svg) return;
    if (!payload || !Array.isArray(payload.path) || payload.path.length === 0) return;
    clearActive();
    const colorVar = nextPillColor();
    const d = pathForCells(payload.path);
    const pathEl = makePathEl(d, colorVar, PILL_COMMITTED_CLASS, 0);
    pathEl.setAttribute('data-word', payload.word || '');
    pathEl.setAttribute('data-color-var', colorVar);
    svg.appendChild(pathEl);
    committedCount++;
    if (pathEl.style) {
      pathEl.style.transition = `opacity var(--dur-pill-draw, 320ms) var(--ease-overshoot, ease-out)`;
      const apply = () => { if (pathEl.style) pathEl.style.opacity = '1'; };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
      else apply();
    }
  }

  // Listeners — named fns so off() matches by identity.
  const onSelectStart = (p) => { if (p) renderActive([{ row: p.row, col: p.col }]); };
  const onSelectExtend = (p) => { if (p && Array.isArray(p.path)) renderActive(p.path); };
  // Issue #47 Path 1 — live finger tracking on every pointermove.
  const onSelectMove = (p) => {
    if (!p || typeof p.cellX !== 'number' || typeof p.cellY !== 'number') return;
    renderActiveLive(p.cellX, p.cellY);
  };
  const onSelectCancel = () => fadeOutActive();
  const onWordFound = (p) => commitFound(p);
  // word:rejected = active drag never matched → fade out.
  const onWordRejected = () => fadeOutActive();
  // grid:ready: renderGrid wiped innerHTML — re-mount + reset cycle.
  const onGridReady = () => { remount(); resetPillColors(); };
  // level:ready safety-net for any flow lacking a preceding grid:ready.
  const onLevelReady = () => {
    if (!svg || (gridRoot.querySelector && !gridRoot.querySelector(`#${PILL_LAYER_ID}`))) remount();
    resetPillColors();
  };

  on(EVENTS.SELECT_START, onSelectStart);
  on(EVENTS.SELECT_EXTEND, onSelectExtend);
  on(EVENTS.SELECT_MOVE, onSelectMove);
  on(EVENTS.SELECT_CANCEL, onSelectCancel);
  on(EVENTS.WORD_FOUND, onWordFound);
  on(EVENTS.WORD_REJECTED, onWordRejected);
  on(EVENTS.GRID_READY, onGridReady);
  on(EVENTS.LEVEL_READY, onLevelReady);

  return function detach() {
    if (detached) return;
    detached = true;
    off(EVENTS.SELECT_START, onSelectStart);
    off(EVENTS.SELECT_EXTEND, onSelectExtend);
    off(EVENTS.SELECT_MOVE, onSelectMove);
    off(EVENTS.SELECT_CANCEL, onSelectCancel);
    off(EVENTS.WORD_FOUND, onWordFound);
    off(EVENTS.WORD_REJECTED, onWordRejected);
    off(EVENTS.GRID_READY, onGridReady);
    off(EVENTS.LEVEL_READY, onLevelReady);
    if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
    svg = null;
    activePathEl = null;
    activePath = [];
    committedCount = 0;
  };
}
