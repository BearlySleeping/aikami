// apps/e2e/tests/game/goap_combat.spec.ts
//
// GOAP Combat Tactics — E2E test for tactical combat AI.
// Contract C-197: Validates full-stack tactical routing in a running game.
//
// 🔴 DISABLED (combat debug workspace consolidation). The route these tests
// drove, `/dev/sandbox/combat?test_tactics=true`, no longer exists:
//
//   - `/dev/sandbox/combat` is now a thin 307 redirect to `/dev/combat?mode=live`;
//   - the `sandbox_combat.json` map the old sandbox loaded was DELETED, which is
//     why the workspace consolidation removed the route rather than restoring it;
//   - `test_tactics` / `testTactics` is not a parameter the consolidated
//     workspace reads — it reads `scenario`, `mode`, `tab` and `seed` only.
//
// WHAT WAS LOST: these three tests only ever asserted that *a* dev combat page
// booted with `__AIKAMI_DEBUG__` present, not that tactical positioning actually
// happened (the real GOAP behaviour is covered by the engine/kernel suites and
// by `goap_cognition.spec.ts`). The replacement surface is the consolidated
// workspace's `environmental-action` / `objective-boundary` synthetic scenarios
// for authored battlefield objects, and `emberwatch-proof` for the real pack.
//
// The equivalent NEW coverage is `apps/e2e/tests/client/combat_debug.spec.ts`
// (workspace smoke: live mode boots, fixtures render, replay validates). The
// tests below are marked `fixme` — not deleted — so the lost route is explicit
// and the file stays in the report instead of vanishing from it.
//
// Re-enable only if a tactics scenario is authored in `COMBAT_DEBUG_SCENARIOS`.

import { expect, test } from '@playwright/test';
import { CombatDebugPage } from '$pom';

test.describe('GOAP Combat Tactics E2E (C-197) — legacy sandbox route', () => {
  // Kept for the import type-check and to document the intended replacement;
  // the fixme bodies below never run.
  void CombatDebugPage;

  test.fixme('game boots with tactical AI enabled', async ({ page }) => {
    // LOST: `/dev/sandbox/combat?test_tactics=true` (deleted map + redirect).
    // Replacement intent: boot `/dev/combat?mode=live` on a tactics scenario
    // once one is authored in COMBAT_DEBUG_SCENARIOS.
    await page.goto('/dev/combat?mode=live');
    await expect(page.locator('[data-testid="combat-debug-view"]')).toBeVisible();
  });

  test.fixme('combat AI debug state is accessible', async ({ page }) => {
    // LOST: `__AIKAMI_DEBUG__` was published by the deleted sandbox. The
    // consolidated workspace deliberately exposes no second global — its
    // diagnostics are the inspector tabs and the trace timeline.
    await page.goto('/dev/combat?mode=live');
    await expect(page.locator('[data-testid="combat-debug-view"]')).toBeVisible();
  });

  test.fixme('tactical AI resolves targets after combat initiation', async ({ page }) => {
    // LOST: this only asserted `document.body.children.length > 0` on the
    // deleted sandbox — a blank-screen guard with no tactics assertion.
    // `combat_debug.spec.ts` now provides the real workspace smoke coverage.
    await page.goto('/dev/combat?mode=live');
    await expect(page.locator('[data-testid="combat-debug-view"]')).toBeVisible();
  });
});
