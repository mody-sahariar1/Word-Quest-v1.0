// Runtime-fidelity smoke for selector.attachSelector (#17).
// Per CLAUDE.md Step 3 rule 9 / issue #17 rule 8:
//   (a) call the runtime entry the player reaches — attachSelector(gridRoot)
//       wired to the actual DOM the renderer produces.
//   (b) assert positive states (returns a function; emits SELECT_START
//       on pointerdown over a real cell), never the negation.
//
// Node 20 has no DOM, so this test stubs the minimum surface selector
// touches: document, an addEventListener-bearing element, ev.target +
// dataset + textContent + closest, getBoundingClientRect, elementFromPoint,
// setPointerCapture / releasePointerCapture / hasPointerCapture.
//
// TODO(#11): Promote to a Playwright spec on the live URL — it can drive
// real PointerEvents and verify drag → SELECT_END.word equals the letters
// the player sees. Issue #17 rule 8 explicitly flags this as a Playwright
// candidate; #11 is the issue picking it up.

import { _resetForTests, on } from '../src/engine/eventBus.js';
import { EVENTS } from '../src/engine/constants.js';

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('PASS ' + msg);
  else { console.error('FAIL ' + msg); failed++; }
}

// ----- DOM stub -----------------------------------------------------------

function makeStubElement({ row, col, letter, parent }) {
  const listeners = new Map();
  const el = {
    nodeType: 1,
    className: 'cell',
    dataset: { row: String(row), col: String(col) },
    textContent: letter,
    parent,
    closest(sel) {
      // Selector test: we only ever ask for `.cell`. The cell is its own
      // closest('.cell'); any other selector returns null.
      if (sel === '.cell') return this;
      return null;
    },
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      if (listeners.has(name)) listeners.get(name).delete(fn);
    },
    dispatch(name, ev) {
      const set = listeners.get(name);
      if (!set) return;
      for (const fn of [...set]) fn(ev);
    },
    _listeners: listeners,
  };
  return el;
}

function makeStubGridRoot(rows, cols, letters) {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(makeStubElement({ row: r, col: c, letter: letters[r][c] }));
    }
  }

  const listeners = new Map();
  let captured = null;
  const root = {
    nodeType: 1,
    _cells: cells,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      if (listeners.has(name)) listeners.get(name).delete(fn);
    },
    dispatch(name, ev) {
      const set = listeners.get(name);
      if (!set) return;
      for (const fn of [...set]) fn(ev);
    },
    querySelector(sel) {
      // selector.js asks: .cell[data-row="R"][data-col="C"]
      const m = /data-row="(\d+)"\]\[data-col="(\d+)"/.exec(sel);
      if (!m) return null;
      const r = Number(m[1]);
      const c = Number(m[2]);
      return cells.find((cc) => cc.dataset.row === String(r) && cc.dataset.col === String(c)) || null;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 1000 }),
    setPointerCapture: (id) => { captured = id; },
    releasePointerCapture: (id) => { if (captured === id) captured = null; },
    hasPointerCapture: (id) => captured === id,
    ownerDocument: null, // patched below
  };

  // ownerDocument exposes elementFromPoint backed by a simple coord map.
  // We synthesize coordinates on dispatch: cell (r,c) → x = c*10+5, y = r*10+5.
  const doc = {
    elementFromPoint(x, y) {
      const c = Math.floor(x / 10);
      const r = Math.floor(y / 10);
      if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
      return cells.find((cc) => cc.dataset.row === String(r) && cc.dataset.col === String(c)) || null;
    },
  };
  root.ownerDocument = doc;
  return { root, cells, doc };
}

function pointAt(row, col) { return { x: col * 10 + 5, y: row * 10 + 5 }; }

// ----- Globals selector.js touches --------------------------------------

if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = { now: () => Date.now() };
}

// ----- Tests --------------------------------------------------------------

const { attachSelector } = await import('../src/game/selector.js');

assert(typeof attachSelector === 'function', 'attachSelector is a function');

const letters = [
  ['C', 'A', 'T', 'X'],
  ['A', 'P', 'P', 'L'],
  ['T', 'O', 'M', 'E'],
  ['Z', 'Y', 'X', 'W'],
];
const { root, cells } = makeStubGridRoot(4, 4, letters);

_resetForTests();

const detach = attachSelector(root);
assert(typeof detach === 'function', 'attachSelector returns a detach function');

// Subscribe to all four selector events.
const events = [];
on(EVENTS.SELECT_START, (p) => events.push(['start', p]));
on(EVENTS.SELECT_EXTEND, (p) => events.push(['extend', p]));
on(EVENTS.SELECT_END, (p) => events.push(['end', p]));
on(EVENTS.SELECT_CANCEL, (p) => events.push(['cancel', p]));

// Drag CAT (0,0) → (0,1) → (0,2) → up.
function pdown(target, pt, button = 0) {
  root.dispatch('pointerdown', {
    pointerId: 1, button,
    target,
    clientX: pt.x, clientY: pt.y,
    preventDefault() {},
  });
}
function pmove(pt) {
  root.dispatch('pointermove', {
    pointerId: 1,
    clientX: pt.x, clientY: pt.y,
    preventDefault() {},
  });
}
function pup(pt) {
  root.dispatch('pointerup', {
    pointerId: 1,
    clientX: pt.x, clientY: pt.y,
    preventDefault() {},
  });
}

