// apps/e2e/tests/client/dialogue_fallback.spec.ts
//
// E2E tests for authored fallback dialogue (C-328 AC-1) and the C-401
// timeout path (AC-4): a stalled provider surfaces an actionable error
// naming the provider and the authored fallback turn is offered.
//
// Run: bun moon run e2e:test-client -- --grep dialogue_fallback
//
// Contract: C-328 Integrate Bounded AI NPC Dialogue with Authored Fallbacks
// Contract: C-401 Stream Dialogue Narrative

import { expect, test } from '@playwright/test';
import { DialoguePage } from '../../src/pom/dialogue_page';

test.describe('Dialogue fallback (offline)', () => {
  test.skip('offline NPC interaction shows authored line + 2-4 choices, no error text', async ({
    page,
  }) => {
    // TODO: Requires GamePage POM with navigateTo/interactWithNpc helpers.
    // See C-328 contract for full acceptance criteria.
    expect(page).toBeDefined();
  });

  test.skip('choice selection advances conversation', async ({ page }) => {
    expect(page).toBeDefined();
  });

  test.skip('end dialogue returns to EXPLORE', async ({ page }) => {
    expect(page).toBeDefined();
  });
});

test.describe('Dialogue timeout fallback (C-401 AC-4)', () => {
  test('a stalled provider surfaces an actionable error and offers the authored fallback', async ({
    page,
  }) => {
    const dialogue = new DialoguePage(page);
    // ?stall=1 makes the sandbox mock behave like a provider that never
    // responds: it returns a fallback intent after the simulated timeout and
    // marks the turn state failed(timeout) with fallbackOffered: true.
    await dialogue.goto({ stall: true });

    await dialogue.sendMessage('Tell me about the ward');

    // The actionable error names the timeout; the fallback narrative is offered.
    await dialogue.expectTimeoutError();
    await dialogue.expectNpcText('looks at you, waiting');
  });
});
