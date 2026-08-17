// apps/e2e/tests/client/dialogue_tts_toggle.spec.ts
//
// C-417 AC-5: the dialogue overlay's TTS toggle must have an accessible name
// and be visually consistent with adjacent controls. Runs against the
// dialogue dev sandbox, which mounts the PRODUCTION DialogueOverlay.
//
// Scope: labelling/styling only — TTS behaviour itself is out of scope.
//
// Run: bun moon run e2e:test-client -- --grep dialogue_tts_toggle

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('Dialogue TTS toggle (C-417 AC-5)', () => {
  const gotoDialogue = async (page: import('playwright').Page): Promise<void> => {
    await page.goto('/dev/sandbox/dialogue', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { state: 'visible', timeout: 15_000 });
    await page.getByText('Ah, a traveler!').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(300);
  };

  test('the TTS toggle has an accessible name and a visible label', async ({ page }) => {
    await gotoDialogue(page);

    // Accessible name — the checkbox is exposed as "Toggle text-to-speech".
    const toggle = page.getByRole('checkbox', { name: 'Toggle text-to-speech' });
    await expect(toggle).toBeVisible();
    // The visible "TTS" label sits next to the toggle.
    await expect(page.getByText('TTS')).toBeVisible();
    // It is a small daisyUI toggle, consistent with the overlay's controls.
    await expect(toggle).toHaveClass(/toggle/);
  });

  test('the TTS toggle can be toggled by keyboard users (no aria-hidden state)', async ({
    page,
  }) => {
    await gotoDialogue(page);

    const toggle = page.getByRole('checkbox', { name: 'Toggle text-to-speech' });
    const checkedBefore = await toggle.isChecked();
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).not.toBeChecked({ checked: checkedBefore });
  });

  test('no axe violations on the dialogue overlay (labelled controls)', async ({ page }) => {
    await gotoDialogue(page);

    const results = await new AxeBuilder({ page })
      .include('[data-testid="dialogue-overlay"]')
      .analyze();

    const seriousOrCritical = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    );
    expect(seriousOrCritical).toEqual([]);
  });
});
