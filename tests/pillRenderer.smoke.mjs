// Structural smoke for pillRenderer (#19) + colors (#19).
// Per CLAUDE.md Step 3 rule 9 / issue #19 rule 6 + 9:
//   (a) Imports both modules and asserts attachPillRenderer +
//       nextPillColor + resetPillColors are exported functions of the
//       right shape.
//   (b) Exercises nextPillColor cycling (pure module-state, Node-runnable).
//   (c) Exercises pillPath / cellCenter / pathForCells geometry with
//       concrete orthogonal + diagonal inputs and asserts positive
//       observable outcomes (real path-string structure + bounding-rect
//       computation correctness), never the negation.
//   (d) Exercises attachPillRenderer's Node-context path — no DOM
//       available, mountPillLayer should no-op cleanly without throwing,
//       and the listener wiring + detach() must work via the real
//       eventBus.
//
// TODO(#11): Promote SVG draw assertions to a Playwright spec on the
// live URL — real DOM, real renderGrid, real select+commit cycle.
// pillRenderer's full integration smoke (active drag updates DOM, found
// pill persists, color cycle wraps mod 7) is the Playwright candidate.

import {
  attachPillRenderer,
  pillPath,
  cellCenter,
  pathForCells,
} from '../src/game/pillRenderer.js';
import {
  nextPillColor,
  resetPillColors,
  _cursorForTests,
  _paletteSizeForTests,
} from '../src/game/colors.js';
import {
  _resetForTests as _resetBus,
  on,
  emit,
} from '../src/engine/eventBus.js';
import { EVENTS } from '../src/engine/constants.js';

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('PASS ' + msg);
  else { console.error('FAIL ' + msg); failed++; }
}

// ----- 1. Export shape -------------------------------------------------------

assert(typeof attachPillRenderer === 'function',
  'pillRenderer exports attachPillRenderer as a function');
assert(attachPillRenderer.length === 1,
  'attachPillRenderer accepts one argument (gridRoot)');
assert(typeof nextPillColor === 'function',
  'colors exports nextPillColor as a function');
assert(typeof resetPillColors === 'function',
  'colors exports resetPillColors as a function');
assert(typeof pillPath === 'function',
  'pillRenderer exports pillPath helper');
assert(typeof cellCenter === 'function',
  'pillRenderer exports cellCenter helper');
assert(typeof pathForCells === 'function',
  'pillRenderer exports pathForCells helper');

// ----- 2. nextPillColor cycle ------------------------------------------------

resetPillColors();
const palette = _paletteSizeForTests();
assert(palette === 7,
  `palette size === 7 per BUILD_SPEC.md §4.1 (got ${palette})`);

const first = nextPillColor();
assert(first === '--pill-1',
  `first nextPillColor() after reset === "--pill-1" (got ${first})`);

const seq = [first];
for (let i = 1; i < palette; i++) seq.push(nextPillColor());
assert(seq[palette - 1] === `--pill-${palette}`,
  `nextPillColor() at slot ${palette} === "--pill-${palette}"`);

const wrap = nextPillColor();
assert(wrap === '--pill-1',
  `nextPillColor() wraps mod ${palette} back to "--pill-1" (got ${wrap})`);

resetPillColors();
assert(_cursorForTests() === 0,
  'resetPillColors() returns the cursor to 0');
assert(nextPillColor() === '--pill-1',
  'after resetPillColors() the next color is --pill-1 again');

// ----- 3. cellCenter convention ---------------------------------------------

const c00 = cellCenter({ row: 0, col: 0 });
assert(c00[0] === 0.5 && c00[1] === 0.5,
  'cellCenter({0,0}) === (0.5, 0.5) — top-left cell center in cell-space');

const c34 = cellCenter({ row: 3, col: 4 });
assert(c34[0] === 4.5 && c34[1] === 3.5,
  'cellCenter({row:3,col:4}) === (4.5, 3.5) — col is x, row is y');

// ----- 4. pillPath orthogonal + diagonal geometry ---------------------------

