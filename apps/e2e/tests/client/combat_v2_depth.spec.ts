// apps/e2e/tests/client/combat_v2_depth.spec.ts
//
// C-532 AC-1 / AC-4 / AC-7: the authored encounter-depth journey through the
// PRODUCTION `/game` route.
//
// Everything here is read from the production path: the real Emberwatch pack,
// the authored `proof_encounter` started through the production start seam (no
// synthetic roster), the engine's own state snapshot for objectives, and the
// real commit path for environmental actions. No resolved events are injected.
//
// Contract: C-532 AC-1, AC-4, AC-7

import { expect, test } from '@playwright/test';
import { CombatPage } from '$pom';

/** The authored proof encounter — resolvable through the client's local pack path. */
const PROOF_ENCOUNTER = 'proof_encounter';
const RITUAL_OBJECTIVE = 'objective.stop_ritual';
const BRAZIER = 'emberwatch/brazier-1';

test.describe('C-532 encounter-depth journey on /game', () => {
  let combat: CombatPage;

  test.beforeEach(async ({ page }) => {
    combat = new CombatPage(page);
    await combat.bootAuthoredEnvironmentEncounter(PROOF_ENCOUNTER);
  });

  test('the authored ritual objective is readable with its deadline and required marker', async () => {
    await combat.expectObjectivesPanelVisible();
    // The objective panel is populated from the engine's own snapshot; a
    // visible required ritual proves objectives reached the shell and the
    // initial objective request fired when the encounter identity was set.
    const row = combat.objectiveRow(RITUAL_OBJECTIVE);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await combat.expectObjectiveStatus(RITUAL_OBJECTIVE, 'pending');
    await expect(row).toContainText(/Required/i);
    await expect(row).toContainText(/Deadline: round 3/i);
  });

  test('no reaction prompt is open until a window actually opens', async () => {
    await combat.expectObjectivesPanelVisible();
    // Ask is the default policy and has no default timer: nothing is forced on
    // the player before any trigger exists. Contract: C-532 AC-4.
    await expect(combat.reactionPrompt).toHaveCount(0);
  });

  test('a committed environmental action changes authoritative world state', async () => {
    await combat.selectAuthoredObject(BRAZIER);
    await combat.previewObjectAction('tip_over');
    await combat.confirmObjectAction();
    // The brazier breaks whether the check passed or failed — the attempt is
    // spent and the object's authoritative state changes. The objective panel
    // must remain coherent through the same commit (either the ritual completed
    // and the encounter settled, or it is still pending/failed).
    await combat.expectObjectState(BRAZIER, /broken|burning/);
  });
});
