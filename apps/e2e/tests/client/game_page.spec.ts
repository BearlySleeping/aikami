// apps/e2e/tests/client/game_page.spec.ts
//
// E2E test for the /game page — verifies the new separated
// GameView + GameUIView architecture renders correctly.

import { expect, test } from '@playwright/test';

test.describe('Game Page (Separated Architecture)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the game page
    await page.goto('/game');
    // Wait for the container to be in DOM (loading overlay covers it until engine is ready)
    await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 15000 });
  });

  test('should render the game canvas container (attached to DOM)', async ({ page }) => {
    const container = page.locator('#game-canvas-container');
    await expect(container).toBeAttached();
  });

  test('should render a canvas element inside the container', async ({ page }) => {
    const canvas = page.locator('#game-canvas-container canvas');
    await expect(canvas).toBeAttached();
  });

  test('should render the game UI layer', async ({ page }) => {
    const uiLayer = page.locator('#game-ui-layer');
    await expect(uiLayer).toBeAttached();
  });

  test('engine loads and hides loading overlay', async ({ page }) => {
    // Loading overlay should appear briefly then disappear when engine is ready
    const loadingText = page.getByText('Loading game engine...');
    // With WebGL enabled, engine should load and loading text should disappear
    await loadingText.waitFor({ state: 'hidden', timeout: 15000 });
  });

  test('should respond to Escape key by opening pause menu', async ({ page }) => {
    // Wait for engine to be ready (player HUD appears when canvas renders)
    const playerHud = page.locator('.bg-base-200\\/80');
    await playerHud.waitFor({ state: 'visible', timeout: 15000 });

    // Press Escape to open pause menu
    await page.keyboard.press('Escape');

    // Check for pause menu elements
    const resumeButton = page.getByText('Resume Game');
    await expect(resumeButton).toBeVisible({ timeout: 5000 });
  });

  // ── C-332 AC-1: Always-Visible HUD ──

  test('should render HP bar during exploration', async ({ page }) => {
    // Wait for engine to be ready
    await page.waitForSelector('[role="progressbar"]', { state: 'attached', timeout: 15000 });

    const hpBar = page.getByRole('progressbar', { name: 'Player HP' });
    await expect(hpBar).toBeVisible();

    // Check ARIA attributes contain numeric values
    const ariaValueNow = await hpBar.getAttribute('aria-valuenow');
    const ariaValueMin = await hpBar.getAttribute('aria-valuemin');
    const ariaValueMax = await hpBar.getAttribute('aria-valuemax');

    expect(ariaValueNow).toBeTruthy();
    expect(ariaValueMin).toBeTruthy();
    expect(ariaValueMax).toBeTruthy();
    expect(Number(ariaValueNow)).toBeGreaterThanOrEqual(0);
    expect(Number(ariaValueMin)).toBe(0);
    expect(Number(ariaValueMax)).toBeGreaterThan(0);
  });

  // ── C-332 AC-4: Focus Trap in Overlays ──

  test('should trap focus in pause menu overlay', async ({ page }) => {
    // Wait for engine ready
    await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 15000 });

    // Open pause menu
    await page.keyboard.press('Escape');
    const resumeButton = page.getByText('Resume Game');
    await expect(resumeButton).toBeVisible({ timeout: 5000 });

    // Locate the pause dialog
    const pauseDialog = page.locator('[role="dialog"][aria-label="Pause Menu"]');
    await expect(pauseDialog).toBeVisible();

    // Tab through focusable elements — verify focus stays within the pause dialog
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      // Verify document.activeElement is contained within the pause dialog
      const isContained = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="Pause Menu"]');
        const activeEl = document.activeElement;
        return dialog?.contains(activeEl) ?? false;
      });
      expect(isContained).toBe(true);
    }
  });

  test('should restore focus on overlay close', async ({ page }) => {
    await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 15000 });

    // Ensure game canvas container exists and get focus
    await page.locator('#game-canvas-container').focus();

    // Open pause menu
    await page.keyboard.press('Escape');
    const resumeButton = page.getByText('Resume Game');
    await expect(resumeButton).toBeVisible({ timeout: 5000 });

    // Close with Escape
    await page.keyboard.press('Escape');

    // Focus should return to game canvas container
    await expect(page.locator('#game-canvas-container')).toBeFocused({ timeout: 2000 });
  });
});

