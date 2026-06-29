// apps/e2e/tests/client/dev_text_stream.spec.ts
// C-072 / C-077: End-to-end validation of the dev text generation page.
//
// Verifies that the /dev/text page:
//   - Loads without connection errors
//   - Shows provider inputs (Endpoint, Model) instead of old select dropdown
//   - Handles instant=true query param for auto-population
//   - Output transitions from placeholder on generation

import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';

test.describe('Dev Text Stream (C-072 / C-077)', () => {
  test('should load the dev text page without errors', async ({ authUser }) => {
    const resp = await authUser.goto('/dev/text');
    expect(resp?.status()).toBe(200);

    // Verify the output container exists and shows placeholder text
    const outputContainer = authUser.locator('pre.font-mono').first();
    await expect(outputContainer).toBeVisible();
    await expect(outputContainer).toContainText('Output will appear here');
  });

  test('should show provider inputs with Endpoint and Model fields', async ({ authUser }) => {
    const resp = await authUser.goto('/dev/text');
    expect(resp?.status()).toBe(200);

    // Provider section uses text inputs, not a select dropdown
    await expect(authUser.getByText('Provider')).toBeVisible();
    await expect(authUser.getByPlaceholder('http://localhost:11434')).toBeVisible();
    await expect(authUser.getByText('Model')).toBeVisible();
  });

  test('should auto-populate prompt on instant=true query param', async ({ authUser }) => {
    const url = '/dev/text?instant=true&text=Hello+World';
    const resp = await authUser.goto(url);
    expect(resp?.status()).toBe(200);

    await authUser.waitForLoadState('networkidle');

    // The prompt textarea should be populated with the decoded text
    const promptTextarea = authUser.getByPlaceholder('Enter your prompt here...');
    await expect(promptTextarea).toHaveValue('Hello World');

    // Output should transition away from placeholder
    const outputContainer = authUser.locator('pre.font-mono').first();
    await expect(outputContainer).not.toContainText('Output will appear here', { timeout: 15_000 });
  });

  test('should handle missing text parameter gracefully', async ({ authUser }) => {
    const resp = await authUser.goto('/dev/text?instant=true');
    expect(resp?.status()).toBe(200);

    await authUser.waitForLoadState('networkidle');

    const outputContainer = authUser.locator('pre.font-mono').first();
    await expect(outputContainer).toBeVisible();
    await expect(outputContainer).toContainText('Output will appear here');
  });

  test('should not raise container connection errors during streaming', async ({ authUser }) => {
    const errors: string[] = [];
    authUser.on('pageerror', (error) => {
      errors.push(error.message);
    });

    const url = '/dev/text?instant=true&text=Hello+World';
    await authUser.goto(url);
    await authUser.waitForLoadState('networkidle');

    const outputContainer = authUser.locator('pre.font-mono').first();
    await expect(outputContainer).not.toContainText('Output will appear here', { timeout: 15_000 });

    await authUser.waitForTimeout(2_000);

    const connectionErrors = errors.filter(
      (e) =>
        e.includes('ECONNREFUSED') ||
        e.includes('Failed to fetch') ||
        e.includes('NetworkError') ||
        e.includes('AbortError'),
    );
    expect(connectionErrors).toHaveLength(0);
  });
});
