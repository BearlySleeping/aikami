// apps/e2e/tests/client/combat_sandbox.spec.ts
//
// C-146: Freeform AI Combat Actions — E2E verification.
// C-149: Combat Mechanics & AI Gatekeeping
//
// MIGRATED (combat debug workspace consolidation): the freeform sandbox these
// tests targeted was DELETED. `/dev/combat` is now the production-backed debug
// workspace (`?mode=live|replay|fixtures`) and `/dev/sandbox/combat` is a thin
// 307 redirect to `?mode=live`. The old `CombatDevViewModel` — which owned the
// mock custom-action pipeline, the "Dev Mock" AI replies, the `useRealAi`
// switch, the `dev-action-force-player-hp-to-1` control and the
// "End Battle (Victory)" button — no longer exists.
//
// Old → new coverage mapping:
//
//   old assertion (deleted)                                   | replacement
//   ----------------------------------------------------------|--------------------------------
//   custom action input visible/enabled                       | CombatDebugPage live mode boots a real (isolated) session: production
//                                                             | combat sidebar renders with the attack/defend/flee controls and the
//                                                             | custom-action form. — `combat_debug.spec.ts`
//   custom action submit enables/disables on trimmed input    | deleted: input binding lived in the deleted sandbox view; no equivalent
//                                                             | (the production sidebar's form is covered on the LIVE mode surface).
//   buttons disabled while a custom action resolves           | deleted: needs a mock AI resolution path; live mode never mocks.
//   loading spinner while resolving                           | deleted: same reason.
//   custom narrative appended to the log ("Dev Mock")         | deleted: "Dev Mock" narration was sandbox-only.
//   empty input disables submit                               | deleted: sandbox-only input binding.
//   input hidden when combat ended                            | deleted: sandbox-only "End Battle (Victory)" control.
//   C-149 item-action gatekeeping ("inventory is empty")      | deleted: the mock gatekeeper lived in the sandbox ViewModel.
//
// The three tests below preserve the assertions that DO still make sense: the
// workspace shell renders, live mode boots a real session, and the production
// controls are present and operable.

import { expect, test } from '@playwright/test';
import { CombatDebugPage, CombatPage } from '$pom';

test.describe('Combat debug workspace — production-backed live mode (C-146/C-149 migration)', () => {
  let combat: CombatPage;
  let debug: CombatDebugPage;

  test.beforeEach(async ({ page }) => {
    debug = new CombatDebugPage(page);
    await debug.gotoLive();
    combat = new CombatPage(page);
  });

  test('renders the consolidated workspace shell and toolbar', async () => {
    await expect(debug.workspace).toBeVisible();
    await expect(debug.toolbar).toBeVisible();
    await expect(debug.modeSelect).toHaveValue('live');
    await debug.expectUrlQuery({ mode: 'live' });
  });

  test('boots an isolated real session and renders the production combat sidebar', async () => {
    // Live mode renders the PRODUCTION combat ViewModel against an isolated
    // engine session — the same sidebar `/game` uses. A visible attack button
    // therefore proves the production controls (not a sandbox mock) mounted.
    await debug.expectLiveSessionInteractive();
    await expect(debug.liveCanvas).toBeAttached();
    await expect(combat.attackButton).toBeVisible({ timeout: 30_000 });
    await expect(combat.defendButton).toBeVisible();
    await expect(combat.fleeButton).toBeVisible();
  });

  test('renders the freeform custom action form in live mode', async () => {
    // The production sidebar still carries the C-146 freeform action form; it
    // is disabled until combat is interactive, but it must be attached.
    await expect(combat.customActionInput).toBeVisible({ timeout: 30_000 });
    await expect(combat.customActionSubmit).toBeVisible();
    await expect(combat.customActionSubmit).toBeDisabled();
  });

  test('never surfaces an engine error while booting the isolated session', async () => {
    await debug.expectLiveSessionInteractive();
    await debug.expectNoEngineError();
  });
});
