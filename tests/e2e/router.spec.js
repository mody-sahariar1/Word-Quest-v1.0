// Router e2e — Playwright runtime-fidelity gate.
// Per CLAUDE.md Step 3 rule 9 + issue #11. Replaces tests/router.smoke.html
// (which only existed as a manual page; nothing automated ran the asserts).
//
// Drives the real window.router / window.bus exposed by src/main.js. Asserts
// positive states (`screen.dataset.active !== undefined`, event arrays of
// expected length) rather than negation.

import { test, expect } from '@playwright/test';

test.describe('router (engine)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    // Wait for src/main.js to mount diagnostics. The boot also kicks off
    // router.show('splash') + a 1.2s timer to show('game'); reset both bus
    // and router state below so each test starts clean.
    await page.waitForFunction(() => !!window.router && !!window.bus && !!window.__wq);
    await page.evaluate(() => {
      window.__wq.resetBus();
      window.__wq.resetRouter();
    });
  });

  test('show(splash) emits one screen:enter, no screen:exit, marks section active', async ({ page }) => {
    const result = await page.evaluate(() => {
      const events = [];
      window.bus.on(window.EVENTS.SCREEN_ENTER, (p) => events.push(['enter', p]));
      window.bus.on(window.EVENTS.SCREEN_EXIT, (p) => events.push(['exit', p]));

      window.router.show(window.SCREENS.SPLASH);

      return {
        current: window.router.current(),
        enters: events.filter(([k]) => k === 'enter').length,
        exits: events.filter(([k]) => k === 'exit').length,
        firstEnterPayload: events.find(([k]) => k === 'enter')?.[1] ?? null,
      };
    });

    expect(result.current).toBe('splash');
    expect(result.enters).toBe(1);
    expect(result.exits).toBe(0);
    expect(result.firstEnterPayload).toMatchObject({ screen: 'splash' });

    // The section element actually flips [data-active].
    const splashSection = page.locator('section[data-screen="splash"]');
    await expect(splashSection).toHaveAttribute('data-active', '');
  });

  test('show(menu) after splash emits exit(splash) + enter(menu) with payload + from', async ({ page }) => {
    const result = await page.evaluate(() => {
      const events = [];
      window.bus.on(window.EVENTS.SCREEN_ENTER, (p) => events.push(['enter', p]));
      window.bus.on(window.EVENTS.SCREEN_EXIT, (p) => events.push(['exit', p]));

      window.router.show(window.SCREENS.SPLASH);
      window.router.show(window.SCREENS.MENU, { foo: 'bar' });

      const enters = events.filter(([k]) => k === 'enter').map(([, p]) => p);
      const exits = events.filter(([k]) => k === 'exit').map(([, p]) => p);
      return {
        current: window.router.current(),
        entersCount: enters.length,
        exitsCount: exits.length,
        lastEnter: enters[enters.length - 1],
        lastExit: exits[exits.length - 1],
      };
    });

    expect(result.current).toBe('menu');
    expect(result.entersCount).toBe(2);
    expect(result.exitsCount).toBe(1);
    expect(result.lastEnter).toMatchObject({ screen: 'menu', from: 'splash', payload: { foo: 'bar' } });
    expect(result.lastExit).toMatchObject({ screen: 'splash', to: 'menu' });

    const menuSection = page.locator('section[data-screen="menu"]');
    await expect(menuSection).toHaveAttribute('data-active', '');
  });

  test('re-show same screen is idempotent (no extra events)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const events = [];
      window.bus.on(window.EVENTS.SCREEN_ENTER, (p) => events.push(['enter', p]));
      window.bus.on(window.EVENTS.SCREEN_EXIT, (p) => events.push(['exit', p]));

      window.router.show(window.SCREENS.SPLASH);
      window.router.show(window.SCREENS.MENU);
      const before = events.length;
      window.router.show(window.SCREENS.MENU);
      const after = events.length;
      return { before, after, current: window.router.current() };
    });

    expect(result.current).toBe('menu');
    expect(result.after).toBe(result.before);
  });

  test('back() returns to previous screen, then toggles', async ({ page }) => {
    const result = await page.evaluate(() => {
      window.router.show(window.SCREENS.SPLASH);
      window.router.show(window.SCREENS.MENU);

      window.router.back();
      const afterFirstBack = window.router.current();

      window.router.back();
      const afterSecondBack = window.router.current();

      return { afterFirstBack, afterSecondBack };
    });

    expect(result.afterFirstBack).toBe('splash');
    expect(result.afterSecondBack).toBe('menu');
  });
});
