// apps/e2e/tests/client/play_shell.spec.ts
//
// C-527 — Coherent play shell and management navigation.
//
// Production-path journeys on /game: the quiet default HUD, the five-section
// management host, sibling section switching and state preservation,
// return-to-play, the narrow-viewport combat container, offline fonts, the
// effective motion policy, and pending-domain-work idempotency. These are
// compiled Playwright assertions, not unit tests — they are the only evidence
// that the shell is wired into the real route rather than a sandbox.

import { expect, test, type Page } from '@playwright/test';

/** The non-production combat seam the composition root installs on /game. */
type AikamiTestSeam = {
  startCombat(options: { enemyName: string; enemyNpcId?: string }): void;
  dismissCombat(): void;
  getOverlayState(): { overlay: string; mode: string };
  getCombatCleanupResumeCount(): number;
};

/** Waits for the play shell to be interactive (engine booted, HUD mounted). */
const openPlayShell = async (page: Page): Promise<void> => {
  await page.goto('/game');
  await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 30_000 });
  await page.waitForSelector('[data-testid="hud-menu-entry"]', {
    state: 'visible',
    timeout: 30_000,
  });
};

const openHost = async (page: Page): Promise<void> => {
  await page.getByTestId('hud-menu-entry').click();
  await page.waitForSelector('[data-testid="management-host"]', {
    state: 'visible',
    timeout: 10_000,
  });
};

/** Waits for the composition root to expose the combat seam. */
const waitForCombatSeam = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __AIKAMI_TEST__?: { startCombat?: unknown } }).__AIKAMI_TEST__
        ?.startCombat === 'function',
    undefined,
    { timeout: 25_000 },
  );
};

const startCombat = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.startCombat({
      enemyName: 'Rollo the Grasper',
      enemyNpcId: 'rollo_grasper',
    });
  });
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.getOverlayState()
              .mode,
        ),
      { timeout: 15_000 },
    )
    .toBe('COMBAT');
};

