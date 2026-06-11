// apps/e2e/tests/client/dev_text_stream.spec.ts
// C-072 / C-077: End-to-end validation of the dev text generation page.
//
// Verifies that the /dev/text page:
//   - Loads without connection errors
//   - Shows the provider dropdown (C-077) with Local Ollama as default
//   - Supports provider switching between Ollama and OpenRouter
//   - Triggers generation on instant=true param (requires Ollama or OpenRouter backend)
//   - Disables provider dropdown during generation

import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';

test.describe('Dev Text Stream (C-072 / C-077)', () => {
  test('should load the dev text page without errors', async ({ authUser }) => {
    const resp = await authUser.goto('/dev/text');
    expect(resp?.status()).toBe(200);

    // Verify the terminal output container exists and shows placeholder text
    const outputContainer = authUser.locator('pre.font-mono');
    await expect(outputContainer).toBeVisible();
    await expect(outputContainer).toContainText('Output will appear here');
  });

  test('should show provider dropdown with Local Ollama as default (C-077)', async ({
    authUser,
  }) => {
    const resp = await authUser.goto('/dev/text');
    expect(resp?.status()).toBe(200);

    // Verify the provider dropdown exists and defaults to ollama
    const providerSelect = authUser.locator('select.select-bordered');
    await expect(providerSelect).toBeVisible();
    await expect(providerSelect).toHaveValue('ollama');

    // Verify both options are present
    const options = providerSelect.locator('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveText('Local Ollama');
    await expect(options.nth(1)).toHaveText('OpenRouter (Free Model)');
  });

  test('should switch provider between Ollama and OpenRouter (C-077)', async ({ authUser }) => {
    const resp = await authUser.goto('/dev/text');
    expect(resp?.status()).toBe(200);

    const providerSelect = authUser.locator('select.select-bordered');

    // Switch to OpenRouter
    await providerSelect.selectOption('openrouter');
    await expect(providerSelect).toHaveValue('openrouter');

    // Switch back to Ollama
    await providerSelect.selectOption('ollama');
    await expect(providerSelect).toHaveValue('ollama');
  });

  test('should auto-populate prompt on instant=true query param', async ({ authUser }) => {
    const url = '/dev/text?instant=true&text=Hello+World';
    const resp = await authUser.goto(url);
    expect(resp?.status()).toBe(200);

    await authUser.waitForLoadState('networkidle');

    // The prompt textarea should be populated with the decoded text
    const promptTextarea = authUser.locator('textarea');
    await expect(promptTextarea).toHaveValue('Hello World');

    // Output should transition away from placeholder (either successful stream or error)
    const outputContainer = authUser.locator('pre.font-mono');
    await expect(outputContainer).not.toContainText('Output will appear here', { timeout: 15_000 });
  });

  test('should disable provider dropdown while generating (C-077)', async ({ authUser }) => {
    // Navigate with instant=true to trigger auto-generation
    const url = '/dev/text?instant=true&text=Hello';
    const resp = await authUser.goto(url);
    expect(resp?.status()).toBe(200);

    await authUser.waitForLoadState('networkidle');

    // Wait briefly for generation to start
    await authUser.waitForTimeout(500);

    // Verify the provider dropdown is disabled during generation
    const providerSelect = authUser.locator('select.select-bordered');
    await expect(providerSelect).toBeDisabled();
  });

  test('should handle missing text parameter gracefully', async ({ authUser }) => {
    // Navigate with instant=true but no text parameter
    const resp = await authUser.goto('/dev/text?instant=true');
    expect(resp?.status()).toBe(200);

    await authUser.waitForLoadState('networkidle');

    // The output container should still show the placeholder
    // because generate() was not triggered without text
    const outputContainer = authUser.locator('pre.font-mono');
    await expect(outputContainer).toBeVisible();
    await expect(outputContainer).toContainText('Output will appear here');
  });

  test('should not raise container connection errors during streaming', async ({ authUser }) => {
    // Track page errors during the streaming cycle
    const errors: string[] = [];
    authUser.on('pageerror', (error) => {
      errors.push(error.message);
    });

    const url = '/dev/text?instant=true&text=Hello+World';
    await authUser.goto(url);
    await authUser.waitForLoadState('networkidle');

    // Wait for output to transition away from placeholder
    const outputContainer = authUser.locator('pre.font-mono');
    await expect(outputContainer).not.toContainText('Output will appear here', { timeout: 15_000 });

    // Wait a moment for any late-breaking errors
    await authUser.waitForTimeout(2_000);

    // Verify no connection errors occurred
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
