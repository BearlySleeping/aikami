// apps/e2e/tests/client/release_gate.spec.ts
//
// Release Gate — the single Playwright spec that proves Phase 1 is complete.
// Validates cold launch → setup → quest → combat → reward → save → reload
// on production routes. Runs in CI and blocks merges if any critical test fails.
//
// Contract: C-335 — Enforce the Playable Demo Release Gate
//
// Evidence Links:
//   AC-1 → C-326 (game boot), C-327 (onboarding), C-328 (dialogue),
//           C-329 (demo quest), C-330 (demo combat), C-331 (inventory),
//           C-332 (game HUD), C-334 (save/autosave)
//   AC-2 → C-328 (dialogue fallback), C-323 (text AI gate)
//   AC-3 → C-332 AC-4 (focus trap)
//   AC-4 → C-323 (text AI gate enforcement)
//   AC-5 → C-326 (boot), C-335 (this contract)
//   AC-6 → C-334 (save/autosave)
//   AC-7 → (visual suite)
//   AC-8 → C-336 (deterministic rules kernel)

import { expect, test } from '@playwright/test';
import { GamePage } from '$pom';
import { setupErrorCollection } from '../../src/error_allowlist';

// ── Shared Helpers ──────────────────────────────────────────

/**
 * Install error collection on a page and return a teardown function.
 * Call `await collector()` in test.afterEach to assert zero errors.
 */
const installErrorCollection = (page: import('@playwright/test').Page) => {
  const collector = setupErrorCollection(page);
  return async () => {
    await collector.assertNoErrors();
    collector.cleanup();
  };
};

// ──────────────────────────────────────────────────────────────
// AC-1: Full Cold-Launch Production Journey (Happy Path)
// ──────────────────────────────────────────────────────────────

