// apps/e2e/tests/client/npc_identity_persistence.spec.ts
//
// C-504 AC-5 — NPC appearance identity persists across load/reload.
//
// The starting map (village) spawns `village_elder`. The engine exposes the
// RESOLVED per-NPC appearance on `__AIKAMI_DEBUG__.npcAppearance` (slot →
// assetId), which is derived from the verified legacy snapshot via the shared
// named-appearance normalization. We assert resolved IDs (not just pixels):
// the elder must resolve to an adult female body + elderly head, and that
// identity must be identical before and after a full reload.
//
// Rollo (inn) and the merchant (shop) resolve to their intended male adult
// identities via the same normalization — proven at the integration layer
// (entity_spawner.test.ts) — and are exercised in the inn/shop scenes by the
// `/assets-verify 1` session (which boots the worktree client + map routing).

import { expect, type Page, test } from '@playwright/test';
import { GamePage } from '$pom';

type NpcAppearance = Record<string, string>;

const readElderAppearance = (page: Page): Promise<NpcAppearance> =>
  page.evaluate(() => {
    const debug = (
      window as unknown as { __AIKAMI_DEBUG__?: { npcAppearance?: Record<string, NpcAppearance> } }
    ).__AIKAMI_DEBUG__;
    return { ...(debug?.npcAppearance?.village_elder ?? {}) };
  });

const waitForElder = async (page: Page): Promise<NpcAppearance> => {
  await page.waitForFunction(
    () => {
      const debug = (
        window as unknown as {
          __AIKAMI_DEBUG__?: { npcAppearance?: Record<string, NpcAppearance> };
        }
      ).__AIKAMI_DEBUG__;
      const app = debug?.npcAppearance?.village_elder;
      return app !== undefined && Object.keys(app).length > 0;
    },
    { timeout: 30000 },
  );
  return readElderAppearance(page);
};

test.describe('NPC appearance identity (C-504 AC-5)', () => {
  test('elder resolves to adult female body + elderly head on the starting map', async ({
    page,
  }) => {
    const game = new GamePage(page);
    await page.goto('/game');
    await game.waitForEngineReady();

    const appearance = await waitForElder(page);
    // AC-1: the elder must NOT degrade to a child body/head (the legacy
    // index-mismatch bug). Assert resolved named identities.
    expect(appearance.body).toBe('body/bodies_female');
    expect(appearance.head).toBe('head/heads/human/female_elderly');
    expect(appearance.legs).toBe('legs/pants_female');
    expect(appearance.body).not.toBe('body/bodies_child');
    expect(appearance.head).not.toBe('head/heads/human/female_small');
  });

  test('elder identity is identical before and after reload', async ({ page }) => {
    const game = new GamePage(page);
    await page.goto('/game');
    await game.waitForEngineReady();
    const before = await waitForElder(page);

    await page.reload();
    await game.waitForEngineReady();
    const after = await waitForElder(page);

    // Idempotent: reload must not change the resolved named identity.
    expect(after).toEqual(before);
  });
});
