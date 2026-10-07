// apps/e2e/tests/game/dialogue_combat.spec.ts
// Issue 5: the dialogue chip must reach a real worker encounter, not merely
// display an optimistically opened combat overlay.
import { expect, test } from '@playwright/test';
import { GamePage } from '$pom';
import { EMULATOR_PORTS } from '../../src/config';

type CombatDialogueSeam = {
  openCombatDialogue(npcId: string): void;
  getStartedEncounter():
    | { encounterId?: string; participantIds: number[]; engine?: string }
    | undefined;
  getOverlayState(): { overlay: string; mode: string };
};

test('Rollo combat chip starts the authored encounter in the worker', async ({ page }) => {
  const game = new GamePage(page);
  await page.goto(`http://localhost:${EMULATOR_PORTS.client}/game`);
  await game.waitForEngineReady();
  await game.waitForPlayingState();
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __AIKAMI_TEST__?: CombatDialogueSeam }).__AIKAMI_TEST__
        ?.openCombatDialogue === 'function',
  );
  await page.evaluate(() =>
    (
      window as unknown as { __AIKAMI_TEST__: CombatDialogueSeam }
    ).__AIKAMI_TEST__.openCombatDialogue('rollo_grasper'),
  );
  await game.clickChip('Fight back');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { __AIKAMI_TEST__: CombatDialogueSeam }
          ).__AIKAMI_TEST__.getStartedEncounter()?.encounterId,
      ),
    )
    .toBe('inn_wand_encounter');
  const started = await page.evaluate(() =>
    (
      window as unknown as { __AIKAMI_TEST__: CombatDialogueSeam }
    ).__AIKAMI_TEST__.getStartedEncounter(),
  );
  expect(started?.engine).toBe(process.env.PUBLIC_COMBAT_ENGINE ?? 'legacy');
  expect(started?.participantIds.length).toBeGreaterThanOrEqual(2);
  expect(started?.participantIds.every((id) => id > 0)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { __AIKAMI_TEST__: CombatDialogueSeam }
          ).__AIKAMI_TEST__.getOverlayState().overlay,
      ),
    )
    .toBe('COMBAT');
  await game.expectCombatActive();
  await game.expectCombatEnemy('Rollo the Grasper');
});
