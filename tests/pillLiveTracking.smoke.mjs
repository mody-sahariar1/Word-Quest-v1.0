// Runtime-fidelity smoke for Issue #47 Path 1 — live pointer tracking.
//
// Asserts the behavior the bug demands: during a synthetic drag from
// cell A to cell B with K intermediate pointermove events between the
// two cell-crossings, the active pill <path>'s `d` attribute updates
// MORE OFTEN than the cell-crossing (SELECT_EXTEND) event count.
//
// Per CLAUDE.md Step 3 rule 9 + memory feedback_smoke_runtime_path_divergence
// + memory feedback_build_green_not_feature_working:
//   - Hits the renderer's runtime entry: actual attachPillRenderer() +
//     actual eventBus delivery + actual mountPillLayer setAttribute calls.
//   - Asserts a POSITIVE state (count of d-attribute writes > count of
//     SELECT_EXTEND emits), not the negation.
//   - Source-text-only smokes were the WQ #46 failure mode (factory #123)
//     — this one observes the d-attribute history during the synthetic
//     drag, not the source code.
//
// Stub strategy: Node 20 has no DOM, and bringing in jsdom would touch
// package.json (a hard-excluded path). Build a focused DOM stub that
// satisfies (a) mountPillLayer's createElementNS + appendChild path,
// (b) renderActiveLive's setAttribute('d', …) write path, while keeping
// a counter on every d-attribute write. The runtime wiring under test
// is the eventBus → onSelectMove → renderActiveLive → setAttribute('d')
// chain; that chain runs identically in this stub and in a real browser.
//
// TODO(#11): a Playwright spec on the live URL with real pointer events
// is the higher-fidelity follow-up. WQ does not yet wire Playwright into
// `npm run validate` — flagged as a factory observation with #47.

import {
  attachPillRenderer,
} from '../src/game/pillRenderer.js';
import {
  _resetForTests as _resetBus,
  emit,
} from '../src/engine/eventBus.js';
import { EVENTS } from '../src/engine/constants.js';

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('PASS ' + msg);
  else { console.error('FAIL ' + msg); failed++; }
}

// ----- DOM stub ------------------------------------------------------------

// Track every d-attribute write on every <path> element the renderer
// creates. Counter is shared across paths because we only care about
// "the pill <path> mutated d more times than SELECT_EXTEND fired".
let dWriteCount = 0;
const dHistory = [];

function makeStubElement(tag) {
  const el = {
    tagName: tag,
    nodeType: 1,
    children: [],
    parentNode: null,
    style: {},
    _attrs: Object.create(null),
    setAttribute(name, value) {
      this._attrs[name] = value;
      if (name === 'd') {
        dWriteCount++;
        dHistory.push(value);
      }
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name)
        ? this._attrs[name]
        : null;
    },
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i !== -1) this.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    querySelector(_sel) {
      // The renderer queries `#${PILL_LAYER_ID}` to dedupe before
      // mount + after detach. Walk children for a matching id.
      const want = _sel.replace(/^#/, '');
      for (const c of this.children) {
        if (c._attrs && c._attrs.id === want) return c;
      }
      return null;
    },
  };
  return el;
}

// Minimal global document — only what mountPillLayer probes.
const stubDocument = {
  createElementNS(_ns, tag) {
    return makeStubElement(tag);
  },
};

const prevDocument = globalThis.document;
globalThis.document = stubDocument;
const prevRAF = globalThis.requestAnimationFrame;
// Synchronous rAF — keeps timers off the critical path of this test.
globalThis.requestAnimationFrame = (fn) => { try { fn(); } catch (_) {} return 0; };

// Stub gridRoot: behaves like the real #grid-root in renderGrid output.
const gridRoot = makeStubElement('div');
gridRoot._attrs['data-rows'] = '4';
gridRoot._attrs['data-cols'] = '4';

// ----- Wire the renderer ---------------------------------------------------

_resetBus();

let detach;
let threw = null;
try {
  detach = attachPillRenderer(gridRoot);
} catch (e) {
  threw = e;
}
assert(threw === null,
  'attachPillRenderer mounts cleanly against the runtime DOM stub');
assert(typeof detach === 'function',
  'attachPillRenderer returns a detach() function');

// Confirm the SVG layer mounted (mountPillLayer ran the createElementNS path).
const svg = gridRoot.children.find((c) => c._attrs && c._attrs.id === 'pill-layer');
assert(!!svg,
  'mountPillLayer attached an #pill-layer SVG to the gridRoot stub');
assert(svg && svg.tagName === 'svg',
  'pill-layer element is an <svg>');

// ----- Drive a synthetic drag ----------------------------------------------

// Simulated drag from cell (0,0) → cell (0,3) with intermediate pointer
// positions between each cell-crossing. The selector in real life would
// emit SELECT_EXTEND at each cell-crossing and SELECT_MOVE on every
// pointermove. We replay that pattern over the eventBus to test the
// renderer's wiring directly.

// Reset counters AFTER the initial mount + (optional) initial render so
// they only capture the drag.
const dWriteCountBefore = dWriteCount;

