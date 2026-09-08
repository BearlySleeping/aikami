// apps/e2e/tests/client/dialogue_slash_commands.spec.ts
//
// C-501: E2E for dialogue slash commands. Runs against the dev dialogue
// sandbox which mounts the production DialogueOverlay with the dev
// ViewModel — the same input choke point (`sendMessage`) a player uses on
// the production `/game` route.
//
// - AC-1: `/generate <prompt>` produces an inline image block and the NPC
//         does not receive the text as dialogue.
// - AC-5: an unknown slash command shows inline help; plain text still
//         reaches the NPC (no regression).
//
// Run: bun moon run e2e:test-client -- --grep dialogue_slash_commands
//
// Contract: C-501 Dialogue Slash Commands

import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import { DialoguePage } from '../../src/pom/dialogue_page';

test.describe('Dialogue slash commands (C-501)', () => {
  test('AC-1: /generate produces an inline image and not an NPC turn', async ({ authUser }) => {
    const dialogue = new DialoguePage(authUser);
    await dialogue.goto();

    const npcCountBefore = await dialogue.countNpcBubbles();

    await dialogue.sendMessage('/generate a forest clearing');

    // An image block appears (generating skeleton and/or the done image).
    // Allow either state since the provider may resolve to a demo image.
    await dialogue.page
      .locator(
        '[data-testid="dialogue-overlay"] img[alt="Generated scene"], [data-testid="dialogue-overlay"] .skeleton',
      )
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 });

    // The NPC must not have produced a new narrative turn for the command.
    const npcCountAfter = await dialogue.countNpcBubbles();
    expect(npcCountAfter).toBe(npcCountBefore);

    await dialogue.expectNoError();
  });

  test('AC-5: an unknown slash command shows inline help, not an NPC turn', async ({
    authUser,
  }) => {
    const dialogue = new DialoguePage(authUser);
    await dialogue.goto();

    const npcCountBefore = await dialogue.countNpcBubbles();
    await dialogue.sendMessage('/definitely-not-a-command');

    // A System help bubble is rendered.
    await expect(dialogue.systemBubbles.first()).toBeVisible({ timeout: 10_000 });
    await expect(dialogue.systemBubbles.first()).toContainText('/generate');

    // No NPC narrative turn was added.
    expect(await dialogue.countNpcBubbles()).toBe(npcCountBefore);
    await dialogue.expectNoError();
  });

  test('AC-5: plain text with no slash still reaches the NPC (no regression)', async ({
    authUser,
  }) => {
    const dialogue = new DialoguePage(authUser);
    await dialogue.goto();

    await dialogue.sendMessage('Tell me about the ward');

    // NPC responds conversationally — normal free-text flow intact.
    await dialogue.expectNpcText('Elder Thrain');
    await dialogue.expectNoError();
  });
});
