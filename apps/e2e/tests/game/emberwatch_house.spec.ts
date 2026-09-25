// apps/e2e/tests/game/emberwatch_house.spec.ts
//
// C-550/C-553 production-route coverage for Emberwatch raised houses. The page
// object owns test seams, renderer probes and transitions so this spec exercises
// the real `/game` loader and movement system without DOM-level selectors.

import { expect, test } from '@playwright/test';
import { EmberwatchHousePage } from '$pom';

const HOUSE_ROOF_START = { c: 54, r: 4 } as const;
const HOUSE_APPROACH = { c: 54, r: 11 } as const;

test.describe('C-550 Emberwatch raised house', () => {
  test('loads the house map through production and reports WebGL', async ({ page }) => {
    const house = new EmberwatchHousePage(page);
    await house.goto({ gameHour: 12 });
    await house.loadMapAt('village', { c: 54, r: 6 });

    const snapshot = await house.snapshot();
    expect(snapshot.mapId).toBe('village');
    expect(snapshot.renderer).toBe('webgl');
    expect(snapshot.player.x).toBeGreaterThan(0);
    expect(snapshot.camera.x).toBeGreaterThan(0);
  });

  test('walk-behind roof is reachable and the front eave remains blocked', async ({ page }) => {
    const house = new EmberwatchHousePage(page);
    await house.goto({ gameHour: 12 });
    await house.loadMapAt('village', HOUSE_ROOF_START);

    await house.move('KeyS', 650);
    const enteredRoof = await house.snapshot();
    expect(enteredRoof.player.r).toBeGreaterThanOrEqual(6);

    await house.move('KeyS', 650);
    const blockedAtEave = await house.snapshot();
    expect(blockedAtEave.player.r).toBe(enteredRoof.player.r);
  });

  test('the visible door approach stops at the foundation threshold', async ({ page }) => {
    const house = new EmberwatchHousePage(page);
    await house.goto({ gameHour: 12 });
    await house.loadMapAt('village', HOUSE_APPROACH);

    const start = await house.snapshot();
    // The closed door is solid; the actor footprint settles on the second clear landing row.
    expect(start.player.c).toBe(54);
    expect(start.player.r).toBe(11);
    expect(start.camera.c).toBe(54);
    expect(start.camera.r).toBe(11);

    await house.move('KeyW', 650);
    const thresholdAttempt = await house.snapshot();
    expect(thresholdAttempt.player.c).toBe(54);
    expect(thresholdAttempt.player.r).toBe(11);

    await house.move('KeyA', 350);
    const lateralApproach = await house.snapshot();
    expect(lateralApproach.player.r).toBe(11);
  });
});

const INN_APPROACH = { c: 51, r: 22 } as const;
const INN_ROOF_START = { c: 51, r: 11 } as const;

const VILLAGE_DOOR_APPROACHES = [
  ['inn', { c: 51, r: 22 }],
  ['merchant shop', { c: 51, r: 36 }],
  ['smithy', { c: 8, r: 38 }],
  ['north-west cottage', { c: 9, r: 22 }],
  ['north cottage', { c: 21, r: 20 }],
  ['south-west shed', { c: 27, r: 43 }],
  ['north-east hut', { c: 54, r: 11 }],
] as const;

test.describe('C-553 Emberwatch village house rollout', () => {
  for (const [name, cell] of VILLAGE_DOOR_APPROACHES) {
    test(`loads the ${name} approach through production with resolved actor art`, async ({
      page,
    }) => {
      const house = new EmberwatchHousePage(page);
      await house.goto({ gameHour: 12 });
      await house.loadVillageAt(cell);

      await house.requireResolvedEntityTextures();
      const snapshot = await house.snapshot();
      expect(snapshot.renderer).toBe('webgl');
      expect(snapshot.mapId).toBe('village');
      expect(snapshot.player.c).toBe(cell.c);
      expect(snapshot.player.r).toBe(cell.r);
    });
  }

  test('inn upper roof is reachable and its front eave remains solid', async ({ page }) => {
    const house = new EmberwatchHousePage(page);
    await house.goto({ gameHour: 12 });
    await house.loadVillageAt(INN_ROOF_START);

    await house.move('KeyS', 650);
    const enteredRoof = await house.snapshot();
    expect(enteredRoof.player.c).toBe(51);
    expect(enteredRoof.player.r).toBeGreaterThanOrEqual(12);
    expect(enteredRoof.player.r).toBeLessThanOrEqual(16);

    await house.move('KeyS', 650);
    const reachedEave = await house.snapshot();
    expect(reachedEave.player.c).toBe(51);
    expect(reachedEave.player.r).toBeGreaterThanOrEqual(enteredRoof.player.r);
    expect(reachedEave.player.r).toBeLessThanOrEqual(16);

    await house.move('KeyS', 650);
    const blockedAtEave = await house.snapshot();
    expect(blockedAtEave.player.c).toBe(51);
    expect(blockedAtEave.player.r).toBe(reachedEave.player.r);
  });

  test('inn door enters and exits at the named arrivals without bouncing back', async ({
    page,
  }) => {
    const house = new EmberwatchHousePage(page);
    await house.goto({ gameHour: 12 });
    await house.loadVillageAt(INN_APPROACH);

    await house.moveThroughTransition({
      key: 'KeyW',
      fromMap: 'village',
      toMap: 'inn',
    });
    const entered = await house.snapshot();
    expect(entered.mapId).toBe('inn');
    expect(entered.player.c).toBe(14);
    expect(entered.player.r).toBe(17);
    await page.waitForTimeout(500);
    expect((await house.snapshot()).mapId).toBe('inn');

    await house.moveThroughTransition({
      key: 'KeyS',
      fromMap: 'inn',
      toMap: 'village',
    });
    const exited = await house.snapshot();
    expect(exited.mapId).toBe('village');
    expect(exited.player.c).toBe(51);
    expect(exited.player.r).toBe(23);
    await page.waitForTimeout(500);
    const settled = await house.snapshot();
    expect(settled.mapId).toBe('village');
    expect(settled.player.c).toBe(51);
    expect(settled.player.r).toBe(23);
  });
});