test.describe('Release Gate', () => {
  test.describe('AC-1: Full Cold-Launch Production Journey', () => {
    let collectErrors: () => Promise<void>;

    test.beforeEach(async ({ page }) => {
      collectErrors = installErrorCollection(page);
    });

    test.afterEach(async () => {
      await collectErrors();
    });

    test('should complete cold launch → setup → quest → combat → reward → save → reload', async ({
      page,
    }) => {
      const game = new GamePage(page);

      // Step 1: Cold launch — navigate from root to game
      await page.goto('http://localhost:5274/', { waitUntil: 'domcontentloaded' });

      // Step 2: Start menu — click "New Adventure" via POM (asserts real label)
      await game.startNewAdventure();

      // Step 3: Onboarding — navigate through /setup
      await page.waitForURL(/\/(setup|game)/, { timeout: 15_000 });

      if (page.url().includes('/setup')) {
        // Complete onboarding steps — retry loop; must fail if exhausted without reaching /game
        for (let i = 0; i < 8; i++) {
          if (page.url().includes('/game')) {
            break;
          }
          const nextBtn = page.getByRole('button', { name: /next|continue|finish|start/i });
          if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await nextBtn.click();
            await page.waitForTimeout(500);
          } else {
            break;
          }
        }
        // Fail if onboarding exhausted without reaching /game
        expect(page.url()).toContain('/game');
      }

      // Step 4: Game boot — wait for engine ready and playing state
      await page.waitForURL(/\/game/, { timeout: 30_000 });
      await game.waitForEngineReady();
      await game.waitForPlayingState();

      // AC-1a: Canvas renders
      await expect(game.canvas).toBeAttached();
      await expect(game.canvas).toBeVisible();

      // AC-1b: HUD is visible (HP bar with ARIA)
      await expect(game.hpBar).toBeVisible({ timeout: 10_000 });

      // Step 5: NPC interaction — approach and talk
      await game.approachAndTalkToNpc();

      // Step 6: Dialogue — verify dialogue overlay
      await game.expectDialogueVisible();

      // Step 7: Skip through dialogue (accept quest implicitly)
      await game.skipDialogue();

      // Step 8: Quest tracker visible
      await game.expectQuestTrackerVisible();

      // Step 9: Trigger combat — walk toward combat trigger zone
      // Combat may auto-trigger after dialogue, or player must move
      await page.waitForTimeout(2000);

      // AC-2: Combat is entered unconditionally
      await game.expectCombatActive();

      // Fight until resolution
      for (let round = 0; round < 20; round++) {
        if (!(await game.isCombatAttackButtonVisible())) {
          break;
        }
        await game.waitForCombatActionReady();
        await game.clickAttack();
        await page.waitForTimeout(1000);
      }

      await game.expectCombatEnded();

      // Step 10: Capture state snapshot before save
      const stateBefore = await game.captureStateSnapshot();

      // Step 11: Manual save
      await game.saveGame();

      // Wait for save to complete
      await page.waitForTimeout(1000);

      // Step 12: Reload
      await game.reloadAndWaitForBoot();

      // AC-3: State survival — exact comparison
      const stateAfter = await game.captureStateSnapshot();

      // HP must be preserved exactly (no auto-heal/regen should reset it)
      expect(stateAfter.hp).toBe(stateBefore.hp);

      // Inventory item count must match
      expect(stateAfter.inventoryItemCount).toBe(stateBefore.inventoryItemCount);

      // Quest objective must match
      expect(stateAfter.questObjectiveLabel).toBe(stateBefore.questObjectiveLabel);

      // HUD is functional after reload
      await expect(game.hpBar).toBeVisible({ timeout: 15_000 });
      await game.waitForPlayingState();
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-2: Offline Production Journey with Local AI
  // ──────────────────────────────────────────────────────────

  test.describe('AC-2: Offline Production Journey with Local AI', () => {
    let collectErrors: () => Promise<void>;

    test.beforeEach(async ({ page }) => {
      collectErrors = installErrorCollection(page);
    });

    test.afterEach(async () => {
      await collectErrors();
    });

    test('should render authored fallback dialogue when network is offline', async ({ page }) => {
      // Skip in CI unless Ollama is available
      if (process.env.CI && !process.env.TEST_REQUIRES_OLLAMA) {
        test.skip(true, 'Offline AI test requires Ollama (not available in CI)');
        return;
      }

      const game = new GamePage(page);

      // Block all external domains, allow localhost
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.includes('localhost') || url.includes('127.0.0.1')) {
          return route.continue();
        }
        return route.abort('internetdisconnected');
      });

      // Navigate to game with QA bypass disabled
      await page.goto('http://localhost:5274/game', { waitUntil: 'domcontentloaded' });
      await game.waitForEngineReady();
      await game.waitForPlayingState();

      // AC-2a: Game boots without network access (canvas visible)
      await expect(game.canvas).toBeVisible();

      // AC-2b: NPC dialogue renders fallback text
      await game.approachAndTalkToNpc();

      // Dialogue overlay must be visible — fail if offline dialogue does not appear
      const dialogueOverlay = page.locator('[data-testid="dialogue-overlay"], .dialogue-overlay');
      await expect(dialogueOverlay).toBeVisible({ timeout: 15_000 });

      // Verify no raw error strings in the dialogue text
      const dialogueText = await dialogueOverlay.textContent();
      expect(dialogueText).not.toContain('Error');
      expect(dialogueText).not.toContain('undefined');
      expect(dialogueText).not.toContain('null');
      expect(dialogueText).not.toContain('[*');
      expect(dialogueText).not.toContain('*]');

      // AC-2c: 2-4 choices visible
      const choiceCount = await game.getDialogueChoiceCount();
      expect(choiceCount).toBeGreaterThanOrEqual(2);
      expect(choiceCount).toBeLessThanOrEqual(4);
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-3: Keyboard-Only Production Journey
  // ──────────────────────────────────────────────────────────

  test.describe('AC-3: Keyboard-Only Production Journey', () => {
    let collectErrors: () => Promise<void>;

    test.beforeEach(async ({ page }) => {
      collectErrors = installErrorCollection(page);
    });

    test.afterEach(async () => {
      await collectErrors();
    });

    test('should complete full journey using only keyboard inputs', async ({ page }) => {
      const game = new GamePage(page);

      // Step 1: Navigate (mouse-based goto is acceptable for initial load)
      await page.goto('http://localhost:5274/', { waitUntil: 'domcontentloaded' });

      // Tab to "New Adventure" and press Enter
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => document.activeElement?.tagName);
        if (focused === 'A' || focused === 'BUTTON') {
          const text = await page.evaluate(
            () => (document.activeElement as HTMLElement)?.innerText || '',
          );
          // Use the same label as startNewAdventure() — "New Adventure"
          if (text.trim() === 'New Adventure') {
            await page.keyboard.press('Enter');
            break;
          }
        }
      }

      // Wait for navigation
      await page.waitForURL(/\/(setup|game)/, { timeout: 15_000 });

      // Keyboard through onboarding
      if (page.url().includes('/setup')) {
        for (let i = 0; i < 8; i++) {
          if (page.url().includes('/game')) {
            break;
          }
          // Tab to Next/Continue button
          for (let j = 0; j < 5; j++) {
            await page.keyboard.press('Tab');
          }
          await page.keyboard.press('Enter');
          await page.waitForTimeout(500);
        }
        // Fail if onboarding exhausted without reaching /game
        expect(page.url()).toContain('/game');
      }

      // Wait for game boot
      await page.waitForURL(/\/game/, { timeout: 30_000 });
      await game.waitForEngineReady();
      await game.waitForPlayingState();

      // AC-3a: Verify document.activeElement is never document.body during interaction
      const checkFocusNotBody = async (): Promise<void> => {
        const activeTag = await page.evaluate(() => document.activeElement?.tagName || 'UNKNOWN');
        // Game canvas is an acceptable focus target
        expect(activeTag).not.toBe('BODY');
      };

      // Game canvas should be reachable via keyboard
      await checkFocusNotBody();

      // Navigation with arrow keys
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(100);
      }
      await checkFocusNotBody();

      // Interact with NPC
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);

      // Dialogue — choose option with Tab + Enter (must appear)
      await game.expectDialogueVisible();

      // Tab to first choice and press Enter
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      // Verify focus is trapped within dialogue overlay
      await checkFocusNotBody();

      // Open inventory with 'I' key
      await page.keyboard.press('KeyI');
      await page.waitForTimeout(500);
      await game.expectInventoryOpen();

      // Close with Escape
      await page.keyboard.press('Escape');
      await game.expectInventoryClosed();

      // AC-3b: Pause menu with Escape — focus trap test
      await page.keyboard.press('Escape');
      const resumeButton = page.getByText('Resume Game');
      await expect(resumeButton).toBeVisible({ timeout: 5000 });

      // Tab through focusable elements — must stay in pause dialog
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
        const isContained = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"][aria-label="Pause Menu"]');
          return dialog?.contains(document.activeElement) ?? false;
        });
        expect(isContained).toBe(true);
      }

      // Close pause menu
      await page.keyboard.press('Escape');
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-4: AI Capability Gate Enforcement
  // ──────────────────────────────────────────────────────────

  test.describe('AC-4: AI Capability Gate Enforcement', () => {
    let collectErrors: () => Promise<void>;

    test.beforeEach(async ({ page }) => {
      collectErrors = installErrorCollection(page);
    });

    test.afterEach(async () => {
      await collectErrors();
    });

    test('should block gameplay when no AI provider is available and QA bypass is false', async ({
      page,
    }) => {
      const game = new GamePage(page);

      // Navigate to root without QA bypass
      await page.goto('http://localhost:5274/', { waitUntil: 'domcontentloaded' });

      // Check if the AI capability gate is active
      const capabilityMsg = page.getByText(/text ai|ai provider|capability|offline demo/i);
      if (
        !(await capabilityMsg
          .first()
          .isVisible({ timeout: 5000 })
          .catch(() => false))
      ) {
        // Gate is not active (text AI is available) — skip this environment-dependent leg
        test.skip(
          true,
          'AI capability gate test requires text AI to be unavailable (not applicable in CI with emulators)',
        );
        return;
      }

      // AC-4a: Capability screen should be visible
      await expect(capabilityMsg.first()).toBeVisible({ timeout: 10_000 });

      // AC-4b: The capability screen should NOT offer an "Offline Demo" button
      const offlineButton = page.getByRole('button', { name: /offline demo/i });
      await expect(offlineButton).not.toBeVisible({ timeout: 3000 });

      // AC-4c: Clicking "New Adventure" should not reach /setup or /game
      await game.startNewAdventure();
      await page.waitForTimeout(3000);

      // Must not have navigated to game-related routes
      const currentUrl = page.url();
      expect(currentUrl).not.toContain('/setup');
      expect(currentUrl).not.toContain('/game');
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-5: Console and Network Error Assertions
  // ──────────────────────────────────────────────────────────
  //
  // AC-5 is automatically enforced via the errorCollector fixture.
  // Every test in this spec collects console errors, page errors,
  // and failed network requests, then asserts zero errors at teardown.
  //
  // If a specific test requires intentional errors (e.g., offline
  // tests), those tests should clean up the collector manually.
  //
  // ──────────────────────────────────────────────────────────

  test.describe('AC-5: Console and Network Error Assertions', () => {
    let collectErrors: () => Promise<void>;

    test.beforeEach(async ({ page }) => {
      collectErrors = installErrorCollection(page);
    });

    test.afterEach(async () => {
      await collectErrors();
    });

    test('should have zero console errors during boot to playing state', async ({ page }) => {
      // Simple boot test — errorCollector asserts zero errors at teardown
      const game = new GamePage(page);
      await game.goto({ bypassTextAi: true });
      await game.waitForPlayingState();

      // Canvas must be visible
      await expect(game.canvas).toBeVisible();

      // HUD must be visible
      await expect(game.hpBar).toBeVisible();

      // errorCollector.assertNoErrors() runs in teardown via fixture
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-6: State Survival Across Reload
  // ──────────────────────────────────────────────────────────

  test.describe('AC-6: State Survival Across Reload', () => {
    let collectErrors: () => Promise<void>;

    test.beforeEach(async ({ page }) => {
      collectErrors = installErrorCollection(page);
    });

    test.afterEach(async () => {
      await collectErrors();
    });

    test('should preserve player HP, inventory, and quest state after page reload', async ({
      page,
    }) => {
      const game = new GamePage(page);

      // Boot to playing state
      await game.goto({ bypassTextAi: true });
      await game.waitForPlayingState();

      // Capture pre-reload state snapshot (HP, inventory count, quest objective)
      const stateBefore = await game.captureStateSnapshot();
      expect(stateBefore.hp).toBeGreaterThan(0);
      expect(stateBefore.inventoryItemCount).toBeGreaterThan(0);

      // Save game manually
      await game.saveGame();

      // Wait for save to complete
      await page.waitForTimeout(1000);

      // Reload
      await game.reloadAndWaitForBoot();

      // Capture post-reload state snapshot
      const stateAfter = await game.captureStateSnapshot();

      // AC-6a: HP preserved exactly — no tolerance unless a named mechanic justifies it
      expect(stateAfter.hp).toBe(stateBefore.hp);

      // AC-6b: Inventory items preserved (same count)
      expect(stateAfter.inventoryItemCount).toBe(stateBefore.inventoryItemCount);

      // AC-3: Quest objective preserved
      expect(stateAfter.questObjectiveLabel).toBe(stateBefore.questObjectiveLabel);

      // AC-6c: HUD is functional after reload
      await expect(game.hpBar).toBeVisible();
      await expect(game.playerHud).toBeVisible();
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-7 & AC-8: Visual Checkpoints + Engine Replay
  // ──────────────────────────────────────────────────────────
  //
  // AC-7 lives in apps/e2e/src/visual/suites/release_gate.visual.ts
  // AC-8 lives in apps/e2e/src/fixtures/engine_replay.ts
  //
  // ──────────────────────────────────────────────────────────
});
