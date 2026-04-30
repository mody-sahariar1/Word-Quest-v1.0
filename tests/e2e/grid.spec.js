// Grid e2e — Playwright runtime-fidelity gate.
// Per CLAUDE.md Step 3 rule 9 + issue #11. Replaces tests/grid.smoke.html.
//
// Drives the real renderGrid path through src/main.js: navigating to the
// game screen renders the demo letters into #grid-root. We assert the
// observable DOM (5×5 cells, row-major order, ARIA labels, idempotent
// re-render) plus grid:ready event payload via window.bus subscription.

import { test, expect } from '@playwright/test';

test.describe('grid (game)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => !!window.router && !!window.bus && !!window.__wq);
  });

  test('navigating to game renders the 5×5 demo grid', async ({ page }) => {
    // Subscribe BEFORE the navigation so we capture grid:ready. We do NOT
    // reset the bus here — main.js registered the screen:enter→renderGrid
    // bridge at boot, and resetting would unhook it. We just drive show()
    // through the real runtime path the player would reach.
    await page.evaluate(() => {
      window.__capturedGridReady = [];
      window.bus.on(window.EVENTS.GRID_READY, (p) => {
        window.__capturedGridReady.push({ rows: p.rows, cols: p.cols });
      });
      window.router.show(window.SCREENS.GAME);
    });

    // Locator-based positive assertions — Playwright auto-waits.
    const gameSection = page.locator('section[data-screen="game"]');
    await expect(gameSection).toHaveAttribute('data-active', '');

    const cells = page.locator('#grid-root button.cell');
    await expect(cells).toHaveCount(25);

    // Row-major: index 0 → S (0,0), index 2 → N (0,2), index 5 → A (1,0).
    await expect(cells.nth(0)).toHaveText('S');
    await expect(cells.nth(2)).toHaveText('N');
    await expect(cells.nth(5)).toHaveText('A');
    await expect(cells.nth(0)).toHaveAttribute('data-row', '0');
    await expect(cells.nth(0)).toHaveAttribute('data-col', '0');
    await expect(cells.nth(0)).toHaveAttribute('aria-label', 'Letter S at row 1 column 1');

    // CSS custom properties drive the template — verify they were set.
    const gridRootCols = await page.locator('#grid-root').evaluate((el) =>
      el.style.getPropertyValue('--grid-cols')
    );
    const gridRootRows = await page.locator('#grid-root').evaluate((el) =>
      el.style.getPropertyValue('--grid-rows')
    );
    expect(gridRootCols).toBe('5');
    expect(gridRootRows).toBe('5');

    const display = await page.locator('#grid-root').evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('grid');

    // grid:ready fired with the right shape.
    const captured = await page.evaluate(() => window.__capturedGridReady);
    expect(captured.length).toBeGreaterThanOrEqual(1);
    expect(captured[captured.length - 1]).toMatchObject({ rows: 5, cols: 5 });
  });

  test('createGrid + renderGrid in page context — 4×4 floor and 8×8 ceiling', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createGrid, renderGrid } = await import('/src/game/grid.js');

      // Build separate detached mounts so we don't fight with the live game screen.
      const fixture = (rows, cols) => {
        const out = [];
        for (let r = 0; r < rows; r++) {
          const row = [];
          for (let c = 0; c < cols; c++) row.push(String.fromCharCode(65 + ((r * cols + c) % 26)));
          out.push(row);
        }
        return out;
      };

      const mount4 = document.createElement('div');
      const mount8 = document.createElement('div');
      document.body.appendChild(mount4);
      document.body.appendChild(mount8);

      renderGrid(createGrid(4, 4, fixture(4, 4)), mount4);
      renderGrid(createGrid(8, 8, fixture(8, 8)), mount8);

      return {
        cells4: mount4.querySelectorAll('button.cell').length,
        cells8: mount8.querySelectorAll('button.cell').length,
        last8Row: mount8.querySelectorAll('button.cell')[63].dataset.row,
        last8Col: mount8.querySelectorAll('button.cell')[63].dataset.col,
      };
    });

    expect(result.cells4).toBe(16);
    expect(result.cells8).toBe(64);
    expect(result.last8Row).toBe('7');
    expect(result.last8Col).toBe('7');
  });

  test('renderGrid is idempotent on re-call (no stacking)', async ({ page }) => {
    const cellCount = await page.evaluate(async () => {
      const { createGrid, renderGrid } = await import('/src/game/grid.js');
      const mount = document.createElement('div');
      document.body.appendChild(mount);

      const letters = [
        ['S', 'U', 'N', 'X', 'X'],
        ['A', 'X', 'X', 'X', 'X'],
        ['B', 'X', 'X', 'X', 'X'],
        ['X', 'X', 'X', 'X', 'X'],
        ['X', 'X', 'X', 'X', 'X'],
      ];
      const grid = createGrid(5, 5, letters);
      renderGrid(grid, mount);
      renderGrid(grid, mount);
      return mount.querySelectorAll('button.cell').length;
    });

    expect(cellCount).toBe(25);
  });

  test('createGrid validates dimensions and letters shape', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createGrid } = await import('/src/game/grid.js');
      const fixture = (rows, cols) => {
        const out = [];
        for (let r = 0; r < rows; r++) {
          const row = [];
          for (let c = 0; c < cols; c++) row.push('A');
          out.push(row);
        }
        return out;
      };
      const tries = {
        belowFloor: false,
        aboveCeiling: false,
        wrongRows: false,
        wrongCols: false,
        multiChar: false,
      };
      try { createGrid(3, 3, fixture(3, 3)); } catch { tries.belowFloor = true; }
      try { createGrid(9, 9, fixture(9, 9)); } catch { tries.aboveCeiling = true; }
      try { createGrid(5, 5, fixture(4, 5)); } catch { tries.wrongRows = true; }
      try { createGrid(5, 5, fixture(5, 4)); } catch { tries.wrongCols = true; }
      try { createGrid(4, 4, [['AB','C','D','E'],['F','G','H','I'],['J','K','L','M'],['N','O','P','Q']]); } catch { tries.multiChar = true; }
      return tries;
    });

    expect(result).toEqual({
      belowFloor: true,
      aboveCeiling: true,
      wrongRows: true,
      wrongCols: true,
      multiChar: true,
    });
  });

  test('grid.at returns letters and rejects out-of-range', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createGrid } = await import('/src/game/grid.js');
      const grid = createGrid(5, 5, [
        ['S', 'U', 'N', 'X', 'X'],
        ['A', 'X', 'X', 'X', 'X'],
        ['B', 'X', 'X', 'X', 'X'],
        ['X', 'X', 'X', 'X', 'X'],
        ['X', 'X', 'X', 'X', 'X'],
      ]);
      let negThrew = false;
      let overThrew = false;
      try { grid.at(-1, 0); } catch { negThrew = true; }
      try { grid.at(0, 5); } catch { overThrew = true; }
      return {
        zero: grid.at(0, 0),
        twoZero: grid.at(2, 0),
        negThrew,
        overThrew,
      };
    });

    expect(result.zero).toBe('S');
    expect(result.twoZero).toBe('B');
    expect(result.negThrew).toBe(true);
    expect(result.overThrew).toBe(true);
  });
});
