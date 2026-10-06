// apps/e2e/tests/client/interaction_prompt_lifecycle.spec.ts
//
// C-327 AC-2 — the interaction prompt must follow the engine's selection for as
// long as that selection stands, in BOTH directions, across overlay open/close.
//
// The bug this pins: the prompt was a cached boolean with a second writer. The
// overlay router restored it from a remembered target when an overlay closed, and
// `INTERACTION_TARGET_CHANGED` is dirty-checked in the engine — so once the
// engine had published a selection there was no later event to correct the
// restore. The prompt then outlived its target until a map transition or a
// reload, the only two forced clears in the system.

import { expect, type Page, test } from '@playwright/test';
import { PlayShellPage } from '$pom';

/** The village guard's authored post; the player spawns inside its radius. */
const GUARD_POST = { x: 1056, y: 1376 };

/** Interaction radius authored for every Emberwatch NPC. */
const NPC_RADIUS = 48;

type NpcSnapshot = {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly d: number;
};

/**
 * Live NPC table plus the player's position.
 *
 * The village NPCs patrol, so every assertion below is expressed against ONE
 * pinned entity id rather than "the nearest NPC" — otherwise the oracle moves
 * with the subject and a genuinely correct prompt reads as a failure.
 */
const npcTable = (page: Page) =>
  page.evaluate(() => {
    const debug = (
      window as unknown as {
        __AIKAMI_DEBUG__?: {
          npcEntityIds?: number[];
          entityPositions?: Record<string, { x: number; y: number }>;
          playerX?: number;
          playerY?: number;
        };
      }
    ).__AIKAMI_DEBUG__;
    const table = debug?.entityPositions ?? {};
    const playerX = debug?.playerX ?? 0;
    const playerY = debug?.playerY ?? 0;
    return {
      player: { x: playerX, y: playerY },
      npcs: (debug?.npcEntityIds ?? []).flatMap((id) => {
        const npc = table[String(id)];
        return npc
          ? [{ id, x: npc.x, y: npc.y, d: Math.hypot(npc.x - playerX, npc.y - playerY) }]
          : [];
      }),
    };
  });

/** The single NPC closest to the player right now. */
const nearestNpc = async (page: Page): Promise<NpcSnapshot> => {
  const table = await npcTable(page);
  const closest = table.npcs.reduce<NpcSnapshot | undefined>(
    (best, npc) => (best === undefined || npc.d < best.d ? npc : best),
    undefined,
  );
  if (closest === undefined) {
    throw new Error('no NPC entities in the world');
  }
  return closest;
};

/** Distance from the player to one pinned NPC. */
const distanceTo = async (page: Page, id: number): Promise<number> => {
  const table = await npcTable(page);
  return table.npcs.find((npc) => npc.id === id)?.d ?? Number.POSITIVE_INFINITY;
};

/** Releases a held walk key, if any. */
const releaseHeld = async (page: Page, key: string | undefined): Promise<void> => {
  if (key !== undefined) {
    await page.keyboard.up(key);
  }
};

/** Resolves the walk key for a signed step; the horizontal axis wins ties. */
const walkKey = (dx: number, dy: number): string => {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? 'KeyD' : 'KeyA';
  }
  return dy > 0 ? 'KeyS' : 'KeyW';
};

/**
 * Walks until the player is within `stopAt` px of ONE pinned NPC (`closer`), or
 * at least that far from it (`closer: false`), re-deciding the key each poll from
 * that NPC's live position.
 *
 * Returns the distance reached. The village NPCs patrol, so steering against
 * "the nearest NPC" would chase a moving goal and could walk straight past the
 * subject without ever entering interaction range.
 */
const steerFromNpc = async (
  page: Page,
  id: number,
  stopAt: number,
  closer: boolean,
  timeoutMs: number,
): Promise<number> => {
  const started = Date.now();
  const sign = closer ? 1 : -1;
  let held: string | undefined;
  let distance = Number.POSITIVE_INFINITY;
  while (Date.now() - started < timeoutMs) {
    const table = await npcTable(page);
    const npc = table.npcs.find((entry) => entry.id === id);
    if (npc === undefined) {
      break;
    }
    distance = npc.d;
    const reached = closer ? distance <= stopAt : distance >= stopAt;
    if (reached) {
      break;
    }
    const key = walkKey((npc.x - table.player.x) * sign, (npc.y - table.player.y) * sign);
    if (held !== key) {
      await releaseHeld(page, held);
      await page.keyboard.down(key);
      held = key;
    }
    await page.waitForTimeout(60);
  }
  await releaseHeld(page, held);
  await page.waitForTimeout(300);
  return distance;
};

