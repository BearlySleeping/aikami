// apps/e2e/tests/client/emberwatch_house.spec.ts
//
// C-550 production-route E2E coverage for the Emberwatch raised house. The
// page object owns the test seam and renderer probes so this spec exercises
// the real `/game` map loader and movement system without DOM-level selectors.

import { expect, test } from '@playwright/test';
import { EmberwatchHousePage } from '$pom';

const HOUSE_ROOF_START = { c: 54, r: 4 } as const;
const HOUSE_APPROACH = { c: 54, r: 10 } as const;

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
    expect(start.player.r).toBe(10);

    await house.move('KeyW', 650);
    const thresholdAttempt = await house.snapshot();
    expect(thresholdAttempt.player.r).toBe(10);

    await house.move('KeyA', 350);
    const lateralApproach = await house.snapshot();
    expect(lateralApproach.player.r).toBe(10);
  });
});