// Horizontal 3-cell path: cells (0,0)..(0,2). Centers (0.5,0.5)..(2.5,0.5).
// Stadium width = 0.78 cells → halfWidth 0.39. Perpendicular is vertical.
// p1 = (sx + 0, sy + 0.39) = (0.5, 0.89). p2 = (2.5, 0.89). p3 = (2.5, 0.11).
// p4 = (0.5, 0.11). Path opens with "M 0.5 0.89 L 2.5 0.89".
const horiz = pillPath([0.5, 0.5], [2.5, 0.5], 0.39);
assert(typeof horiz === 'string' && horiz.length > 0,
  'pillPath returns a non-empty SVG path string');
assert(horiz.startsWith('M '),
  'pillPath output begins with an SVG M (moveto) command');
assert(horiz.includes('A 0.39 0.39'),
  'pillPath uses halfWidth as both rx and ry on the arc segments');
assert((horiz.match(/A 0\.39 0\.39/g) || []).length === 2,
  'pillPath produces exactly 2 arc segments (the 2 stadium caps)');
assert(horiz.endsWith(' Z'),
  'pillPath closes the stadium with Z');
// Bounding-box correctness: parse only the (x,y) coord PAIRS attached to
// drawing commands (M, L, A's endpoint), skipping arc flags. Per SVG
// spec the A command takes 7 args: rx ry x-axis-rotation large-arc-flag
// sweep-flag x y. Walk the path token stream and pull endpoint pairs.
function endpointXYs(d) {
  const tokens = d.trim().split(/\s+/);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === 'M' || t === 'L') {
      out.push([Number(tokens[i + 1]), Number(tokens[i + 2])]);
      i += 3;
    } else if (t === 'A') {
      // skip rx ry rot large sweep, take x y
      out.push([Number(tokens[i + 6]), Number(tokens[i + 7])]);
      i += 8;
    } else if (t === 'Z') {
      i += 1;
    } else {
      i += 1;
    }
  }
  return out;
}
{
  const pts = endpointXYs(horiz);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  assert(Math.abs(xMin - 0.5) < 1e-9 && Math.abs(xMax - 2.5) < 1e-9,
    `horizontal pill x-extent === [0.5, 2.5] (got [${xMin}, ${xMax}])`);
  // y extents perp to drag = 0.5 ± 0.39 → [0.11, 0.89].
  assert(Math.abs(yMin - 0.11) < 1e-9 && Math.abs(yMax - 0.89) < 1e-9,
    `horizontal pill y-extent === [0.11, 0.89] (got [${yMin}, ${yMax}])`);
}

// Diagonal 3-cell path: cells (0,0), (1,1), (2,2). Centers (0.5,0.5),(2.5,2.5).
// dx=2, dy=2, len=2√2. Perpendicular px = -dy/len*halfWidth = -0.39/√2.
// |px| = |py| = 0.39/√2 ≈ 0.2758. So x-extent [0.5 - 0.2758, 2.5 + 0.2758]
// = [~0.2242, ~2.7758]. Exact values verified below.
const diag = pillPath([0.5, 0.5], [2.5, 2.5], 0.39);
{
  const pts = endpointXYs(diag);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const expectOffset = 0.39 / Math.SQRT2;
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  assert(Math.abs(xMin - (0.5 - expectOffset)) < 1e-9,
    `diagonal pill xMin === 0.5 - 0.39/√2 (got ${xMin.toFixed(6)})`);
  assert(Math.abs(xMax - (2.5 + expectOffset)) < 1e-9,
    `diagonal pill xMax === 2.5 + 0.39/√2 (got ${xMax.toFixed(6)})`);
  assert(Math.abs(yMin - (0.5 - expectOffset)) < 1e-9,
    `diagonal pill yMin === 0.5 - 0.39/√2 (got ${yMin.toFixed(6)})`);
  assert(Math.abs(yMax - (2.5 + expectOffset)) < 1e-9,
    `diagonal pill yMax === 2.5 + 0.39/√2 (got ${yMax.toFixed(6)})`);
}

// Single-cell degenerate: full-circle path with 2 arcs.
const single = pillPath([1.5, 1.5], [1.5, 1.5], 0.39);
assert(single.includes('A 0.39 0.39'),
  'single-cell pill uses halfWidth arc radii');
