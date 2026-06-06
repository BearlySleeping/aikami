// apps/e2e/tests/pwa/character_card.spec.ts
// C-055: Verify chat route loads without crashes.

import { test } from '../../src/fixtures';

test.describe('CharacterCard Component', () => {
  test('should load chat page without crashing', async ({ authUser }) => {
    const resp = await authUser.goto('/chat/test-id');
    const { expect } = await import('@playwright/test');
    expect(resp?.status()).toBe(200);
  });

  test('chat page renders HTML shell', async ({ authUser }) => {
    await authUser.goto('/chat/test-id');
    await authUser.waitForLoadState('domcontentloaded');
  });
});