const cellAt = (r, c) =>
  cells.find((cc) => cc.dataset.row === String(r) && cc.dataset.col === String(c));

pdown(cellAt(0, 0), pointAt(0, 0));
pmove(pointAt(0, 1));
pmove(pointAt(0, 2));
pup(pointAt(0, 2));

const startEv = events.find((e) => e[0] === 'start');
assert(!!startEv && startEv[1].row === 0 && startEv[1].col === 0, 'select:start fires with {row:0,col:0}');

const extendEvs = events.filter((e) => e[0] === 'extend');
assert(extendEvs.length >= 2, 'select:extend fires at least twice over a 3-cell drag');
assert(extendEvs[extendEvs.length - 1][1].path.length === 3, 'final extend has path length 3');

const endEv = events.find((e) => e[0] === 'end');
assert(!!endEv, 'select:end fires on pointerup');
assert(endEv && endEv[1].word === 'CAT', `select:end.word === "CAT" (got ${JSON.stringify(endEv && endEv[1].word)})`);
assert(endEv && endEv[1].path.length === 3 && endEv[1].path[0].col === 0 && endEv[1].path[2].col === 2, 'end path covers (0,0)→(0,1)→(0,2)');
assert(endEv && typeof endEv[1].durationMs === 'number' && endEv[1].durationMs >= 0, 'end carries non-negative durationMs');

// Backtracking — drag (0,0) → (0,1) → (0,2) → back to (0,1) → up.
events.length = 0;
pdown(cellAt(0, 0), pointAt(0, 0));
pmove(pointAt(0, 1));
pmove(pointAt(0, 2));
pmove(pointAt(0, 1));
pup(pointAt(0, 1));
const back = events.find((e) => e[0] === 'end');
assert(!!back && back[1].path.length === 2 && back[1].word === 'CA',
  `backtracking shrinks path → word "CA" (got ${JSON.stringify(back && back[1].word)})`);

// Direction lock — drag (1,0) → (1,1) [locks H]. (0,2) is off-line; should snap back, NOT cancel.
events.length = 0;
pdown(cellAt(1, 0), pointAt(1, 0));
pmove(pointAt(1, 1));      // locks horizontal
pmove(pointAt(0, 2));      // off-line — must snap back (path unchanged)
pup(pointAt(1, 1));        // release on (1,1) → word "AP"
const lockEnd = events.find((e) => e[0] === 'end');
assert(!!lockEnd && lockEnd[1].word === 'AP',
  `veer-off snaps back; word stays "AP" (got ${JSON.stringify(lockEnd && lockEnd[1].word)})`);
const sawCancel = events.some((e) => e[0] === 'cancel');
assert(!sawCancel, 'no select:cancel during veer-off snap-back');

// Cancel — pointercancel mid-drag.
events.length = 0;
pdown(cellAt(0, 0), pointAt(0, 0));
pmove(pointAt(0, 1));
root.dispatch('pointercancel', { pointerId: 1 });
const cancelEv = events.find((e) => e[0] === 'cancel');
assert(!!cancelEv && cancelEv[1].reason === 'pointercancel', 'pointercancel emits select:cancel with reason');

// Right-click cancels.
events.length = 0;
pdown(cellAt(0, 0), pointAt(0, 0));
pmove(pointAt(0, 1));
root.dispatch('pointerdown', {
  pointerId: 2, button: 2, target: cellAt(0, 0),
  clientX: 5, clientY: 5, preventDefault() {},
});
const rcCancel = events.find((e) => e[0] === 'cancel');
assert(!!rcCancel && rcCancel[1].reason === 'right-click', 'right-click pointerdown cancels with reason "right-click"');

// Out-of-bounds cancels.
events.length = 0;
pdown(cellAt(0, 0), pointAt(0, 0));
pmove(pointAt(0, 1));
pmove({ x: 9999, y: 9999 });
const oob = events.find((e) => e[0] === 'cancel');
assert(!!oob && oob[1].reason === 'out-of-bounds', 'leaving grid bounds cancels with reason "out-of-bounds"');

// Diagonal lock — start (0,0) → (1,1) → (2,2). word = letters along D1 = "C P M".
events.length = 0;
pdown(cellAt(0, 0), pointAt(0, 0));
pmove(pointAt(1, 1));   // diagonal — locks D1
pmove(pointAt(2, 2));
pup(pointAt(2, 2));
const diagEnd = events.find((e) => e[0] === 'end');
assert(!!diagEnd && diagEnd[1].word === 'CPM',
  `diagonal drag spells "CPM" (got ${JSON.stringify(diagEnd && diagEnd[1].word)})`);
assert(!!diagEnd && diagEnd[1].path.length === 3, 'diagonal path has length 3');

// detach() cleans up — a pointerdown after detach emits nothing.
events.length = 0;
detach();
pdown(cellAt(0, 0), pointAt(0, 0));
pup(pointAt(0, 0));
assert(events.length === 0, 'after detach() no events fire');

if (failed > 0) {
  console.error(`\n${failed} smoke assertion(s) failed`);
  process.exit(1);
}
console.log('\nselector.smoke.mjs — all assertions passed');
