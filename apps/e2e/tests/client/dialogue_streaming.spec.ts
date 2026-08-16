// apps/e2e/tests/client/dialogue_streaming.spec.ts
//
// C-401: E2E for streamed NPC dialogue narrative.
// Runs against the dev dialogue sandbox which mounts the production
// DialogueOverlay with a stubbed slow streaming provider (deterministic).
//
// - AC-1: narrative text grows incrementally while streaming
// - AC-2: skill-check narrative is visible BEFORE the dice prompt; the
//         resolution narrative appears after the roll
// - AC-3: abort is clean — no partial turn, no error surfaced
//
// Run: bun moon run e2e:test-client -- --grep dialogue_streaming
//
// Contract: C-401 Stream Dialogue Narrative

import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import { DialoguePage } from '../../src/pom/dialogue_page';

test.describe('Dialogue streaming (C-401)', () => {
  test('AC-1: narrative text grows incrementally while streaming', async ({ authUser }) => {
    const dialogue = new DialoguePage(authUser);
    await dialogue.goto();

    await dialogue.sendMessage('Tell me about the ward');

    // Sample the streaming text node across at least three polls — the stubbed
    // provider emits a chunk every ~110ms, so length must strictly increase.
    const lengths: number[] = [];
    for (let i = 0; i < 3; i++) {
      await authUser.waitForTimeout(130);
      lengths.push(await dialogue.getStreamingTextLength());
    }

    expect(lengths[0]).toBeGreaterThan(0);
    expect(lengths[1]).toBeGreaterThan(lengths[0]);
    expect(lengths[2]).toBeGreaterThan(lengths[1]);

    // The full narrative settles in a bubble once the turn completes.
    await dialogue.expectNpcText('Elder Thrain strokes his beard');
    await dialogue.expectNoError();
  });

  test('AC-2: skill-check narrative streams before the dice prompt; resolution after roll', async ({
    authUser,
  }) => {
    const dialogue = new DialoguePage(authUser);
    await dialogue.goto();

    await dialogue.sendMessage('I try to persuade you');

    // The pre-roll narrative must be non-empty BEFORE the dice panel appears.
    await dialogue.waitForStreamingStarted();
    expect(await dialogue.getStreamingTextLength()).toBeGreaterThan(0);
    expect(await dialogue.diceOverlay.count()).toBe(0);

    // The dice panel then appears once intent analysis completes.
    await dialogue.diceOverlay.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(dialogue.d20RollButton).toBeVisible();

    // Roll: first click acknowledges the declared DC, second rolls.
    await dialogue.d20RollButton.click();
    await authUser.waitForTimeout(100);
    await dialogue.d20RollButton.click();

    // The resolution narrative settles in a bubble after the roll.
    await dialogue.expectNpcText('Crystal Caverns');
    await dialogue.expectNoError();
  });

  test('AC-3: abort is clean — no partial turn, no error surfaced', async ({ authUser }) => {
    const dialogue = new DialoguePage(authUser);
    await dialogue.goto();

    await dialogue.sendMessage('Tell me about the ward');
    await dialogue.waitForStreamingStarted();

    // Cancel mid-stream.
    await dialogue.cancelStreaming();

    // No [Generation cancelled] placeholder and no error banner.
    await expect(authUser.getByText('[Generation cancelled]')).toHaveCount(0);
    await dialogue.expectNoError();

    // The placeholder NPC bubble is removed — only the greeting remains,
    // and the player's message stays in the history.
    await authUser.waitForTimeout(300);
    expect(await dialogue.countNpcBubbles()).toBe(1);
    await dialogue.expectPlayerMessage('Tell me about the ward');
  });
});
