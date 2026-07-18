// apps/e2e/tests/client/dialogue_fallback.spec.ts
//
// E2E tests for authored fallback dialogue (C-328 AC-1).
// Tests offline NPC interaction with authored branch fallback.
//
// Run: bun moon run e2e:test-client -- --grep dialogue_fallback
//
// Contract: C-328 Integrate Bounded AI NPC Dialogue with Authored Fallbacks

import { expect, test } from '@playwright/test';

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