test.describe('interaction prompt lifecycle (C-327 AC-2)', () => {
  test('withdraws for an overlay, returns for a live target, and never outlives its clear', async ({
    page,
  }) => {
    const shell = new PlayShellPage(page);
    await shell.open();
    await page.waitForFunction(
      () =>
        (
          window as unknown as { __AIKAMI_TEST__?: { isMapReady?: () => boolean } }
        ).__AIKAMI_TEST__?.isMapReady?.() === true,
      undefined,
      { timeout: 30_000 },
    );

    await page.evaluate(
      (post) =>
        (
          window as unknown as {
            __AIKAMI_TEST__?: {
              loadPackMap: (o: {
                mapId: string;
                nearX?: number;
                nearY?: number;
              }) => Promise<boolean>;
            };
          }
        ).__AIKAMI_TEST__?.loadPackMap({ mapId: 'village', ...post }),
      GUARD_POST,
    );

    const prompt = page.getByTestId('interaction-prompt');
    await prompt.waitFor({ state: 'visible', timeout: 15_000 });

    // Pin the NPC the prompt is actually about.
    const target = await nearestNpc(page);
    expect(target.d).toBeLessThanOrEqual(NPC_RADIUS);

    // ── Opening an overlay withdraws the prompt, keeping the target ──
    await page.keyboard.press('KeyE');
    await page.getByTestId('dialogue-overlay').waitFor({ state: 'visible', timeout: 15_000 });
    await expect(prompt).toBeHidden();

    // ── Closing it hands the prompt back, because the target is still live ──
    await page.keyboard.press('Escape');
    await page.getByTestId('dialogue-overlay').waitFor({ state: 'hidden', timeout: 15_000 });
    await expect(prompt).toBeVisible();
    expect(await distanceTo(page, target.id)).toBeLessThanOrEqual(NPC_RADIUS);

    // ── Leaving the radius publishes the engine's clear ──
    const farDistance = await steerFromNpc(page, target.id, NPC_RADIUS + 150, false, 15_000);
    expect(farDistance).toBeGreaterThan(NPC_RADIUS + 100);
    await expect(prompt).toBeHidden();

    // ── The prompt is NOT resurrected by an overlay closing after the clear.
    //    This is the regression: the overlay router used to restore visibility
    //    from remembered metadata, and the dirty-checked engine had no later
    //    event to contradict it. ──
    await page.keyboard.press('KeyI');
    await page.getByTestId('inventory-overlay').waitFor({ state: 'visible', timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('inventory-overlay')).toBeHidden({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await expect(prompt).toBeHidden();

    // ── Returning to the live target republishes it ──
    const nearDistance = await steerFromNpc(page, target.id, NPC_RADIUS - 24, true, 20_000);
    expect(nearDistance).toBeLessThanOrEqual(NPC_RADIUS - 20);
    await expect(prompt).toBeVisible({ timeout: 10_000 });

    // ── And leaving again clears it: the second transition, which the stale
    //    cached flag could not survive. ──
    await steerFromNpc(page, target.id, NPC_RADIUS + 150, false, 15_000);
    await expect(prompt).toBeHidden();
  });

  test('a map load drops the previous scene target instead of leaving it up', async ({ page }) => {
    const shell = new PlayShellPage(page);
    await shell.open();
    await page.waitForFunction(
      () =>
        (
          window as unknown as { __AIKAMI_TEST__?: { isMapReady?: () => boolean } }
        ).__AIKAMI_TEST__?.isMapReady?.() === true,
      undefined,
      { timeout: 30_000 },
    );

    await page.evaluate(
      (post) =>
        (
          window as unknown as {
            __AIKAMI_TEST__?: {
              loadPackMap: (o: {
                mapId: string;
                nearX?: number;
                nearY?: number;
              }) => Promise<boolean>;
            };
          }
        ).__AIKAMI_TEST__?.loadPackMap({ mapId: 'village', ...post }),
      GUARD_POST,
    );

    const prompt = page.getByTestId('interaction-prompt');
    await prompt.waitFor({ state: 'visible', timeout: 15_000 });

    // A map load drops the previous scene's target outright. The player then
    // respawns on a different map, away from every NPC, so a remembered target
    // would keep the prompt up with no live selection behind it.
    await page.evaluate(() =>
      (
        window as unknown as {
          __AIKAMI_TEST__?: {
            loadPackMap: (o: { mapId: string; nearX?: number; nearY?: number }) => Promise<boolean>;
          };
        }
      ).__AIKAMI_TEST__?.loadPackMap({ mapId: 'ruined_shrine' }),
    );
    await page.waitForFunction(
      () =>
        (
          window as unknown as { __AIKAMI_TEST__?: { isMapReady?: () => boolean } }
        ).__AIKAMI_TEST__?.isMapReady?.() === true,
      undefined,
      { timeout: 30_000 },
    );
    // The shrine spawns the player away from its keeper, so the prompt must be
    // gone — a remembered target from the previous map would keep it up.
    const shrineTarget = await nearestNpc(page);
    expect(shrineTarget.d).toBeGreaterThan(NPC_RADIUS);
    await expect(prompt).toBeHidden({ timeout: 15_000 });
  });
});
