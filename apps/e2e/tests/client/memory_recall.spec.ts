// apps/e2e/tests/client/memory_recall.spec.ts
//
// C-492 AC-3: an NPC recalls an established, witnessed fact after save/reload.
//
// Journey (production path): establish a fact in conversation → the C-491
// narrative event service commits a witnessed `world_fact` → save → reload →
// return to the same NPC → the assembled dialogue context (the `[MEMORY]`
// section) contains the established fact, and the NPC's response reflects it.
//
// The assertion targets the ASSEMBLED CONTEXT that the production prompt would
// receive — NOT a live LLM "remembering". It seeds a witnessed fact via the
// production narrativeEventService, boots /game, saves, reloads, and asserts
// the injected recall surfaced for the witnessing NPC.
//
// Run: bun moon run e2e:test-client -- --grep memory_recall
//
// Contract: C-492 Memory retrieval correctness and production wiring

import { test } from '@playwright/test';
import { GamePage } from '$pom';

test.describe('C-492 memory recall journey', () => {
  test('AC-3: a witnessed fact survives save/reload and reaches the NPC context', async ({
    page,
  }) => {
    const game = new GamePage(page);

    // Boot the real /game pipeline (memory init + background index run from the
    // post-hydration boot hook — AC-2).
    await game.goto();

    // The memory service is indexed and ready once the game boots with authored
    // facts (the boot hook fires backgroundIndexOnLoad after hydrating_snapshot).
    await game.expectMemoryReady();

    // Establish a fact through dialogue so the C-491 event record commits a
    // witnessed event for the speaking NPC, then save and reload the campaign.
    await game.expectDialogueVisible();
    await game.sendFreeTextAndWaitForTurnCommit('I told you: the Ward Wand is in the cellar.');

    // Persist the campaign (facts round-trip via the C-491 narrativeEvents
    // snapshot — the retrieval index itself is ephemeral and rebuilt on load).
    await game.quickSave();

    // Reload — the index is rebuilt from the hydrated narrative events.
    await game.reloadAndWaitForBoot();
    await game.expectMemoryReady();

    // Return to the same NPC. The witness-scoped recall path must inject the
    // established fact into the NPC's [MEMORY] context.
    await game.expectDialogueVisible();
    await game.expectRecalledFact('Ward Wand');
  });
});
