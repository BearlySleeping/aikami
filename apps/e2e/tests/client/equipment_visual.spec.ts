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

    // Equip Iron Armor → the body paperdoll slot shows it + an Unequip button.
    await equipIronArmor.click();
    const unequipIronArmor = page.getByRole('button', { name: 'Unequip Iron Armor' });
    await unequipIronArmor.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(page.getByText('Iron Armor').first()).toBeVisible();

    // The live preview canvas is still mounted after the re-compose.
    await expect(page.locator('canvas').first()).toBeVisible();

    // Unequip → the equipped state reverts (no Unequip button for Iron Armor).
    await unequipIronArmor.click();
    await expect(page.getByRole('button', { name: 'Unequip Iron Armor' })).toHaveCount(0);
    // The Equip button is available again.
    await expect(page.getByRole('button', { name: 'Equip Iron Armor' })).toBeVisible();
  });

  test('equipped stats update when Iron Armor is equipped (defense bonus reflects gear)', async ({
    page,
  }) => {
    await page.goto('/dev/lpc-inventory', { waitUntil: 'domcontentloaded' });

    const equipIronArmor = page.getByRole('button', { name: 'Equip Iron Armor' });
    await equipIronArmor.waitFor({ state: 'visible', timeout: 15_000 });

    const defenseBadge = page.locator('.badge').filter({ hasText: 'DEF' }).first();
    const before = (await defenseBadge.textContent()) ?? '';

    await equipIronArmor.click();
    await page.waitForTimeout(400);

    const after = (await defenseBadge.textContent()) ?? '';
    // Iron Armor grants +5 DEF (manifest: ironArmor defenseBonus 5) — the
    // badge must change, proving the equip actually mutated service state.
    expect(after).not.toBe(before);
  });
});
