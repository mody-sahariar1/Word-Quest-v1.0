// Pill color cycler — hands out --pill-1..--pill-N CSS-variable references
// in order, wrapping mod N. Per BUILD_SPEC.md §4.1 (palette tokens) +
// §6.2 (one color per found word) + the §4.1 note: "when a word is found,
// assign the next color in the cycle (mod 7)". Issue #19.
//
// The palette is defined in tokens.css as --pill-1..--pill-7. This helper
// returns the *token name* (e.g. "--pill-3"), not the literal hex — so
// callers stay token-driven and a future palette swap in tokens.css is
// invisible to this file. No deps; pure module-state so it can be exercised
// in Node smoke tests without a DOM.

// Palette length — must match the count of --pill-N variables defined in
// tokens.css §4.1. Spec pins 7 (lavender → lilac); if tokens.css gains
// more, bump this constant in lockstep. Don't compute from getComputedStyle:
// keeps the helper Node-runnable for smoke tests.
const PALETTE_SIZE = 7;

let _index = 0;

// Hand out the next CSS-variable name in the cycle and advance the cursor.
// Returns the variable name (e.g. "--pill-3"); callers wrap it in
// `var(...)` when applying to fill/color properties.
export function nextPillColor() {
  const slot = (_index % PALETTE_SIZE) + 1; // 1..PALETTE_SIZE
  _index++;
  return `--pill-${slot}`;
}

// Reset the cursor — call on level reset so the first found word on a
// new level always lands on --pill-1 again. §4.1 note: "Persist the
// assignment for that level". A reset between levels is the correct
// semantics for a per-level color cycle.
export function resetPillColors() {
  _index = 0;
}

// Test/debug helper — exposes the cursor so smoke tests assert positive
// state without re-deriving it through repeated nextPillColor() calls.
// Not used in app code.
export function _cursorForTests() {
  return _index;
}

// Test/debug helper — palette length so smoke tests verify the wrap-mod
// behavior without hard-coding 7 in the test file.
export function _paletteSizeForTests() {
  return PALETTE_SIZE;
}
