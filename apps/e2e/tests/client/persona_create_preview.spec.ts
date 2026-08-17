// apps/e2e/tests/client/persona_create_preview.spec.ts
//
// C-417 AC-6: the AI-companion "Generate Character" flow previews the
// character's LPC appearance INLINE in the same view — no /dev/lpc tab.
//
// The /dev/character sandbox mounts the PRODUCTION PersonaCreateView with a
// dev ViewModel whose "Mock Generate" reaches the TWEAK phase deterministically
// (no LLM/ComfyUI dependency). The inline preview is the production
// LpcPreviewView component wired via the same recipe-sync shape onboarding
// uses.
//
// Run: bun moon run e2e:test-client -- --grep persona_create_preview

import { expect, test } from '@playwright/test';

test.describe('Persona create inline LPC preview (C-417 AC-6)', () => {
  test('TWEAK phase shows the inline LPC preview, never a /dev/lpc tab link', async ({ page }) => {
    // Track any attempt to open a new tab / window during the flow.
    let popupUrl: string | undefined;
    page.on('popup', (popup) => {
      popupUrl = popup.url();
    });

    await page.goto('/dev/character', { waitUntil: 'domcontentloaded' });
    // CHAT phase renders first.
    await page.getByText('Persona Creation').waitFor({ state: 'visible', timeout: 15_000 });

    // Use the dev sandbox's deterministic mock generation.
    await page.getByRole('button', { name: 'Mock Generate' }).click();

    // TWEAK phase — the persona details card renders.
    await page.getByText('Persona Details').waitFor({ state: 'visible', timeout: 15_000 });

    // The inline LPC preview panel is present (production LpcPreviewView).
    const previewLabel = page.getByText('LPC Sprite');
    await previewLabel.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(page.locator('#lpc-preview-canvas')).toBeAttached();

    // No /dev/lpc link exists in the view — nothing can open the dev tab.
    await expect(page.locator('a[href*="/dev/lpc"]')).toHaveCount(0);

    // No new tab/window was opened during the whole flow.
    expect(popupUrl).toBeUndefined();
  });

  test('the preview canvas renders after generation completes', async ({ page }) => {
    await page.goto('/dev/character', { waitUntil: 'domcontentloaded' });
    await page.getByText('Persona Creation').waitFor({ state: 'visible', timeout: 15_000 });

    await page.getByRole('button', { name: 'Mock Generate' }).click();
    await page.getByText('Persona Details').waitFor({ state: 'visible', timeout: 15_000 });

    // The PixiJS preview reports ready once its canvas initialised.
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__PIXI_LPC_PREVIEW_LOADED__ === true,
      undefined,
      { timeout: 15_000 },
    );

    // The canvas is the inline preview inside the avatar card.
    const canvas = page.locator('#lpc-preview-canvas');
    await expect(canvas).toBeVisible();
    expect(await canvas.count()).toBeGreaterThan(0);
  });
});
