// apps/e2e/tests/pwa/chat.spec.ts
// C-055: Verify chat route loads without crashes.
// Chat content depends on Firestore NPC data.

import { test } from '../../src/fixtures';

test.describe('Chat Components', () => {
  test('should load chat page without crashing', async ({ authUser }) => {
    await authUser.goto('/chat/test-id');
    await authUser.waitForLoadState('domcontentloaded');
  });

  test('chat page loads with valid status', async ({ authUser }) => {
    const resp = await authUser.goto('/chat/test-id');
    // SvelteKit returns 200 even if the NPC isn't in Firestore
    // (it renders a loading/error state client-side)
    if (resp) {
      const { expect } = await import('@playwright/test');
      expect(resp.status()).toBe(200);
    }
  });
});