// SELECT_START at cell (0,0) — renderer creates the <path> + writes 'd'.
emit(EVENTS.SELECT_START, { row: 0, col: 0 });
const dAfterStart = dWriteCount;
assert(dAfterStart > dWriteCountBefore,
  'SELECT_START triggers an initial d-attribute write (single-cell pill mounts)');

// Reset history to count just the drag itself.
const dWriteCountAtDragStart = dWriteCount;

// Drag plan:
//   start (0,0) → cell (0,1) → cell (0,2) → cell (0,3)
//   3 cell-crossings (SELECT_EXTEND emits)
//   between each crossing, 4 SELECT_MOVE emits with intermediate finger
//     positions in cell-space (1 viewBox unit = 1 cell)
//   total: 3 extends + 12 moves = 15 d-writes expected
const crossings = [
  [{ row: 0, col: 0 }, { row: 0, col: 1 }],
  [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }],
  [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }],
];

let extendCount = 0;
let moveCount = 0;

for (let i = 0; i < crossings.length; i++) {
  // 4 intermediate pointer-moves in cell-space, walking from the last
  // cell-center to the next one. (real pointermove fires far more often
  // than this — 4 is sufficient to prove "moves > extends").
  const fromCol = i === 0 ? 0.5 : i + 0.5 - 1; // last cell center x in cell-space
  const toCol = i + 1 + 0.5;                    // next cell center x
  const cellY = 0.5;
  for (let k = 1; k <= 4; k++) {
    const t = k / 5;                            // 0.2, 0.4, 0.6, 0.8
    const cellX = fromCol + (toCol - fromCol) * t;
    emit(EVENTS.SELECT_MOVE, { cellX, cellY, path: crossings[i].slice(0, i + 1) });
    moveCount++;
  }
  // Cell-crossing — selector would emit SELECT_EXTEND with the new path.
  emit(EVENTS.SELECT_EXTEND, { path: crossings[i] });
  extendCount++;
}

const dWriteCountAfterDrag = dWriteCount;
const dWritesDuringDrag = dWriteCountAfterDrag - dWriteCountAtDragStart;

assert(extendCount === 3,
  `SELECT_EXTEND fired exactly 3 times (one per cell-crossing) — got ${extendCount}`);
assert(moveCount === 12,
  `SELECT_MOVE fired exactly 12 times (4 between each of 3 crossings) — got ${moveCount}`);
assert(dWritesDuringDrag === extendCount + moveCount,
  `pill d-attribute updated once per emit: expected ${extendCount + moveCount}, got ${dWritesDuringDrag}`);

// THE CORE ASSERTION: the d attribute updates more often than the
// SELECT_EXTEND count. This is what proves Issue #47 Path 1 is in effect
// — pointermove-driven updates are reaching the pill, not just
// cell-crossing-driven ones. Before the fix, this number would equal
// extendCount (or extendCount + 1 for the start).
assert(dWritesDuringDrag > extendCount,
  `pill d-writes during drag (${dWritesDuringDrag}) > SELECT_EXTEND count (${extendCount}) — ` +
  'pointermove-driven updates ARE reaching the active pill (#47 Path 1)');

// History sanity: each d-string is a non-empty SVG path beginning with M.
const tail = dHistory.slice(-dWritesDuringDrag);
let allValid = true;
for (const d of tail) {
  if (typeof d !== 'string' || !d.startsWith('M ') || !d.endsWith(' Z')) {
    allValid = false;
    break;
  }
}
assert(allValid,
  'every d-attribute write during the drag is a well-formed M…Z stadium path');

// Successive d strings differ — the pill geometry is actually changing,
// not just being re-set to the same value. (Defends against a regression
// where renderActiveLive computes the same string each move.)
const uniqueDs = new Set(tail);
assert(uniqueDs.size > extendCount,
  `unique d-strings during drag (${uniqueDs.size}) > extend count (${extendCount}) — ` +
  'pill geometry is actually moving with the finger, not snapping');

// ----- Issue 1 — halfWidth defaults to 0.5 (1.0 × cell) --------------------
//
// Confirms the runtime constant flipped from 0.39 to 0.5. Asserts on the
// d-string the renderer actually produced for the start-of-drag pill,
// which encodes halfWidth as the SVG arc radius. Per pillPath() spec the
// arc radii equal halfWidth, so a string containing "A 0.5 0.5" proves
// the new constant is the live value.

const startPill = dHistory[dHistory.length - dWritesDuringDrag - 1] || dHistory[0];
assert(typeof startPill === 'string' && /A\s+0\.5\s+0\.5\b/.test(startPill),
  `start-of-drag pill encodes halfWidth = 0.5 in arc radii (full perpendicular cell coverage #47) — got "${startPill ? startPill.slice(0, 80) : 'undefined'}"`);

// ----- Cleanup -------------------------------------------------------------

detach();
globalThis.document = prevDocument;
globalThis.requestAnimationFrame = prevRAF;

if (failed > 0) {
  console.error(`\n${failed} smoke assertion(s) failed`);
  process.exit(1);
}
console.log('\npillLiveTracking.smoke.mjs — all assertions passed');
