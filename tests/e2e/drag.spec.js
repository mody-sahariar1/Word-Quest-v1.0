// Drag e2e — Playwright runtime-fidelity gate for the input path.
// Per CLAUDE.md Step 3 rule 9 + issue #37. Catches the class of regression
// where the grid renders but pointer input never reaches the selector.
//
// What this test asserts: starting from the boot-rendered game screen,
// driving real Playwright pointer events across cells fires `select:start`
// on pointerdown over a cell, `select:end` on pointerup with a path of
// length >= 2, and the resulting `word` is the concatenation of the
// letters the path visits.
//
// What this test does NOT catch: iOS Safari's `<button>`-element pointer
// quirk (the original cause of #37). Headless Playwright WebKit delivers
// pointermove events on `<button>` elements; real iOS Safari does not.
// This spec was the bottom of the regression sandwich — it would not fail
// on the broken `<button>` commit. The fix (cell tag → `<div>`) is what
// closed the bug; this spec is the runtime-path regression catch for any
// future wiring break that drops events end-to-end.

import { test, expect } from '@playwright/test';

test.describe('drag input (game)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => !!window.router && !!window.bus && !!window.__wq);
    // Subscribe BEFORE forcing the game screen so we capture the events
    // the player would see. Bus is shared with the boot's listeners; we
    // do NOT reset it (would unhook main.js's screen→render bridge).
    await page.evaluate(() => {
      window.__events = [];
      window.bus.on(window.EVENTS.SELECT_START, (p) => window.__events.push(['select:start', p]));
      window.bus.on(window.EVENTS.SELECT_END, (p) => window.__events.push(['select:end', { path: p.path, word: p.word }]));
      window.router.show(window.SCREENS.GAME);
    });
    // Give the level fetch + render a beat. main.js loads classicLevels.json
    // asynchronously; the grid mounts when both _levelsReady and the game
    // screen are active.
    await page.waitForFunction(
      () => document.querySelectorAll('#grid-root .cell').length > 0,
      null,
      { timeout: 5000 }
    );
    // Wait for the splash→game cross-fade to fully complete. During the
    // transition both sections have data-active (display:flex) and the
    // game section sits BELOW splash in document flow, so the grid is
    // below the viewport and elementFromPoint returns null. The router
    // removes splash's data-active after transitionend (~220ms) or a
    // 400ms safety net — we wait for splash to actually be display:none.
    await page.waitForFunction(() => {
      const splash = document.querySelector('section[data-screen="splash"]');
      return splash && getComputedStyle(splash).display === 'none';
    }, null, { timeout: 2000 });
  });

  test('pointer drag across two cells fires select:start and select:end with the visited letters', async ({ page }) => {
    const cell00 = page.locator('#grid-root .cell[data-row="0"][data-col="0"]');
    const cell01 = page.locator('#grid-root .cell[data-row="0"][data-col="1"]');

    const a = await cell00.boundingBox();
    const b = await cell01.boundingBox();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();

    // Diagnostic: confirm grid root + selector wiring before driving pointer
    // events. Failures here indicate boot-state regression, not input-path
    // regression — different fix surface, easier to triage.
    const wiring = await page.evaluate(({ x, y }) => {
      const root = document.getElementById('grid-root');
      const elemAtPoint = document.elementFromPoint(x, y);
      const gameSection = document.querySelector('section[data-screen="game"]');
      return {
        gridRootRect: root.getBoundingClientRect(),
        gameActive: gameSection.hasAttribute('data-active'),
        gameDisplay: getComputedStyle(gameSection).display,
        cellTag: elemAtPoint && elemAtPoint.tagName,
        cellClass: elemAtPoint && elemAtPoint.className,
        cellRow: elemAtPoint && elemAtPoint.dataset && elemAtPoint.dataset.row,
        currentScreen: window.router.current(),
      };
    }, { x: a.x + a.width / 2, y: a.y + a.height / 2 });
    expect(wiring.gameActive).toBe(true);
    expect(wiring.gameDisplay).toBe('flex');
    expect(wiring.cellClass).toBe('cell');
    expect(wiring.cellRow).toBe('0');

    // Read the letters the player sees so the assertion is data-driven —
    // generator output varies by level seed.
    const [letterA, letterB] = await Promise.all([
      cell00.textContent(),
      cell01.textContent(),
    ]);

    // Real pointer drag from cell(0,0) → cell(0,1). Steps are required so
    // pointermove fires intermediate samples; without them Playwright
    // delivers a single move and the selector's path stays at length 1.
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();

    // Both ends of the input path must fire — that's the regression catch.
    const events = await page.evaluate(() => window.__events);
    const starts = events.filter(([k]) => k === 'select:start');
    const ends = events.filter(([k]) => k === 'select:end');

    expect(starts.length).toBe(1);
    expect(ends.length).toBe(1);

    const endPayload = ends[0][1];
    // Path must include both cells (or more — selector may snap intermediate
    // diagonals, but on a horizontal step from (0,0) → (0,1) the only legal
    // shape is the two cells themselves).
    expect(endPayload.path.length).toBe(2);
    expect(endPayload.path[0]).toEqual({ row: 0, col: 0 });
    expect(endPayload.path[1]).toEqual({ row: 0, col: 1 });
    // Word equals the letters at those cells, in order.
    expect(endPayload.word).toBe(`${letterA}${letterB}`);
  });

  test('cells render as <div> not <button> so iOS Safari pointer events deliver', async ({ page }) => {
    // Lock the #37 fix: any future PR that flips cells back to <button>
    // (or any other element with iOS Safari tap-cancel behavior) fails this
    // assertion before the silent runtime regression hits real devices.
    const tags = await page.$$eval('#grid-root .cell', (els) => els.map((el) => el.tagName));
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag).toBe('DIV');
    }
  });

  test('iOS long-press suppression — cells have -webkit-touch-callout: none (#43)', async ({ page }) => {
    // Regression trap for #43 Regression A: tap-and-hold on a cell must
    // not pop the iOS Safari copy menu. The fix is three CSS properties on
    // .cell; we lock the most critical one here. Headless Chromium does
    // not actually trigger the long-press menu (real iOS Safari does), so
    // this is a CSS-presence assertion, not a behavioral assertion.
    // Chromium drops Safari-only properties (-webkit-touch-callout,
    // -webkit-user-select) from its parsed CSSOM, so document.styleSheets
    // doesn't see them even though the rule ships in the file. Fetch the
    // raw CSS source and assert presence in the unparsed text — the
    // browser may not recognize it but real iOS Safari does, which is
    // the only browser where this property matters.
    const cssSource = await page.evaluate(async () => {
      const res = await fetch('/src/styles/grid.css');
      return await res.text();
    });
    expect(cssSource).toMatch(/-webkit-touch-callout:\s*none/);
    expect(cssSource).toMatch(/-webkit-user-select:\s*none/);
    expect(cssSource).toMatch(/user-select:\s*none/);
  });

  test('pill SVG paints above cells — last child of #grid-root (#43)', async ({ page }) => {
    // Regression trap for #43 Regression B: the SVG pill layer must be
    // the LAST child of #grid-root so it paints AFTER cells in CSS Grid
    // DOM-order tiebreaking. Inserting it as firstChild made pills paint
    // behind cells' white backgrounds, visible only in inter-cell gaps.
    const layout = await page.evaluate(() => {
      const root = document.getElementById('grid-root');
      const lastChild = root.lastElementChild;
      const svg = root.querySelector('#pill-layer');
      return {
        svgExists: !!svg,
        svgIsLastChild: lastChild && lastChild.id === 'pill-layer',
        cellCount: root.querySelectorAll('.cell').length,
      };
    });
    expect(layout.svgExists).toBe(true);
    expect(layout.cellCount).toBeGreaterThan(0);
    expect(layout.svgIsLastChild).toBe(true);
  });

  test('cell a11y — role=button + tabindex=0 + aria-label preserved (#43)', async ({ page }) => {
    // Regression trap for #43 Regression C: switching <button>→<div>
    // dropped the implicit role="button" + tab-order. Restored explicitly
    // so screen readers + keyboard nav still announce/reach cells.
    const a11y = await page.$eval('#grid-root .cell', (el) => ({
      role: el.getAttribute('role'),
      tabindex: el.getAttribute('tabindex'),
      ariaLabel: el.getAttribute('aria-label'),
    }));
    expect(a11y.role).toBe('button');
    expect(a11y.tabindex).toBe('0');
    expect(a11y.ariaLabel).toMatch(/^Letter [A-Z] at row \d+ column \d+$/);
  });
});