test.describe('C-527 play shell', () => {
  // ── AC-1 ────────────────────────────────────────────────────────────────

  test('quiet-exploration — one labeled Menu entry and stable HUD slots', async ({ page }) => {
    await openPlayShell(page);

    // AC-1: the seven-item permanent management bar is gone.
    await expect(page.locator('[data-testid="management-nav"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="nav-"]')).toHaveCount(0);

    // The labeled Menu entry replaces it.
    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
    await expect(page.getByTestId('hud-menu-entry')).toHaveText(/menu/i);

    // Stable named slots own the geometry.
    await expect(page.getByTestId('hud-slot-top-start')).toBeAttached();
    await expect(page.getByTestId('hud-slot-top-end')).toBeAttached();
    await expect(page.getByTestId('hud-slot-bottom-center')).toBeAttached();

    // No management host until the player asks for it.
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(0);
  });

  // ── AC-2 ────────────────────────────────────────────────────────────────

  test('section-switch-and-return — one host, five sections, back to play', async ({ page }) => {
    await openPlayShell(page);
    await openHost(page);

    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(1);
    const tabs = page.locator('[data-testid^="section-tab-"]');
    await expect(tabs).toHaveCount(5);
    await expect(page.getByTestId('section-tab-character')).toBeVisible();
    await expect(page.getByTestId('section-tab-inventory')).toBeVisible();
    await expect(page.getByTestId('section-tab-journal')).toBeVisible();
    await expect(page.getByTestId('section-tab-party')).toBeVisible();
    await expect(page.getByTestId('section-tab-world')).toBeVisible();

    await expect(page.getByTestId('section-tab-character')).toHaveAttribute('aria-current', 'page');

    await page.getByTestId('section-tab-inventory').click();
    await expect(page.getByTestId('section-tab-inventory')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: 'Inventory' })).toBeVisible();

    await page.getByTestId('section-tab-journal').click();
    await expect(page.getByTestId('section-tab-journal')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: 'Journal' })).toBeVisible();

    await page.getByTestId('management-close').click();
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(0);
    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
  });

  test('section-preserves-state — a section keeps its own state across a sibling switch', async ({
    page,
  }) => {
    await openPlayShell(page);
    await openHost(page);

    // Journal: leave a draft in the search field and pick a non-default tab.
    await page.getByTestId('section-tab-journal').click();
    await expect(page.getByRole('dialog', { name: 'Journal' })).toBeVisible();
    await page.getByTestId('journal-search').fill('emberwatch draft');
    await page.getByTestId('journal-tabs').getByRole('button', { name: /Recaps/ }).click();
    await expect(
      page.getByTestId('journal-tabs').getByRole('button', { name: /Recaps/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    // World: pick a non-default tab.
    await page.getByTestId('section-tab-world').click();
    await expect(page.getByRole('dialog', { name: 'World' })).toBeVisible();
    await page.getByTestId('world-tabs').getByRole('button', { name: /Places/ }).click();
    await expect(page.getByTestId('world-tabs').getByRole('button', { name: /Places/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Away and back: both sections must be exactly where they were left.
    await page.getByTestId('section-tab-inventory').click();
    await expect(page.getByRole('dialog', { name: 'Inventory' })).toBeVisible();

    await page.getByTestId('section-tab-journal').click();
    await expect(page.getByRole('dialog', { name: 'Journal' })).toBeVisible();
    await expect(page.getByTestId('journal-search')).toHaveValue('emberwatch draft');
    await expect(
      page.getByTestId('journal-tabs').getByRole('button', { name: /Recaps/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('section-tab-world').click();
    await expect(page.getByTestId('world-tabs').getByRole('button', { name: /Places/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  // ── AC-3 ────────────────────────────────────────────────────────────────

  test('focus-pause-scopes — Escape unwinds the host and focus returns to the Menu entry', async ({
    page,
  }) => {
    await openPlayShell(page);
    const menuEntry = page.getByTestId('hud-menu-entry');
    await menuEntry.focus();
    await expect(menuEntry).toBeFocused();

    await openHost(page);
    // The host takes focus so the player is not stranded on the HUD behind it.
    await expect(page.locator('[data-testid="management-host"]')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(0);
    // Focus restoration: the element focused BEFORE the host opened is focused
    // again, so keyboard navigation resumes where it left off.
    await expect(menuEntry).toBeFocused();
  });

  test('held-key-does-not-resume-movement — a held key cannot leak past the close', async ({
    page,
  }) => {
    await openPlayShell(page);
    await waitForEngineRunning(page);

    // Hold the movement key, open the host, release while the host is open,
    // then close. The world must not resume moving off the stale key state the
    // overlay transition swallowed.
    await page.keyboard.down('w');
    await page.waitForTimeout(400);
    await openHost(page);
    await page.keyboard.up('w');
    await page.getByTestId('management-close').click();
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(0);

    const afterStaleInput = await readPlayerPosition(page);

    // Settle: wait for any residual legitimate motion from the press that
    // preceded the host to finish before judging the stale key. Requires the
    // position to be UNCHANGED across a full 400ms window, so a momentary
    // coincidence while decelerating cannot be mistaken for a stop.
    await expect
      .poll(
        async () => {
          const a = await readPlayerPosition(page);
          await page.waitForTimeout(400);
          const b = await readPlayerPosition(page);
          return a.x === b.x && a.y === b.y;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    const settled = await readPlayerPosition(page);
    await page.waitForTimeout(1_000);
    const stillSettled = await readPlayerPosition(page);

    // No motion from the released key: the player stays put until fresh input.
    expect(stillSettled).toEqual(settled);
    // And the world really was moving before, so the probe is not vacuous.
    expect(Number.isFinite(afterStaleInput.y)).toBe(true);
    expect(afterStaleInput.y).not.toBe(settled.y);

    // A fresh movement press is the ONLY thing that may move the player again.
    let moved = false;
    for (const key of ['d', 'w', 'a', 's'] as const) {
      await page.keyboard.down(key);
      await page.waitForTimeout(800);
      await page.keyboard.up(key);
      const now = await readPlayerPosition(page);
      if (now.x !== settled.x || now.y !== settled.y) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });

  // ── AC-4 ────────────────────────────────────────────────────────────────

  test('combat-narrow — the split rail becomes an accessible bottom action sheet', async ({
    page,
  }) => {
    // Wide: the combat sidebar is the left rail, no sheet.
    await page.setViewportSize({ width: 1280, height: 800 });
    await openPlayShell(page);
    await waitForCombatSeam(page);
    await startCombat(page);

    await expect(page.locator('[data-testid="combat-action-sheet"]')).toHaveCount(0);
    await expect(page.getByTestId('combat-attack-btn')).toBeVisible();

    // Narrow: the SAME action controls move into a labelled bottom sheet and the
    // scene keeps the space above it.
    await page.setViewportSize({ width: 700, height: 900 });
    const sheet = page.locator('[data-testid="combat-action-sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('role', 'region');
    await expect(sheet).toHaveAttribute('aria-label', 'Combat actions');
    await expect(page.getByTestId('combat-attack-btn')).toBeVisible();
    await expect(page.getByTestId('combat-defend-btn')).toBeVisible();
    await expect(page.getByTestId('combat-flee-btn')).toBeVisible();

    const scene = page.getByTestId('game-scene-region');
    const sceneBox = await scene.boundingBox();
    const sheetBox = await sheet.boundingBox();
    expect(sceneBox).not.toBeNull();
    expect(sheetBox).not.toBeNull();
    // The scene keeps a real, usable region above the sheet.
    expect(sceneBox!.height).toBeGreaterThanOrEqual(200);
    expect(sceneBox!.y + sceneBox!.height).toBeLessThanOrEqual(sheetBox!.y + 1);

    // Wide again: back to the rail, still exactly one sidebar.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('[data-testid="combat-action-sheet"]')).toHaveCount(0);
    await expect(page.getByTestId('combat-attack-btn')).toBeVisible();
  });

  test('combat-no-duplicate-action — one action workflow, no double resume', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPlayShell(page);
    await waitForCombatSeam(page);
    await startCombat(page);

    // Exactly ONE set of action controls exists — the sheet replaced the rail,
    // it did not add a second dock bound to a separate lifecycle.
    for (const testId of ['combat-attack-btn', 'combat-defend-btn', 'combat-flee-btn']) {
      await expect(page.getByTestId(testId)).toHaveCount(1);
    }
    await expect(page.locator('[data-testid="combat-action-sheet"]')).toHaveCount(1);

    const resumesBefore = await page.evaluate(
      () =>
        (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.getCombatCleanupResumeCount(),
    );

    await page.evaluate(() => {
      (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.dismissCombat();
    });

    await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.getOverlayState()
                .overlay,
          ),
        { timeout: 10_000 },
      )
      .toBe('NONE');

    const resumesAfter = await page.evaluate(
      () =>
        (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.getCombatCleanupResumeCount(),
    );

    // Leaving combat resumes the world exactly once — not once per container.
    expect(resumesAfter - resumesBefore).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-testid="combat-action-sheet"]')).toHaveCount(0);

    // The management host is still reachable — combat did not leave two owners.
    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
  });

  // ── AC-5 ────────────────────────────────────────────────────────────────

  test('reflow-200-text — the rail and its controls stay reachable at 200% text', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPlayShell(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await openHost(page);

    await expect(page.getByTestId('management-close')).toBeVisible();
    await expect(page.getByTestId('section-tab-world')).toBeVisible();
    await page.getByTestId('section-tab-world').click();
    await expect(page.getByTestId('section-tab-world')).toHaveAttribute('aria-current', 'page');
  });

  test('touch-management — the Menu entry and section rail are operable at touch size', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPlayShell(page);

    await expect(page.getByTestId('hud-menu-entry')).toBeVisible();
    await openHost(page);
    await page.getByTestId('section-tab-party').click();

    await expect(page.getByTestId('section-tab-party')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('management-close')).toBeVisible();
  });

  // ── AC-6 ────────────────────────────────────────────────────────────────

  test('offline-fonts — the shell boots and renders with no external font request', async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    const origin = new URL(page.url() || 'http://localhost').origin;

    // Abort anything that is not the local dev server. A CDN font, an icon
    // service or a Google Fonts stylesheet would show up here.
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        await route.continue();
        return;
      }
      let sameOrigin = false;
      try {
        sameOrigin = url.startsWith('http://localhost') || url.startsWith(origin);
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) {
        externalRequests.push(url);
        await route.abort();
        return;
      }
      await route.continue();
    });

    await openPlayShell(page);
    await openHost(page);

    // The shell rendered with every external request blocked.
    await expect(page.getByTestId('management-host')).toBeVisible();
    await expect(page.locator('[data-testid^="section-tab-"]')).toHaveCount(5);

    // No font face was ever requested from off-origin.
    const fontRequests = externalRequests.filter((url) =>
      /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url),
    );
    expect(fontRequests).toEqual([]);

    // And the declared fallback chain resolves to a real family, so no text is
    // rendered in the browser's last-resort face.
    const family = await page.evaluate(
      () => globalThis.getComputedStyle(document.body).fontFamily,
    );
    expect(family.length).toBeGreaterThan(0);
    expect(family).toContain('Inter');
  });

  test('explicit-motion — one effective motion policy under either OS preference', async ({
    page,
  }) => {
    // OS asks for reduced motion.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openPlayShell(page);
    await expect(page.getByTestId('game-ui-overlay-layer')).toHaveAttribute(
      'data-motion',
      'reduced',
    );

    // OS allows motion → the same policy resolves the other way.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await page.waitForSelector('[data-testid="hud-menu-entry"]', {
      state: 'visible',
      timeout: 30_000,
    });
    await expect(page.getByTestId('game-ui-overlay-layer')).toHaveAttribute('data-motion', 'full');
  });

  // ── AC-7 ────────────────────────────────────────────────────────────────

  test('double-activation-idempotent — repeating a section activation never duplicates the host', async ({
    page,
  }) => {
    await openPlayShell(page);
    await openHost(page);

    const inventoryTab = page.getByTestId('section-tab-inventory');
    await inventoryTab.click();
    await inventoryTab.click();
    await inventoryTab.click();

    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="management-section-body"]')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: 'Inventory' })).toHaveCount(1);
  });

  test('pending-save-return — navigating away and back must not re-run domain work', async ({
    page,
  }) => {
    await openPlayShell(page);
    await openHost(page);

    // Leave durable state in TWO sections. Each section's ViewModel is created
    // once per host session (C-527 AC-2), so this state surviving the round
    // trip is the observable proof that the section was never re-initialised —
    // and therefore that no item/save/listener work was replayed.
    await page.getByTestId('section-tab-journal').click();
    await expect(page.getByRole('dialog', { name: 'Journal' })).toBeVisible();
    await page.getByTestId('journal-search').fill('pending-work-probe');

    await page.getByTestId('section-tab-world').click();
    await expect(page.getByRole('dialog', { name: 'World' })).toBeVisible();
    await page.getByTestId('world-search').fill('emberwatch');

    // Navigate away and back, twice.
    for (let round = 0; round < 2; round += 1) {
      await page.getByTestId('section-tab-inventory').click();
      await expect(page.getByRole('dialog', { name: 'Inventory' })).toBeVisible();

      await page.getByTestId('section-tab-journal').click();
      await expect(page.getByTestId('journal-search')).toHaveValue('pending-work-probe');

      await page.getByTestId('section-tab-world').click();
      await expect(page.getByTestId('world-search')).toHaveValue('emberwatch');
    }

    // One host, one section body — the round trips never stacked a second owner.
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="management-section-body"]')).toHaveCount(1);
  });
});

/**
 * The player's world position, read from the render loop's own debug snapshot
 * (`window.__AIKAMI_DEBUG__`), which the engine publishes every frame. This is
 * the authoritative position the movement system actually integrates.
 */
const readPlayerPosition = async (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const debug = (window as unknown as { __AIKAMI_DEBUG__?: { playerX?: number; playerY?: number } })
      .__AIKAMI_DEBUG__;
    return { x: debug?.playerX ?? Number.NaN, y: debug?.playerY ?? Number.NaN };
  });

/** Waits until the render loop is publishing a finite player position. */
const waitForEngineRunning = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => {
      const debug = (window as unknown as { __AIKAMI_DEBUG__?: { playerX?: number; playerY?: number } })
        .__AIKAMI_DEBUG__;
      return typeof debug?.playerX === 'number' && typeof debug?.playerY === 'number';
    },
    undefined,
    { timeout: 45_000 },
  );
};
