// apps/e2e/tests/client/combat_v2_environment.spec.ts
//
// C-531 AC-4 / AC-6: the authored environmental proof journey through the
// PRODUCTION `/game` route.
//
// The lane loads the real Emberwatch pack, starts the authored
// `proof_encounter` through the production start seam (no synthetic roster),
// inspects the authored objects through the real inspector UI, previews an
// action, confirms it, and asserts that the kernel's committed consequences are
// what the UI then shows.
//
// What this lane deliberately does NOT do: fake resolved events, patch HP, or
// mount an isolated substitute combat surface. Everything the assertions read
// comes from the production path.
//
// Contract: C-531 AC-4, AC-6

import { test } from '@playwright/test';
import { CombatPage } from '$pom';

/** The authored proof encounter — resolvable through the client's local pack path. */
const PROOF_ENCOUNTER = 'proof_encounter';
const BRAZIER = 'emberwatch/brazier-1';
const SUPPORT = 'emberwatch/support-1';

test.describe('C-531 environmental proof journey on /game', () => {
  let combat: CombatPage;

  test.beforeEach(async ({ page }) => {
    combat = new CombatPage(page);
    await combat.bootAuthoredEnvironmentEncounter(PROOF_ENCOUNTER);
  });

  test('the authored objects are projected into the live encounter', async () => {
    // The inspector is populated from the ENGINE's own state snapshot, so a
    // visible object here means the authored object reached the kernel.
    await combat.expectAuthoredObjects([
      BRAZIER,
      SUPPORT,
      'emberwatch/table-1',
      'emberwatch/oil-1',
    ]);
  });

  test('preview states the cost and the check without committing anything', async () => {
    await combat.selectAuthoredObject(BRAZIER);
    await combat.previewObjectAction('tip_over');
    // The check the engine will actually roll: category, DC and modifier.
    await combat.expectPreviewContains(/athletics/i);
    await combat.expectPreviewContains(/DC 12/i);

    // A preview is a pure question: the object is untouched until Confirm.
    await combat.expectObjectUnchanged(BRAZIER, /intact/);
  });

  test('confirming resolves the action and the committed state is visible', async () => {
    await combat.selectAuthoredObject(BRAZIER);
    await combat.previewObjectAction('tip_over');
    await combat.confirmObjectAction();

    // The kernel owns the outcome: the brazier breaks whether the check passed
    // or failed it is the attempt that was spent — and the object list, which
    // re-reads the engine's snapshot, says so.
    await combat.expectObjectState(BRAZIER, /broken|burning/);
  });

  test('an out-of-range authored action reports why it is unavailable', async () => {
    await combat.selectAuthoredObject(SUPPORT);
    await combat.expectObjectActionUnavailable('cut_support');
  });

  test('cutting the support drops its attached payload', async () => {
    await combat.moveActorAdjacentTo({ x: 7, y: 10 });
    await combat.selectAuthoredObject(SUPPORT);
    await combat.expectObjectActionEnabled('cut_support');
    await combat.previewObjectAction('cut_support');
    await combat.expectPreviewContains(/payload dropped/i);
    await combat.confirmObjectAction();
    await combat.expectObjectState(SUPPORT, /broken/);
  });
});
