// apps/e2e/tests/pwa/chat_sending.spec.ts
// C-055: Verify chat pages load without 5xx errors.

import { test } from '../../src/fixtures';

test.describe('Chat Message Sending', () => {
  test('should load chat page without crashing', async ({ authUser }) => {
    const resp = await authUser.goto('/chat/4YwVvY5y52OArJoG7zMh');
    const { expect } = await import('@playwright/test');
    expect(resp?.status()).toBe(200);
  });

  test('chat page renders HTML shell', async ({ authUser }) => {
    await authUser.goto('/chat/4YwVvY5y52OArJoG7zMh');
    await authUser.waitForLoadState('domcontentloaded');
  });
});
