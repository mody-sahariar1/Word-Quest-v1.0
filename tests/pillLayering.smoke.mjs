// Pill-layering structural smoke (#45 follow-up to #43).
//
// Asserts the deterministic z-order between the cell layer and the pill
// SVG layer: cell stacking-context z-index < pill SVG z-index. The bug
// this guards against (#45) was the cell's white background painting
// over the pill SVG when both layers were static-positioned and only
// DOM order distinguished them — visible on real iOS Safari + Android
// Chrome as a sliver of pill color leaking through the inter-cell gaps.
//
// Per CLAUDE.md Step 3 rule 9 (#43) + memory feedback_smoke_runtime_path_divergence:
//   - Hits the runtime entry points the user does (the actual grid.css
//     rule the browser parses; the actual mountPillLayer() code path
//     that runs at boot).
//   - Asserts POSITIVE states: pillZIndex > cellZIndex; both layers are
//     positioned; both declarations exist in the canonical files.
//   - Does NOT assert negations like "!cellOpaque" — per the runtime-
//     fidelity memory.
//
// This is a static-source smoke (Node-runnable, no DOM). The runtime
// equivalent — actually mounting cells + SVG and reading getComputedStyle
// — belongs in the Playwright e2e suite (TODO(#11)) and is tracked there.

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

// ----- 1. grid.css declares .cell { position: relative; z-index: 1 } --------

const gridCss = readFileSync(join(repoRoot, 'src/styles/grid.css'), 'utf8');

// Capture the .cell rule body.
const cellRuleMatch = gridCss.match(/\.cell\s*\{([\s\S]*?)\n\}/);
assert(cellRuleMatch !== null,
  'grid.css contains a .cell rule');

const cellRuleBody = cellRuleMatch ? cellRuleMatch[1] : '';

// Strip CSS comments so a `position: relative` mention inside a comment
// can't pass the assertion.
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}
const cellRuleClean = stripComments(cellRuleBody);

assert(/position\s*:\s*relative\b/.test(cellRuleClean),
  '.cell declares position: relative (BUILD_SPEC §5.3.4 mandate)');

const cellZIndexMatch = cellRuleClean.match(/z-index\s*:\s*(\d+)\b/);
assert(cellZIndexMatch !== null,
  '.cell declares an explicit numeric z-index');
const cellZIndex = cellZIndexMatch ? Number(cellZIndexMatch[1]) : NaN;
assert(Number.isFinite(cellZIndex) && cellZIndex >= 1,
  `.cell z-index === ${cellZIndex} (must be >= 1 to participate in stacking)`);

// ----- 2. pillRenderer.js mounts SVG with position + z-index > cell ---------

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

assert(/svg\.style\.position\s*=\s*['"`]relative['"`]/.test(mountClean),
  'mountPillLayer sets svg.style.position = "relative" (positioned for z-index)');

const svgZMatch = mountClean.match(/svg\.style\.zIndex\s*=\s*['"`](\d+)['"`]/);
assert(svgZMatch !== null,
  'mountPillLayer sets svg.style.zIndex to an explicit numeric value');
const svgZIndex = svgZMatch ? Number(svgZMatch[1]) : NaN;

// ----- 3. The actual ordering invariant ------------------------------------

assert(Number.isFinite(svgZIndex) && Number.isFinite(cellZIndex) && svgZIndex > cellZIndex,
  `pillLayer z-index (${svgZIndex}) > cell z-index (${cellZIndex}) — ` +
  'pill paints ON TOP of cell background per BUILD_SPEC §6.2');

// Defense-in-depth: SVG is appended LAST so paint order also resolves
// pill-on-top via DOM order even if z-index were stripped.
assert(/gridRoot\.appendChild\(\s*svg\s*\)/.test(mountClean),
  'mountPillLayer appends the SVG to gridRoot last (DOM-order tiebreak)');

// ----- 4. Cells render with a solid white background ------------------------
//
// Verifies the bug-cause condition still exists (white cell background
// per §5.3.4 — see issue #45 Option 1 ruling: spec mandates a solid
// cell, so the fix MUST be z-index, not transparent backgrounds).

assert(/background\s*:\s*#FFFFFF\b/i.test(cellRuleClean),
  '.cell still renders background: #FFFFFF (spec §5.3.4 — fix is z-order, not transparency)');

// ----- 5. Committed pill alpha matches §6.2 ---------------------------------

assert(/fill-opacity\s*:\s*0\.55\b/.test(stripComments(gridCss)),
  '.pill-committed sets fill-opacity: 0.55 (BUILD_SPEC §6.2)');

// ----- Summary --------------------------------------------------------------

if (failed > 0) {
  console.error(`\n${failed} smoke assertion(s) failed`);
  process.exit(1);
}
console.log('\npillLayering.smoke.mjs — all assertions passed');
