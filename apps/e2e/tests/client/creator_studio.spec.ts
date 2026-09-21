// apps/e2e/tests/client/creator_studio.spec.ts
//
// C-512 AC-1 / AC-4 / AC-5: the Creator Studio's production journey.
//
// The engine is stubbed at the transport boundary (the C-510 sd-server
// protocol — see `$utils/image_engine_stub`) so the flow is deterministic and
// needs no live engine. Everything else — runtime config, registry, cache,
// library — is the real client.
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

import { expect, type Locator, type Page, test } from '@playwright/test';
import { stubImageEngine, stubNoImageEngine } from '$utils/image_engine_stub';

/** Opens the studio from the start menu — the contract's documented entry. */
const openStudioFromStartMenu = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.locator('summary', { hasText: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Creator Studio' }).click();
  await expect(page).toHaveURL(/\/studio\/assets/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible({
    timeout: 15_000,
  });
};

/**
 * One row of the "My library" list.
 *
 * Scoped to the library section on purpose: the NPC expression-pack panel
 * renders its own `<li>` rows carrying the same tag text, so an unscoped
 * `page.locator('li', { hasText: tag })` matches two elements and fails
 * Playwright strict mode. (Surfaced by C-513 AC-13's first real execution of
 * this spec — it had never been run.)
 */
const libraryEntry = (page: Page, tag: string): Locator =>
  page
    .locator('section', { has: page.getByRole('heading', { name: 'My library' }) })
    .locator('li', { hasText: tag });

test.describe('Creator Studio (C-512)', () => {
  test('AC-1: the start-menu journey generates, saves, and survives a reload', async ({ page }) => {
    await stubImageEngine(page);
    await openStudioFromStartMenu(page);

    // Pick the prop recipe and write a prompt.
    await page.locator('#studio-recipe').selectOption('prop');
    await page.locator('#studio-prompt').fill('Rusty iron gate');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    // Review step: the resolver tag and engine metadata are shown before saving.
    await expect(page.getByText('Tag: props:rusty-iron-gate')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page.getByText(/Saved "props:rusty-iron-gate"/)).toBeVisible({ timeout: 15_000 });

    // The library lists the entry with its provenance.
    const entry = libraryEntry(page, 'props:rusty-iron-gate');
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('generated:sdcpp');

    // AC-1: it survives a reload of the production route. The studio must open
    // the registry itself — a deep link never runs the game boot pipeline.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(libraryEntry(page, 'props:rusty-iron-gate')).toBeVisible({
      timeout: 20_000,
    });
    // Every image recipe must still be selectable (engine detected after the
    // runtime config loaded, not before it).
    await expect(page.locator('#studio-recipe option[value="prop"]')).toBeEnabled();
    await expect(page.locator('p', { hasText: /No image engine is reachable/ })).toHaveCount(0);
  });

  test('AC-1: a portrait is saved under the NPC resolver tag', async ({ page }) => {
    await stubImageEngine(page);
    await openStudioFromStartMenu(page);

    await page.locator('#studio-recipe').selectOption('portrait');
    await page.locator('#studio-npc').fill('merchant');
    await page.locator('#studio-prompt').fill('Mara the merchant, warm smile');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    await expect(page.getByText('Tag: portraits:merchant-neutral')).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page.getByText(/Saved "portraits:merchant-neutral"/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(libraryEntry(page, 'portraits:merchant-neutral')).toBeVisible();
  });

  test('AC-4: rename and delete a local asset from the library', async ({ page }) => {
    await stubImageEngine(page);
    await openStudioFromStartMenu(page);

    await page.locator('#studio-prompt').fill('A lantern');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText('Tag: props:a-lantern')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page.getByText(/Saved "props:a-lantern"/)).toBeVisible({ timeout: 15_000 });

    const entry = libraryEntry(page, 'props:a-lantern');
    await expect(entry).toBeVisible();

    await entry.getByRole('button', { name: 'Rename' }).click();
    await page.locator('#studio-rename').fill('props:the-lantern');
    await page.getByRole('button', { name: 'Rename', exact: true }).last().click();

    await expect(libraryEntry(page, 'props:the-lantern')).toBeVisible({
      timeout: 15_000,
    });

    const renamed = libraryEntry(page, 'props:the-lantern');
    await renamed.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click();

    await expect(libraryEntry(page, 'props:the-lantern')).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test('AC-1 (client): publishing a library asset reserves then uploads the raw bytes', async ({
    page,
  }) => {
    await stubImageEngine(page);
    await openStudioFromStartMenu(page);

    await page.locator('#studio-prompt').fill('A brass lantern');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText('Tag: props:a-brass-lantern')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page.getByText(/Saved "props:a-brass-lantern"/)).toBeVisible({ timeout: 15_000 });

    // The hub is stubbed at the transport boundary: reserve (JSON) then upload
    // (raw octet-stream). Capture both so the two-step contract is asserted.
    let reserveBody: Record<string, unknown> | undefined;
    let uploadBytes = 0;
    await page.route('**/api/hub/assets/community', async (route) => {
      reserveBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          slug: 'a-brass-lantern',
          revision: 1,
          uploadPath: '/assets/community/a-brass-lantern/upload',
          stagingState: 'reserved',
        }),
      });
    });
    await page.route('**/api/hub/assets/community/*/upload', async (route) => {
      uploadBytes = route.request().postDataBuffer()?.byteLength ?? 0;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          slug: 'a-brass-lantern',
          revision: 1,
          sha256: 'a'.repeat(64),
          moderationState: 'pending',
          deliveryUrl: '/api/assets/community/a-brass-lantern/raw',
        }),
      });
    });

    const entry = libraryEntry(page, 'props:a-brass-lantern');
    await entry.getByRole('button', { name: 'Publish' }).click();

    await expect(page.getByTestId('studio-publish')).toContainText('pending review', {
      timeout: 15_000,
    });
    expect(reserveBody?.tag).toBe('props:a-brass-lantern');
    expect(reserveBody?.sizeBytes).toBe(uploadBytes);
    // The declared size is a real byte count, and the raw upload carried them.
    expect(uploadBytes).toBeGreaterThan(0);
  });

  test('AC-12: an audio recipe is listed, gated, and states why', async ({ page }) => {
    await stubImageEngine(page);
    await page.goto('/studio/assets');
    await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible({
      timeout: 15_000,
    });

    // The audio recipes are resolved through the modality-keyed engine registry
    // (C-521 registers the engine): they are listed, not hidden.
    for (const recipeId of ['music', 'sfx', 'ambient']) {
      await expect(page.locator(`#studio-recipe option[value="${recipeId}"]`)).toHaveCount(1);
    }

    // The image engine is stubbed, so the audio modality is the only gated one —
    // and it says why instead of going silently grey.
    const unavailable = page.getByTestId('studio-unavailable');
    await expect(unavailable).toBeVisible({ timeout: 15_000 });
    await expect(unavailable).toContainText(/No audio generation engine is registered/);
    await expect(page.locator('#studio-recipe option[value="music"]')).toBeDisabled();
  });

  // The audio-audition half of AC-12/AC-10 is conditional on C-521 (the audio
  // engine + finishing path). Recorded as skipped-with-reason, per the contract.
  test.skip('AC-12/AC-10: an audio asset auditions and survives a reload (needs C-521)', async () => {
    // Enable when C-521 lands: register an audio engine adapter in
    // studio_composition.ts, then generate → save → reload → play.
  });

  test('AC-5: with no engine reachable, generation is disabled with a reason', async ({ page }) => {
    await stubNoImageEngine(page);
    await page.goto('/studio/assets');

    await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible({
      timeout: 15_000,
    });

    // Scoped to the disabled-reason paragraph: C-513 AC-12's per-recipe
    // unavailable list carries the same sentence for every image recipe, so an
    // unscoped text locator would match several elements (strict mode).
    await expect(page.locator('p', { hasText: /No image engine is reachable/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  });
});
