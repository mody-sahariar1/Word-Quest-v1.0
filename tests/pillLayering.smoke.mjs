// Pill-layering structural smoke (#45 / #46 follow-up to #43).
//
// Asserts the deterministic z-order between the cell layer and the pill
// SVG layer. The fix sequence:
//
//   #43: cells <button> → <div>; SVG static-position. FAILED on real
//        iOS Safari + Android — cell white background painted over pill.
//   #45: cells `position: relative; z-index: 1`; SVG sibling
//        `position: relative; z-index: 2`. STILL FAILED — cell stacking
//        contexts (transform / opacity / isolation) walled off the SVG
//        sibling regardless of z-index value.
//   #46: SVG pulled OUT of the cell-sibling stacking model entirely:
//        - `#grid-root { position: relative }` provides the containing
//          block so the absolute child resolves against the grid card.
//        - SVG: `position: absolute; inset: 0; pointer-events: none;
//          z-index: 2`. No longer a grid sibling, no longer subject to
//          per-cell stacking-context walls.
//
// Per CLAUDE.md Step 3 rule 9 (#43) + memory feedback_smoke_runtime_path_divergence:
//   - Hits the runtime entry points the user does (the actual grid.css
//     rule the browser parses; the actual mountPillLayer() code path
//     that runs at boot).
//   - Asserts POSITIVE states: pillZIndex > cellZIndex; #grid-root is
//     positioned; SVG is absolute + inset:0; both declarations exist in
//     the canonical files.
//   - Does NOT assert negations like "!cellOpaque" — per the runtime-
//     fidelity memory.
//
// This is a static-source smoke (Node-runnable, no DOM). The runtime
// equivalent — actually mounting cells + SVG and reading getComputedStyle
// + getBoundingClientRect — belongs in the Playwright e2e suite (TODO(#11)).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('PASS ' + msg);
  else { console.error('FAIL ' + msg); failed++; }
}

// Strip CSS comments so a `position: relative` mention inside a comment
// can't pass the assertion.
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// ----- 1. grid.css declares #grid-root { position: relative } --------------

const gridCss = readFileSync(join(repoRoot, 'src/styles/grid.css'), 'utf8');

const gridRootRuleMatch = gridCss.match(/#grid-root\s*\{([\s\S]*?)\n\}/);
assert(gridRootRuleMatch !== null,
  'grid.css contains a #grid-root rule');

const gridRootRuleClean = stripComments(gridRootRuleMatch ? gridRootRuleMatch[1] : '');

assert(/position\s*:\s*relative\b/.test(gridRootRuleClean),
  '#grid-root declares position: relative (containing block for the absolute SVG layer per #46)');

// ----- 2. grid.css declares .cell { position: relative; z-index: N } -------

const cellRuleMatch = gridCss.match(/\.cell\s*\{([\s\S]*?)\n\}/);
assert(cellRuleMatch !== null,
  'grid.css contains a .cell rule');

const cellRuleClean = stripComments(cellRuleMatch ? cellRuleMatch[1] : '');

assert(/position\s*:\s*relative\b/.test(cellRuleClean),
  '.cell declares position: relative (BUILD_SPEC §5.3.4 mandate)');

const cellZIndexMatch = cellRuleClean.match(/z-index\s*:\s*(\d+)\b/);
assert(cellZIndexMatch !== null,
  '.cell declares an explicit numeric z-index');
const cellZIndex = cellZIndexMatch ? Number(cellZIndexMatch[1]) : NaN;
assert(Number.isFinite(cellZIndex) && cellZIndex >= 1,
  `.cell z-index === ${cellZIndex} (must be >= 1 to participate in stacking)`);

// ----- 3. pillRenderer.js mounts SVG with position:absolute + inset:0 ------

const pillRendererSrc = readFileSync(
  join(repoRoot, 'src/game/pillRenderer.js'),
  'utf8',
);

// Find the mountPillLayer function body.
const mountFnMatch = pillRendererSrc.match(
  /function mountPillLayer\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/,
);
assert(mountFnMatch !== null,
  'pillRenderer.js exports a mountPillLayer function');

const mountBody = mountFnMatch ? mountFnMatch[1] : '';
const mountClean = stripComments(mountBody).replace(/\/\/[^\n]*/g, '');

assert(/svg\.style\.position\s*=\s*['"`]absolute['"`]/.test(mountClean),
  'mountPillLayer sets svg.style.position = "absolute" (overlay model per #46)');

assert(/svg\.style\.inset\s*=\s*['"`]0['"`]/.test(mountClean),
  'mountPillLayer sets svg.style.inset = "0" (covers entire grid card)');

assert(/svg\.style\.width\s*=\s*['"`]100%['"`]/.test(mountClean),
  'mountPillLayer sets svg.style.width = "100%"');

assert(/svg\.style\.height\s*=\s*['"`]100%['"`]/.test(mountClean),
  'mountPillLayer sets svg.style.height = "100%"');

assert(/svg\.style\.pointerEvents\s*=\s*['"`]none['"`]/.test(mountClean),
  'mountPillLayer sets svg.style.pointerEvents = "none" (lets drag events through to cells)');

const svgZMatch = mountClean.match(/svg\.style\.zIndex\s*=\s*['"`](\d+)['"`]/);
assert(svgZMatch !== null,
  'mountPillLayer sets svg.style.zIndex to an explicit numeric value');
const svgZIndex = svgZMatch ? Number(svgZMatch[1]) : NaN;

// ----- 4. The actual ordering invariant ------------------------------------

assert(Number.isFinite(svgZIndex) && Number.isFinite(cellZIndex) && svgZIndex > cellZIndex,
  `pillLayer z-index (${svgZIndex}) > cell z-index (${cellZIndex}) — ` +
  'pill paints ON TOP of cell background per BUILD_SPEC §6.2');

// Defense-in-depth: SVG is appended LAST so paint order also resolves
// pill-on-top via DOM order even if z-index were stripped.
assert(/gridRoot\.appendChild\(\s*svg\s*\)/.test(mountClean),
  'mountPillLayer appends the SVG to gridRoot last (DOM-order tiebreak)');

// ----- 5. Cells render with a solid white background -----------------------
//
// Verifies the bug-cause condition still exists (white cell background
// per §5.3.4 — see issue #45 Option 1 ruling: spec mandates a solid
// cell, so the fix MUST be z-order, not transparent backgrounds).

assert(/background\s*:\s*#FFFFFF\b/i.test(cellRuleClean),
  '.cell still renders background: #FFFFFF (spec §5.3.4 — fix is z-order, not transparency)');

// ----- 6. Committed pill alpha matches §6.2 --------------------------------

assert(/fill-opacity\s*:\s*0\.55\b/.test(stripComments(gridCss)),
  '.pill-committed sets fill-opacity: 0.55 (BUILD_SPEC §6.2)');

// ----- Summary --------------------------------------------------------------

if (failed > 0) {
  console.error(`\n${failed} smoke assertion(s) failed`);
  process.exit(1);
}
console.log('\npillLayering.smoke.mjs — all assertions passed');