// ---------------------------------------------------------------------------
// C-375 — Emberwatch rendering & assets overhaul (production /game path)
// ---------------------------------------------------------------------------

test.describe('Emberwatch production path (C-375)', () => {
  /** Waits for the engine to boot and exposes the C-180 debug hook. */
  const waitForEngine = async (page: import('@playwright/test').Page, timeout = 45000) => {
    await page.goto('/game');
    await page.waitForSelector('#game-canvas-container canvas', { state: 'attached', timeout });
    await page.waitForFunction(
      () => {
        const d = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | { playerX?: number; playerY?: number }
          | undefined;
        return d && typeof d.playerX === 'number' && typeof d.playerY === 'number';
      },
      undefined,
      { timeout },
    );
  };

  const readPos = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const d = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
        | { playerX?: number; playerY?: number }
        | undefined;
      return d ? { x: d.playerX ?? 0, y: d.playerY ?? 0 } : { x: 0, y: 0 };
    });

  test('AC-1: props resolve their atlas frames — zero prop-frame-texture-missing errors', async ({
    page,
  }) => {
    const propErrors: string[] = [];
    const failedPropRequests: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('prop-frame-texture-missing')) {
        propErrors.push(text);
      }
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (url.includes('/game-data/lpc/props/')) {
        failedPropRequests.push(url);
      }
    });
    // Also fail on HTTP responses >= 400 from the legacy LPC props path
    // (a 404 that "succeeds" at the network layer still means the prop
    // art is missing — CodeRabbit review, C-375).
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/game-data/lpc/props/') && res.status() >= 400) {
        failedPropRequests.push(`${url} (status ${res.status()})`);
      }
    });

    await waitForEngine(page);
    // Give prop texture swaps a moment to complete after boot.
    await page.waitForTimeout(3000);

    expect(propErrors).toEqual([]);
    expect(failedPropRequests).toEqual([]);
  });

  test('AC-2: engine boots with the C-180 debug hook (player position exposed)', async ({
    page,
  }) => {
    await waitForEngine(page);
    const pos = await readPos(page);
    // Emberwatch village gate spawn: (320, 576).
    expect(pos.x).toBeGreaterThan(0);
    expect(pos.y).toBeGreaterThan(0);
  });

  test('AC-3: player is blocked by Elder Thalia (NPC collision)', async ({ page }) => {
    await waitForEngine(page);
    const start = await readPos(page);
    expect(start.y).toBeGreaterThan(500); // near the village gate

    // Hold Up along the path toward Elder Thalia (village plaza, y≈192).
    // A continuous keydown (browser auto-repeat) is far more reliable than
    // rapid down/up bursts, which headless Chromium can drop when the game
    // thread is busy (CodeRabbit review, C-375).
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 60; i++) {
      const p = await readPos(page);
      // Her grid cell is row 6 (y 192-223); the player's 32px box must stop
      // at the adjacent walkable cell (row 7+, y ≥ 224).
      if (p.y <= 232) {
        break;
      }
      await page.waitForTimeout(100);
    }
    await page.keyboard.up('KeyW');

    const final = await readPos(page);
    // The player must NOT overlap Elder Thalia's cell (row 6 = y 192-223).
    expect(final.y).toBeGreaterThanOrEqual(224);
    // …and must reach the ADJACENT cell (row 7 = y 224-255) rather than
    // stopping farther south (row 8+, y > 255) — CodeRabbit review, C-375.
    expect(final.y).toBeLessThanOrEqual(232);
    // And it must have moved north from the gate.
    expect(final.y).toBeLessThan(start.y);
  });
});
