// Grid model + DOM render — first piece of gameplay.
// Per BUILD_SPEC.md §5.3.4 (Grid card layout) + §6 (4×4..8×8 grid sizes).
// Issue #5.
//
// Shape: pure data model (`createGrid`) and a thin DOM renderer
// (`renderGrid`). No input, no selection — those land in later issues
// (#~6 selector, #~7 generator). The substrate every other gameplay
// piece will plug into.
//
// Spec note: §5.3.4 specifies `<div class="cell">` containing
// `<span class="letter">`. Issue #5 originally rendered cells as
// `<button>` for keyboard focus + screen-reader semantics. That
// upgrade was reverted in #37: real iOS Safari + Android Chrome do
// not deliver continuous `pointermove` events while a finger drags
// across `<button>` elements (the OS treats each button as its own
// tap-cancel zone), which made the deployed game unplayable. Cells
// now render as `<div>` per the spec; aria-label preserves the
// screen-reader announcement.

import { emit } from '../engine/eventBus.js';
import { EVENTS } from '../engine/constants.js';

const MIN_DIM = 4;
const MAX_DIM = 8;

function _validateDim(name, value) {
  if (!Number.isInteger(value) || value < MIN_DIM || value > MAX_DIM) {
    throw new RangeError(
      `grid: ${name} must be an integer in [${MIN_DIM}, ${MAX_DIM}], got ${value}`
    );
  }
}

function _validateLetters(rows, cols, letters) {
  if (!Array.isArray(letters) || letters.length !== rows) {
    throw new TypeError(
      `grid: letters must be a ${rows}-row array, got ${
        Array.isArray(letters) ? letters.length + '-row' : typeof letters
      }`
    );
  }
  for (let r = 0; r < rows; r++) {
    const row = letters[r];
    if (!Array.isArray(row) || row.length !== cols) {
      throw new TypeError(
        `grid: row ${r} must be a ${cols}-column array, got ${
          Array.isArray(row) ? row.length + '-col' : typeof row
        }`
      );
    }
    for (let c = 0; c < cols; c++) {
      const ch = row[c];
      // Lenient: any single non-empty character. §6 doesn't pin A–Z, and
      // future themed grids may want localized letters. Sanity check is
      // "exactly one character".
      if (typeof ch !== 'string' || ch.length !== 1) {
        throw new TypeError(
          `grid: cell (${r},${c}) must be a single-character string, got ${JSON.stringify(ch)}`
        );
      }
    }
  }
}

// Pure data: { rows, cols, letters: string[][], at(row, col) }
// `letters` is deep-cloned so callers can't mutate the model.
export function createGrid(rows, cols, letters) {
  _validateDim('rows', rows);
  _validateDim('cols', cols);
  _validateLetters(rows, cols, letters);

  const cloned = letters.map((row) => row.slice());
  Object.freeze(cloned);
  for (const row of cloned) Object.freeze(row);

  return Object.freeze({
    rows,
    cols,
    letters: cloned,
    at(r, c) {
      if (!Number.isInteger(r) || r < 0 || r >= rows) {
        throw new RangeError(`grid.at: row ${r} out of range [0, ${rows - 1}]`);
      }
      if (!Number.isInteger(c) || c < 0 || c >= cols) {
        throw new RangeError(`grid.at: col ${c} out of range [0, ${cols - 1}]`);
      }
      return cloned[r][c];
    },
  });
}

// Render the model into mountEl as a CSS Grid of <button> cells.
// Idempotent — clears mountEl first; safe to call again on re-mount.
// Returns mountEl so callers can query cells back.
export function renderGrid(grid, mountEl) {
  if (!grid || typeof grid.rows !== 'number' || typeof grid.cols !== 'number') {
    throw new TypeError('renderGrid: grid arg missing or malformed');
  }
  if (!mountEl || typeof mountEl.appendChild !== 'function') {
    throw new TypeError('renderGrid: mountEl must be a DOM element');
  }

  // Idempotent re-mount.
  mountEl.innerHTML = '';

  // Drive grid-template via CSS custom properties so grid.css doesn't
  // need to know rows/cols at author-time. Also expose data-* for
  // size-conditional CSS overrides if ever needed.
  mountEl.style.setProperty('--grid-cols', String(grid.cols));
  mountEl.style.setProperty('--grid-rows', String(grid.rows));
  mountEl.setAttribute('data-rows', String(grid.rows));
  mountEl.setAttribute('data-cols', String(grid.cols));

  // Single batched insert — one DOM mutation, not rows*cols.
  const frag = document.createDocumentFragment();
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const letter = grid.letters[r][c];
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      // Accessible label so screen readers announce position + letter.
      cell.setAttribute('aria-label', `Letter ${letter} at row ${r + 1} column ${c + 1}`);
      cell.textContent = letter;
      frag.appendChild(cell);
    }
  }
  mountEl.appendChild(frag);

  // Tell the rest of the world the grid is live. Payload mirrors
  // BUILD_SPEC.md §3.4 conventions: minimal + structural.
  emit(EVENTS.GRID_READY, { rows: grid.rows, cols: grid.cols, mountEl });

  return mountEl;
}
