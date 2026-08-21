// apps/e2e/tests/client/message_actions_a11y.spec.ts
//
// C-423 AC-1: no primary action is hover-only or focus-invisible.
//
// Verifies the three hover-only action surfaces (chat message action bar,
// dialogue message actions, combat inline image overlay) are:
//   - visible when focused (focus-within) — keyboard users see what they tab to
//   - reachable without hover at touch widths (max-sm persistent)
//   - free of serious/critical axe violations
//
// Surfaces:
//   - Chat + combat: /dev/sandbox/message-actions (mounts the PRODUCTION
//     MessageActionBar and CombatInlineImage components in controlled states)
//   - Dialogue: /dev/sandbox/dialogue (mounts the PRODUCTION DialogueOverlay)
//
// Run: bun moon run e2e:test-client -- --grep message_actions_a11y
//
// Contract: C-423 Design North Star

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Navigate to the message-actions sandbox and wait for it to render. */
const gotoMessageActions = async (page: Page): Promise<void> => {
  await page.goto('/dev/sandbox/message-actions', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('message-actions-heading').waitFor({ state: 'visible', timeout: 15_000 });
};

/** Navigate to the dialogue sandbox (production DialogueOverlay) and wait. */
const gotoDialogue = async (page: Page): Promise<void> => {
  await page.goto('/dev/sandbox/dialogue', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea', { state: 'visible', timeout: 15_000 });
  await page.getByText('Ah, a traveler!').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(300);
};

/**
 * Computed opacity of the button's direct parent action container.
 * The container (not the button) carries the `opacity-0` hover/focus toggle, so
 * asserting the container's opacity is what actually verifies visibility.
 */
const containerOpacity = async (button: ReturnType<Page['getByRole']>): Promise<number> => {
  const opacity = await button.evaluate((el) => {
    const container = el.parentElement;
    return container ? getComputedStyle(container).opacity : '0';
  });
  return parseFloat(opacity);
};

/** Asserts a focused action button's container is fully visible (non-zero computed opacity). */
const expectFocusedVisible = async (button: ReturnType<Page['getByRole']>): Promise<void> => {
  await button.focus();
  // Poll: the container fades in over the 150ms transition-opacity, so wait
  // for it to reach a non-zero opacity rather than asserting immediately.
  await expect.poll(async () => containerOpacity(button)).toBeGreaterThan(0);
};

/** Asserts an action button's container is visible WITHOUT hover/focus (touch-width persistent). */
const expectVisibleWithoutHover = async (button: ReturnType<Page['getByRole']>): Promise<void> => {
  await expect.poll(async () => containerOpacity(button)).toBeGreaterThan(0);
};

/** Asserts no serious/critical axe violations within the given scope. */
const expectNoSeriousAxe = async (page: Page, scope: string): Promise<void> => {
  const results = await new AxeBuilder({ page }).include(scope).analyze();
  const seriousOrCritical = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(seriousOrCritical).toEqual([]);
};

test.describe('Message actions a11y (C-423 AC-1)', () => {
  test.describe('Desktop 1280×720 — keyboard focus reveals actions', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('chat AI action bar is visible when focused', async ({ page }) => {
      await gotoMessageActions(page);
      const copy = page.getByRole('button', { name: 'Copy' }).first();
      await expectFocusedVisible(copy);
    });

    test('chat user action bar is visible when focused', async ({ page }) => {
      await gotoMessageActions(page);
      const edit = page.getByRole('button', { name: 'Edit' }).first();
      await expectFocusedVisible(edit);
    });

    test('combat inline image overlay is visible when focused', async ({ page }) => {
      await gotoMessageActions(page);
      const expand = page.getByRole('button', { name: /Expand/ }).first();
      await expectFocusedVisible(expand);
    });

    test('dialogue message actions are visible when focused', async ({ page }) => {
      await gotoDialogue(page);
      const copy = page.getByRole('button', { name: 'Copy' }).first();
      await expectFocusedVisible(copy);
    });

    test('no serious/critical axe violations on the message-actions sandbox', async ({ page }) => {
      await gotoMessageActions(page);
      await expectNoSeriousAxe(page, '[data-testid="message-actions-sandbox"]');
    });

    test('no serious/critical axe violations on the dialogue overlay', async ({ page }) => {
      await gotoDialogue(page);
      await expectNoSeriousAxe(page, '[data-testid="dialogue-overlay"]');
    });
  });

  test.describe('Touch 390×844 — actions reachable without hover', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('chat AI action bar is visible without hover', async ({ page }) => {
      await gotoMessageActions(page);
      const copy = page.getByRole('button', { name: 'Copy' }).first();
      await expectVisibleWithoutHover(copy);
    });

    test('chat user action bar is visible without hover', async ({ page }) => {
      await gotoMessageActions(page);
      const edit = page.getByRole('button', { name: 'Edit' }).first();
      await expectVisibleWithoutHover(edit);
    });

    test('combat inline image overlay is visible without hover', async ({ page }) => {
      await gotoMessageActions(page);
      const expand = page.getByRole('button', { name: /Expand/ }).first();
      await expectVisibleWithoutHover(expand);
    });

    test('dialogue message actions are visible without hover', async ({ page }) => {
      await gotoDialogue(page);
      const copy = page.getByRole('button', { name: 'Copy' }).first();
      await expectVisibleWithoutHover(copy);
    });
  });
});