assert((single.match(/A 0\.39 0\.39/g) || []).length === 2,
  'single-cell pill is a 2-arc full circle (degenerate stadium)');

// ----- 5. pathForCells edge cases -------------------------------------------

assert(pathForCells([]) === '',
  'pathForCells([]) === "" (empty path → no SVG)');
assert(typeof pathForCells([{ row: 0, col: 0 }]) === 'string',
  'pathForCells of length 1 returns a degenerate-circle string');

const orthoPath = pathForCells([
  { row: 0, col: 0 },
  { row: 0, col: 1 },
  { row: 0, col: 2 },
]);
assert(orthoPath.length > 0 && orthoPath.startsWith('M '),
  'pathForCells of an H-3 path returns a non-empty M-prefixed string');

// ----- 6. attachPillRenderer in Node — listeners wire + detach() works ------

_resetBus();

// Stand up a minimal stub that satisfies pillRenderer's gridRoot probes
// (no real DOM under Node 20). mountPillLayer falls through cleanly when
// document.createElementNS is absent — we assert no throw + listeners
// still fire in response to canonical events.
const stubGridRoot = {
  getAttribute() { return null; },
  querySelector() { return null; },
};

// In Node, document is undefined → mountPillLayer returns null. The
// renderer's render/commit functions then early-return on `if (!svg)`,
// but listeners must still detach cleanly without throwing.
let detach;
let threw = null;
try {
  detach = attachPillRenderer(stubGridRoot);
} catch (e) {
  threw = e;
}
assert(threw === null,
  'attachPillRenderer(stubGridRoot) does not throw under Node (no-DOM path)');
assert(typeof detach === 'function',
  'attachPillRenderer returns a detach() function');

// Verify listeners are wired by emitting events the renderer subscribes
// to. The handlers early-return on missing svg, but the eventBus delivery
// path must succeed (no thrown errors leaked through).
let busThrew = false;
try {
  emit(EVENTS.SELECT_START, { row: 0, col: 0 });
  emit(EVENTS.SELECT_EXTEND, { path: [{ row: 0, col: 0 }, { row: 0, col: 1 }] });
  emit(EVENTS.SELECT_CANCEL, { reason: 'smoke' });
  emit(EVENTS.WORD_FOUND, { word: 'TEST', path: [{ row: 0, col: 0 }, { row: 0, col: 3 }], dir: 'H' });
  emit(EVENTS.WORD_REJECTED, { path: [{ row: 0, col: 0 }, { row: 0, col: 1 }] });
  emit(EVENTS.GRID_READY, { rows: 4, cols: 4, mountEl: stubGridRoot });
  emit(EVENTS.LEVEL_READY, { level: { id: 1 }, grid: { rows: 4, cols: 4 }, placements: [] });
} catch (e) {
  busThrew = true;
  console.error('listener delivery threw:', e);
}
assert(!busThrew,
  'all 7 canonical pillRenderer events deliver without throwing');

// detach() must be idempotent.
detach();
detach();
assert(true, 'detach() called twice without throwing (idempotent)');

// After detach, color cycle should still be addressable (it's a separate
// module). resetPillColors was called during the LEVEL_READY emit above
// and grid:ready before that. Cursor should be 0 (post-reset).
assert(_cursorForTests() === 0,
  'after grid:ready/level:ready emits, color cursor is 0 (cycle reset)');

// ----- 7. Color cycle survives detach + re-attach ---------------------------

resetPillColors();
const colorBefore = nextPillColor();
const colorBefore2 = nextPillColor();
assert(colorBefore === '--pill-1' && colorBefore2 === '--pill-2',
  'color cycle advances --pill-1 → --pill-2 across consecutive calls');

const detach2 = attachPillRenderer(stubGridRoot);
detach2();
// Cursor unchanged — colors module is independent of attach lifecycle
// when no level/grid:ready event fires between attach and detach.
assert(_cursorForTests() === 2,
  'attach + immediate detach (no events) leaves color cursor untouched');

resetPillColors();

// ----- Summary --------------------------------------------------------------

if (failed > 0) {
  console.error(`\n${failed} smoke assertion(s) failed`);
  process.exit(1);
}
console.log('\npillRenderer.smoke.mjs — all assertions passed');
