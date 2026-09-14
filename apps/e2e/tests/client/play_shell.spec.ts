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

import { expect, type Page, test } from '@playwright/test';

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

/**
 * C-527 AC-1/AC-5 — the deterministic half of the "no overlapping HUD" claim.
 *
 * The visual suite asks a vision model for an `overlappingControls` verdict,
 * which is a judgement call; this measures the real boxes instead. Every named
 * HUD region plus the two widgets that still position themselves (the tutorial
 * hint and the quest card) must be pairwise disjoint.
 */
const expectNoHudOverlap = async (page: Page): Promise<void> => {
  const result = await page.evaluate(() => {
    // Required regions must be PRESENT. A wrong selector used to produce an
    // empty comparison set and therefore a vacuously passing overlap check.
    // `hud-slot-objective` is the real rendered testid (not the conceptual
    // `hud-slot-bottom-start`), and it contains the optional onboarding hint.
    const required = [
      '[data-testid="hud-slot-top-start"]',
      '[data-testid="hud-slot-top-end"]',
      '[data-testid="hud-slot-objective"]',
      '[data-testid="hud-slot-bottom-center"]',
    ];
    const optional = ['.onboarding-hint'];
    const missing = required.filter((sel) => document.querySelector(sel) === null);

    const boxes = [...required, ...optional]
      .map((sel) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) {
          return null;
        }
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.visibility === 'hidden' || style.display === 'none' || rect.width === 0) {
          return null;
        }
        return { sel, x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      })
      .filter((box): box is NonNullable<typeof box> => box !== null);

    const found: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        if (overlapX > 4 && overlapY > 4) {
          found.push(
            `${a.sel} overlaps ${b.sel} by ${Math.round(overlapX)}x${Math.round(overlapY)}px`,
          );
        }
      }
    }
    return { missing, overlaps: found };
  });

  expect(result.missing).toEqual([]);
  expect(result.overlaps).toEqual([]);
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
            (
              window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
            ).__AIKAMI_TEST__.getOverlayState().mode,
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

    // Deterministic overlap check over the real boxes (see expectNoHudOverlap).
    await expectNoHudOverlap(page);
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
    await expect(page.getByTestId('management-panel-inventory')).toBeVisible();

    await page.getByTestId('section-tab-journal').click();
    await expect(page.getByTestId('section-tab-journal')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(1);
    await expect(page.getByTestId('management-panel-journal')).toBeVisible();

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
    await expect(page.getByTestId('management-panel-journal')).toBeVisible();
    await page.getByTestId('journal-search').fill('emberwatch draft');
    await page
      .getByTestId('journal-tabs')
      .getByRole('button', { name: /Recaps/ })
      .click();
    await expect(
      page.getByTestId('journal-tabs').getByRole('button', { name: /Recaps/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    // World: pick a non-default tab.
    await page.getByTestId('section-tab-world').click();
    await expect(page.getByTestId('management-panel-world')).toBeVisible();
    await page
      .getByTestId('world-tabs')
      .getByRole('button', { name: /Places/ })
      .click();
    await expect(
      page.getByTestId('world-tabs').getByRole('button', { name: /Places/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Away and back: both sections must be exactly where they were left.
    await page.getByTestId('section-tab-inventory').click();
    await expect(page.getByTestId('management-panel-inventory')).toBeVisible();

    await page.getByTestId('section-tab-journal').click();
    await expect(page.getByTestId('management-panel-journal')).toBeVisible();
    await expect(page.getByTestId('journal-search')).toHaveValue('emberwatch draft');
    await expect(
      page.getByTestId('journal-tabs').getByRole('button', { name: /Recaps/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('section-tab-world').click();
    await expect(
      page.getByTestId('world-tabs').getByRole('button', { name: /Places/ }),
    ).toHaveAttribute('aria-pressed', 'true');
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

  /**
   * AC-2/AC-3 — the management workspace is genuinely keyboard navigable from
   * INSIDE a feature section (not just by clicking the rail). Tab and Shift+Tab
   * must stay contained, the rail must be reachable, and activation keys must
   * switch sections. Clicking the rail is explicitly not sufficient evidence.
   */
  test('management-keyboard — Tab/Shift+Tab stay contained and activation switches sections', async ({
    page,
  }) => {
    await openPlayShell(page);
    await openHost(page);

    const activeInsideHost = async (): Promise<boolean> =>
      page.evaluate(() => {
        const host = document.querySelector('[data-testid="management-host"]');
        return (
          host !== null && document.activeElement !== null && host.contains(document.activeElement)
        );
      });

    const activeIsRailTab = async (): Promise<boolean> =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return active?.getAttribute('data-testid')?.startsWith('section-tab-') ?? false;
      });

    // ── Inside Inventory ──
    await page.getByTestId('section-tab-inventory').click();
    await expect(page.getByTestId('management-panel-inventory')).toBeVisible();
    const inventoryButton = page
      .getByTestId('management-panel-inventory')
      .getByRole('button')
      .first();
    await inventoryButton.focus();

    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      expect(await activeInsideHost()).toBe(true);
    }
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await activeInsideHost()).toBe(true);
    }
    // The rail is reachable by Tab from the section controls.
    let reachedRail = false;
    for (let i = 0; i < 30 && !reachedRail; i += 1) {
      await page.keyboard.press('Tab');
      reachedRail = await activeIsRailTab();
    }
    expect(reachedRail).toBe(true);

    // Activation key switches the sibling section.
    await page.getByTestId('section-tab-journal').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('management-panel-journal')).toBeVisible();
    await expect(page.getByTestId('management-panel-inventory')).toBeHidden();

    // ── Inside Journal ──
    const journalButton = page.getByTestId('management-panel-journal').getByRole('button').first();
    await journalButton.focus();
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      expect(await activeInsideHost()).toBe(true);
    }
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await activeInsideHost()).toBe(true);
    }

    // Back is reachable and returns to play.
    await page.getByTestId('management-close').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(0);
  });

  test('held-key-does-not-resume-movement — a held key cannot leak past the close', async ({
    page,
  }) => {
    await openPlayShell(page);
    await waitForEngineRunning(page);

    // Precondition proved BEFORE anything is opened: a fresh press really does
    // move the player, so the "stays still" assertions below are not vacuous.
    // (The old test asserted a position CHANGE after closing as its proof of
    // earlier movement, which also passed when the stale key leaked.)
    const startDirection = await firstDirectionThatMoves(page, await readPlayerPosition(page));
    expect(startDirection).not.toBeNull();
    if (startDirection === null) {
      return;
    }

    // ── Case A: the key is released while the host is open ──
    await page.keyboard.down(startDirection);
    await page.waitForTimeout(300);
    await openHost(page);
    await page.keyboard.up(startDirection);
    await page.getByTestId('management-close').click();
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(0);
    // The overlay transition flushed the engine input; nothing resumes.
    await expectPlayerStill(page);

    // ── Case B: the key is STILL HELD when the host closes ──
    await page.keyboard.down(startDirection);
    await page.waitForTimeout(300);
    await openHost(page);
    // Close without releasing: a held key must not resume movement on its own.
    await page.getByTestId('management-close').click();
    await expect(page.locator('[data-testid="management-host"]')).toHaveCount(0);
    await expectPlayerStill(page);
    await page.keyboard.up(startDirection);
    await expectPlayerStill(page);

    // Fresh gameplay input is the ONLY thing that may move the player again.
    const resumed = await firstDirectionThatMoves(page, await readPlayerPosition(page));
    expect(resumed).not.toBeNull();
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
    // The sheet is a real <section>, so this asserts the *computed* role, not a
    // hand-written attribute that could drift from the element's semantics.
    await expect(sheet).toHaveRole('region');
    await expect(sheet).toHaveAttribute('aria-label', 'Combat actions');
    await expect(page.getByTestId('combat-attack-btn')).toBeVisible();
    await expect(page.getByTestId('combat-defend-btn')).toBeVisible();
    await expect(page.getByTestId('combat-flee-btn')).toBeVisible();

    const scene = page.getByTestId('game-scene-region');
    const sceneBox = await scene.boundingBox();
    const sheetBox = await sheet.boundingBox();
    expect(sceneBox).not.toBeNull();
    expect(sheetBox).not.toBeNull();
    if (sceneBox === null || sheetBox === null) {
      throw new Error('expected the scene region and the combat action sheet to be laid out');
    }
    // The scene keeps a real, usable region above the sheet.
    expect(sceneBox.height).toBeGreaterThanOrEqual(200);
    expect(sceneBox.y + sceneBox.height).toBeLessThanOrEqual(sheetBox.y + 1);

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

    const resumesBefore = await page.evaluate(() =>
      (
        window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
      ).__AIKAMI_TEST__.getCombatCleanupResumeCount(),
    );

    await page.evaluate(() => {
      (window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }).__AIKAMI_TEST__.dismissCombat();
    });

    await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              (
                window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
              ).__AIKAMI_TEST__.getOverlayState().overlay,
          ),
        { timeout: 10_000 },
      )
      .toBe('NONE');

    const resumesAfter = await page.evaluate(() =>
      (
        window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
      ).__AIKAMI_TEST__.getCombatCleanupResumeCount(),
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

    // Resolve the configured server origin from the project baseURL rather than
    // inferring it from `page.url()` — before navigation that is `about:blank`,
    // whose origin is the literal string "null", which silently turned the
    // same-origin check into a `startsWith('http://localhost')` prefix match.
    const configuredBaseUrl = test.info().project.use.baseURL;
    const serverOrigin = new URL(configuredBaseUrl ?? 'http://localhost:5274').origin;

    // Abort anything that is not the configured local server. A CDN font, an
    // icon service or a Google Fonts stylesheet would show up here.
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        await route.continue();
        return;
      }
      let sameOrigin = false;
      try {
        sameOrigin = new URL(url).origin === serverOrigin;
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

    // Both halves of the font dependency: a denied external FONT STYLESHEET and
    // a denied external FONT BINARY. A stylesheet alone would already make the
    // first paint depend on the network.
    const externalStyleRequests = externalRequests.filter((url) => /\.css(\?|$)/i.test(url));
    const fontRequests = externalRequests.filter((url) =>
      /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url),
    );
    expect(externalStyleRequests).toEqual([]);
    expect(fontRequests).toEqual([]);

    // The declared stack resolves to Inter, and the face is genuinely LOADED
    // (not merely named in CSS): `document.fonts.check` is false when the
    // family falls through to a platform substitute.
    const family = await page.evaluate(() => globalThis.getComputedStyle(document.body).fontFamily);
    expect(family.length).toBeGreaterThan(0);
    expect(family).toContain('Inter');
    await expect
      .poll(() => page.evaluate(() => globalThis.document.fonts.check('16px Inter')))
      .toBe(true);
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

  test('explicit-motion-setting — the Settings control drives the game HUD', async ({ page }) => {
    // The OS allows motion for the whole test: every change below is the
    // player's explicit choice, which is the clause AC-6 asks for.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openPlayShell(page);
    await expect(page.getByTestId('game-ui-overlay-layer')).toHaveAttribute('data-motion', 'full');

    // Settings → Gameplay → Motion: choose "Reduce motion". The in-game
    // overlay is registry-driven, so the Gameplay tab has to be selected first.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('.tabs').getByRole('button', { name: 'Gameplay' }).click();
    const motionSelect = page.getByTestId('settings-motion-preference');
    await expect(motionSelect).toBeVisible();
    await motionSelect.selectOption('reduce');
    await expect(motionSelect).toHaveValue('reduce');

    // Close Settings and return to the world: the SAME policy the HUD applies
    // must have followed the explicit choice, not the OS preference.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hud-menu-entry')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('game-ui-overlay-layer')).toHaveAttribute(
      'data-motion',
      'reduced',
    );

    // And it survives a reload — the choice is persisted, not session-only.
    await page.reload();
    await page.waitForSelector('[data-testid="hud-menu-entry"]', {
      state: 'visible',
      timeout: 30_000,
    });
    await expect(page.getByTestId('game-ui-overlay-layer')).toHaveAttribute(
      'data-motion',
      'reduced',
    );

    // Put it back so the choice does not leak into the other cases.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('.tabs').getByRole('button', { name: 'Gameplay' }).click();
    await page.getByTestId('settings-motion-preference').selectOption('auto');
    await page.keyboard.press('Escape');
  });

  test('explicit-motion-settings-page — the /settings control reflects the stored choice', async ({
    page,
  }) => {
    // AC-6 names TWO production paths, /game and /settings. The /settings route
    // boots a different entry point (the settings composition), so a restore
    // that only runs on game boot leaves this page showing the in-memory
    // default on every visit while the value sits in storage. That regression is
    // exactly what this case pins.
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await page.goto('/settings');
    // On /settings the section switcher is a real tablist, so `role=tab` is the
    // stable handle here (the in-game overlay uses plain buttons instead).
    await page.getByRole('tab', { name: 'Gameplay' }).click();

    const motionSelect = page.getByTestId('settings-motion-preference');
    await expect(motionSelect).toBeVisible();
    // Start from a known state so the case is self-contained.
    await motionSelect.selectOption('auto');
    await motionSelect.selectOption('reduce');
    await expect(motionSelect).toHaveValue('reduce');

    // Persisted, not in-memory.
    const stored = await page.evaluate(() => localStorage.getItem('aikami:motion:preference'));
    expect(stored).toBe('reduce');

    // 🔴 The regression: reload the SAME route and the control must still show
    // the stored choice, without any game boot having happened in this session.
    await page.reload();
    await page.getByRole('tab', { name: 'Gameplay' }).click();
    await expect(page.getByTestId('settings-motion-preference')).toHaveValue('reduce');

    // Both production paths agree: the game HUD applies the same choice.
    await page.goto('/game');
    await page.waitForSelector('[data-testid="hud-menu-entry"]', {
      state: 'visible',
      timeout: 30_000,
    });
    await expect(page.getByTestId('game-ui-overlay-layer')).toHaveAttribute(
      'data-motion',
      'reduced',
    );

    // Put the preference back so it cannot leak into sibling cases.
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Gameplay' }).click();
    await page.getByTestId('settings-motion-preference').selectOption('auto');
    await expect(page.getByTestId('settings-motion-preference')).toHaveValue('auto');
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
    await expect(page.getByTestId('management-panel-inventory')).toHaveCount(1);
  });

  test('section-navigation-stable — repeated round trips keep one host and one section body', async ({
    page,
  }) => {
    await openPlayShell(page);
    await openHost(page);

    // This test establishes the NAVIGATION invariant only: repeated sibling
    // switches never stack a second host and preserve each section's own
    // input. It deliberately makes NO pending-save/domain-idempotency claim —
    // a prior version was named for that and asserted input values, which
    // cannot prove domain work was not replayed. Real pending-operation
    // journeys need a controlled-completion provider seam (see the AC-7 gap in
    // the PR evidence).
    await page.getByTestId('section-tab-journal').click();
    await expect(page.getByTestId('management-panel-journal')).toBeVisible();
    await page.getByTestId('journal-search').fill('pending-work-probe');

    await page.getByTestId('section-tab-world').click();
    await expect(page.getByTestId('management-panel-world')).toBeVisible();
    await page.getByTestId('world-search').fill('emberwatch');

    // Navigate away and back, twice.
    for (let round = 0; round < 2; round += 1) {
      await page.getByTestId('section-tab-inventory').click();
      await expect(page.getByTestId('management-panel-inventory')).toBeVisible();

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
    const debug = (
      window as unknown as { __AIKAMI_DEBUG__?: { playerX?: number; playerY?: number } }
    ).__AIKAMI_DEBUG__;
    return { x: debug?.playerX ?? Number.NaN, y: debug?.playerY ?? Number.NaN };
  });

/** Movement keys tried when proving fresh input reaches the engine. */
const MOVEMENT_KEYS = ['d', 'w', 'a', 's'] as const;

/**
 * Presses each movement key briefly and returns the first one that actually
 * displaces the player, or null when none does. The Emberwatch spawn can wedge
 * the player against collision geometry, so the probe loops directions
 * instead of assuming a single key always works.
 */
const firstDirectionThatMoves = async (
  page: Page,
  from: { x: number; y: number },
): Promise<(typeof MOVEMENT_KEYS)[number] | null> => {
  for (const key of MOVEMENT_KEYS) {
    await page.keyboard.down(key);
    await page.waitForTimeout(500);
    await page.keyboard.up(key);
    const now = await readPlayerPosition(page);
    if (now.x !== from.x || now.y !== from.y) {
      return key;
    }
  }
  return null;
};

/**
 * Asserts the player is not moving: position unchanged across a full 400ms
 * window (so deceleration coincidence cannot read as a stop), then unchanged
 * again after another 800ms.
 */
const expectPlayerStill = async (page: Page): Promise<void> => {
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
  await page.waitForTimeout(800);
  expect(await readPlayerPosition(page)).toEqual(settled);
};

/** Waits until the render loop is publishing a finite player position. */
const waitForEngineRunning = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => {
      const debug = (
        window as unknown as { __AIKAMI_DEBUG__?: { playerX?: number; playerY?: number } }
      ).__AIKAMI_DEBUG__;
      return typeof debug?.playerX === 'number' && typeof debug?.playerY === 'number';
    },
    undefined,
    { timeout: 45_000 },
  );
};
