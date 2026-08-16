// apps/e2e/tests/client/game_boot.spec.ts
//
// E2E tests for the /game boot pipeline.
// Contract: C-326 Make Game Boot Atomic, Observable, and Content-Driven
//
// Cases:
//   1. Fresh campaign boots to declared spawn with input unlocked
//   2. Navigate away mid-boot then re-enter boots cleanly

import { expect, test } from '@playwright/test';

test.describe('Game Boot Pipeline', () => {
  test('AC-1: should render loading stage and eventually show game canvas', async ({ page }) => {
    await page.goto('/game');

    // The stage-aware boot view should appear (not just "Loading game engine...")
    // The boot view renders stage label text and a progress bar
    const progressBar = page.locator('progress.progress-primary');
    await expect(progressBar).toBeAttached({ timeout: 10000 });

    // Wait for the game canvas to appear (boot completes)
    const canvas = page.locator('#game-canvas-container canvas');
    await expect(canvas).toBeAttached({ timeout: 30000 });
  });

  test('AC-4: should recover after navigation away and re-entry', async ({ page }) => {
    // First visit
    await page.goto('/game');

    // Wait for boot to start (progress bar appears)
    const progressBar = page.locator('progress.progress-primary');
    await expect(progressBar).toBeAttached({ timeout: 10000 });

    // Navigate away immediately
    await page.goto('/');

    // Re-enter game
    await page.goto('/game');

    // Should start fresh — progress bar appears again
    const newProgressBar = page.locator('progress.progress-primary');
    await expect(newProgressBar).toBeAttached({ timeout: 10000 });
  });

  test('AC-1: should eventually show player HUD when boot completes', async ({ page }) => {
    await page.goto('/game');

    // Wait for the game canvas container
    await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 15000 });

    // Wait for engine to be ready (player HUD appears when canvas renders)
    const playerHud = page.locator('.bg-base-200\\/80');
    await playerHud.waitFor({ state: 'visible', timeout: 30000 });

    await expect(playerHud).toBeVisible();
  });

  // C-400 AC-1: every map's authored NPC must spawn from the content pack
  // manifest. The expected count is derived from the manifest + the loaded
  // map's spawn layer (never hard-coded): the client loads startingMapId,
  // and the debug bridge exposes the spawned NPC count.
  test('AC-1: spawned NPC count matches the manifest NPC count for the loaded map', async ({
    page,
  }) => {
    await page.goto('/game');

    // Derive the expected authored-NPC count from the pack manifest and the
    // loaded map file: count the spawn layer's `npc` objects whose npcId
    // resolves in the manifest's npcs table.
    const expectedNpcCount = await page.evaluate(async () => {
      const manifestResponse = await fetch('content-packs/emberwatch/manifest.json');
      const manifest = (await manifestResponse.json()) as {
        startingMapId?: string;
        maps?: Record<string, { file?: string }>;
        npcs?: Record<string, unknown>;
      };
      const mapId = manifest.startingMapId ?? 'village';
      const mapFile = manifest.maps?.[mapId]?.file ?? 'maps/village.json';
      const mapResponse = await fetch(`content-packs/emberwatch/${mapFile}`);
      const map = (await mapResponse.json()) as {
        layers?: Array<{
          name?: string;
          objects?: Array<{
            type?: string;
            properties?: Array<{ name?: string; value?: unknown }>;
          }>;
        }>;
      };
      const npcSpawns =
        map.layers
          ?.find((layer) => layer.name === 'spawns')
          ?.objects?.filter((object) => object.type === 'npc') ?? [];
      const manifestNpcIds = new Set(Object.keys(manifest.npcs ?? {}));
      return npcSpawns.filter((object) => {
        const npcId = object.properties?.find((prop) => prop.name === 'npcId')?.value;
        return typeof npcId === 'string' && manifestNpcIds.has(npcId);
      }).length;
    });
    expect(expectedNpcCount).toBeGreaterThan(0);

    // Wait for the game canvas container
    await page.waitForSelector('#game-canvas-container', { state: 'attached', timeout: 15000 });

    // Poll the debug bridge until the spawned NPC count equals the
    // manifest-derived authored count (map load + spawn completes).
    await page.waitForFunction(
      (expected) => {
        const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | { npcCount?: number }
          | undefined;
        return typeof debug?.npcCount === 'number' && debug.npcCount === expected;
      },
      expectedNpcCount,
      { timeout: 30000 },
    );

    const npcCount = await page.evaluate(() => {
      const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
        | { npcCount?: number }
        | undefined;
      return debug?.npcCount ?? 0;
    });

    expect(npcCount).toBe(expectedNpcCount);
  });
});
