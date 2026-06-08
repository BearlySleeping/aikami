// apps/e2e/tests/pwa/dev_text_stream.spec.ts
// C-072: End-to-end validation of the dev text generation page.
//
// Verifies that the /dev/text page:
//   - Loads without connection errors
//   - Supports ?instant=true&text=... auto-generation
//   - Streams text output into the terminal display box
//   - Transitions out of empty state during generation

import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';

test.describe('Dev Text Stream (C-072)', () => {
  test('should load the dev text page without errors', async ({ authUser }) => {
    const resp = await authUser.goto('/dev/text');
    expect(resp?.status()).toBe(200);

    // Verify the terminal output container exists and shows placeholder text
    const outputContainer = authUser.locator('pre.font-mono');
    await expect(outputContainer).toBeVisible();
    await expect(outputContainer).toContainText('Output will appear here');
  });

  test('should auto-generate text when instant=true query param is set', async ({ authUser }) => {
    // Navigate with instant=true and text=Hello+World query params
    const url = '/dev/text?instant=true&text=Hello+World';
    const resp = await authUser.goto(url);
    expect(resp?.status()).toBe(200);

    // Wait for the page to fully load
    await authUser.waitForLoadState('networkidle');

    // Verify the terminal output container exists
    const outputContainer = authUser.locator('pre.font-mono');
    await expect(outputContainer).toBeVisible();

    // The prompt textarea should be populated with the decoded text
    const promptTextarea = authUser.locator('textarea');
    await expect(promptTextarea).toHaveValue('Hello World');

    // Wait for the output to transition out of the empty placeholder
    // The generation is async, so we wait for the container to not contain
    // the placeholder text and instead contain generated content
    await expect(outputContainer).not.toContainText('Output will appear here', { timeout: 15_000 });

    // Verify the output container has some content (streaming started)
    const outputText = await outputContainer.textContent();
    expect(outputText).toBeTruthy();
    expect(outputText!.length).toBeGreaterThan(0);
  });

  test('should display generated text in the output terminal box', async ({ authUser }) => {
    // Navigate with instant=true and a longer text trigger
    const url = '/dev/text?instant=true&text=Write+a+short+poem+about+the+ocean';
    await authUser.goto(url);
    await authUser.waitForLoadState('domcontentloaded');

    // Locate the output terminal display box (the <pre> element)
    const outputContainer = authUser.locator('pre.font-mono');

    // Wait for output to appear — the container should change from placeholder
    await expect(outputContainer).not.toContainText('Output will appear here', { timeout: 20_000 });

    // Stream has started — verify the container is not empty
    const outputText = await outputContainer.textContent();
    expect(outputText).toBeTruthy();
    expect(outputText!.trim().length).toBeGreaterThan(0);
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

    // Wait for the output to transition (stream has started)
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
});
