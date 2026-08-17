// apps/e2e/tests/client/equipment_visual.spec.ts
//
// C-417 AC-1: equipment changes must update the rendered LPC sprite.
//
// The /dev/lpc-inventory sandbox drives the PRODUCTION equipmentService
// (the same service the /game journey wires into the engine via
// equipmentRecipeProvider) with a live LpcPreviewView — equipping Iron
// Armour rebuilds the preview recipes from base + equipment (torso slot
// replaced), unequipping reverts. The engine-side merge semantics are
// additionally pinned by the equipment_merge engine unit test.
//
// Functional assertions here: equip → equipped state + preview re-render;
// unequip → state reverts. Visual evidence (sprite visibly changes) is
// captured by the visual suite / Phase-3 screenshots.
//
// Run: bun moon run e2e:test-client -- --grep equipment_visual

import { expect, test } from '@playwright/test';

test.describe('Equipment → LPC sprite sync (C-417 AC-1)', () => {
  /**
   * Reads the composed preview recipes exposed by the sandbox VM
   * (window.__LPC_PREVIEW_RECIPES__) and returns the torso layer's assetId.
   * Mirrors the __PIXI_LPC_PREVIEW_LOADED__ hook pattern.
   */
  const getPreviewTorso = async (page: import('playwright').Page): Promise<string | undefined> =>
    page.evaluate(() => {
      const recipes = (window as unknown as Record<string, unknown>).__LPC_PREVIEW_RECIPES__ as
        | Array<{ slot: string; assetId: string }>
        | undefined;
      return recipes?.find((recipe) => recipe.slot === 'torso')?.assetId;
    });

  test('equipping Iron Armor changes the equipped state and keeps the preview rendering', async ({
    page,
  }) => {
    await page.goto('/dev/lpc-inventory', { waitUntil: 'domcontentloaded' });

    // The sandbox seeds Iron Armor in the bag (aria-label on the Equip button).
    const equipIronArmor = page.getByRole('button', { name: 'Equip Iron Armor' });
    await equipIronArmor.waitFor({ state: 'visible', timeout: 15_000 });

    // Baseline: the preview canvas is rendering.
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__PIXI_LPC_PREVIEW_LOADED__ === true,
      undefined,
      { timeout: 15_000 },
    );

    // Baseline: the preview torso layer is the base chainmail recipe.
    await expect.poll(() => getPreviewTorso(page)).toBe('torso/chainmail_male');

    // Equip Iron Armor → the body paperdoll slot shows it + an Unequip button.
    await equipIronArmor.click();
    const unequipIronArmor = page.getByRole('button', { name: 'Unequip Iron Armor' });
    await unequipIronArmor.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(page.getByText('Iron Armor').first()).toBeVisible();

    // The preview output must change to the Iron Armor torso recipe — not
    // just the UI state (C-417 AC-1: the rendered sprite actually updates).
    await expect.poll(() => getPreviewTorso(page)).toBe('torso/armour/plate_male');

    // The live preview canvas is still mounted after the re-compose.
    await expect(page.locator('canvas').first()).toBeVisible();

    // Unequip → the equipped state reverts (no Unequip button for Iron Armor).
    await unequipIronArmor.click();
    await expect(page.getByRole('button', { name: 'Unequip Iron Armor' })).toHaveCount(0);
    // The Equip button is available again.
    await expect(page.getByRole('button', { name: 'Equip Iron Armor' })).toBeVisible();
    // The preview output reverts — the Iron Armor plate torso is gone. In
    // the engine's merge semantics torso/feet are equipment-owned (base
    // torso is zeroed behind C-374), so with no body armor equipped the
    // layer is removed entirely rather than falling back to chainmail —
    // assert the plate recipe is no longer rendered.
    await expect.poll(() => getPreviewTorso(page)).not.toBe('torso/armour/plate_male');
  });

  test('equipped stats update when Iron Armor is equipped (defense bonus reflects gear)', async ({
    page,
  }) => {
    await page.goto('/dev/lpc-inventory', { waitUntil: 'domcontentloaded' });

    const equipIronArmor = page.getByRole('button', { name: 'Equip Iron Armor' });
    await equipIronArmor.waitFor({ state: 'visible', timeout: 15_000 });

    const defenseBadge = page.locator('.badge').filter({ hasText: 'DEF' }).first();
    const readDefense = async (): Promise<number> => {
      const text = (await defenseBadge.textContent()) ?? '';
      const match = text.match(/(\d+)/);
      return match ? Number.parseInt(match[1], 10) : Number.NaN;
    };
    const before = await readDefense();

    await equipIronArmor.click();

    // Iron Armor grants +5 DEF (manifest: ironArmor defenseBonus 5), but the
    // sandbox pre-equips chainmail (+4 DEF) in the same body slot — equipping
    // Iron Armor replaces it, so the badge moves by the net delta (+1), not
    // the full +5. Wait until the badge reflects exactly that value, proving
    // the equip mutated service state.
    const IRON_ARMOR_DEFENSE_BONUS = 5;
    const CHAINMAIL_DEFENSE_BONUS = 4;
    await expect
      .poll(readDefense)
      .toBe(before + (IRON_ARMOR_DEFENSE_BONUS - CHAINMAIL_DEFENSE_BONUS));
  });
});
