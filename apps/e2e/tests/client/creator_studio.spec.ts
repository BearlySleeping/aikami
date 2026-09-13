// apps/e2e/tests/client/creator_studio.spec.ts
//
// C-512 AC-1 / AC-4: the Creator Studio's production journey.
//
// The engine is stubbed at the transport boundary (`/sdapi/v1/sd-models` for
// detection, `/sdapi/v1/txt2img` for generation) so the flow is deterministic
// and needs no live engine. Everything else — registry, cache, library — is the
// real client.
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

import { expect, test } from '@playwright/test';

/** A 1×1 transparent PNG — a valid payload for the stubbed engine. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const stubImageEngine = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.route('**/sdapi/v1/sd-models', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ title: 'sd_xl_base_1.0', model_name: 'sd_xl_base_1.0' }]),
    }),
  );
  await page.route('**/sdapi/v1/txt2img', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ images: [PNG_BASE64], info: '{}' }),
    }),
  );
};

test.describe('Creator Studio (C-512)', () => {
  test('AC-1: generate, save, reload, and see the asset in the library', async ({ page }) => {
    await stubImageEngine(page);
    await page.goto('/studio/assets');

    await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible({
      timeout: 15_000,
    });

    // Pick the prop recipe (the first engine-available image recipe).
    await page.getByLabel('Asset type').selectOption('prop');
    await page.getByLabel('Prompt').fill('Rusty iron gate');
    await page.getByRole('button', { name: 'Generate' }).click();

    // Review step: the resolver tag and engine metadata are shown before saving.
    await expect(page.getByText('Tag: props:rusty-iron-gate')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page.getByText(/Saved "props:rusty-iron-gate"/)).toBeVisible({ timeout: 15_000 });

    // The library lists the entry with its provenance.
    const entry = page.locator('li', { hasText: 'props:rusty-iron-gate' });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('generated:sdcpp');

    // AC-1: it survives a reload.
    await page.reload();
    await expect(page.locator('li', { hasText: 'props:rusty-iron-gate' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('AC-1: a portrait is saved under the NPC resolver tag', async ({ page }) => {
    await stubImageEngine(page);
    await page.goto('/studio/assets');

    await page.getByLabel('Asset type').selectOption('portrait');
    await page.getByLabel('NPC id').fill('merchant');
    await page.getByLabel('Prompt').fill('Mara the merchant, warm smile');
    await page.getByRole('button', { name: 'Generate' }).click();

    await expect(page.getByText('Tag: portraits:merchant-neutral')).toBeVisible({
      timeout: 30_000,
    });
  });

  test('AC-4: rename and delete a local asset from the library', async ({ page }) => {
    await stubImageEngine(page);
    await page.goto('/studio/assets');

    await page.getByLabel('Prompt').fill('A lantern');
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page.getByText('Tag: props:a-lantern')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Save to library' }).click();

    const entry = page.locator('li', { hasText: 'props:a-lantern' });
    await expect(entry).toBeVisible();

    await entry.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('New tag').fill('props:the-lantern');
    await page.getByRole('button', { name: 'Rename', exact: true }).last().click();

    await expect(page.locator('li', { hasText: 'props:the-lantern' })).toBeVisible({
      timeout: 15_000,
    });

    const renamed = page.locator('li', { hasText: 'props:the-lantern' });
    await renamed.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click();

    await expect(page.locator('li', { hasText: 'props:the-lantern' })).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test('AC-5: with no engine reachable, generation is disabled with a reason', async ({ page }) => {
    // Abort every engine probe: neither sd-server nor ComfyUI answers.
    await page.route('**/sdapi/v1/**', (route) => route.abort());
    await page.route('**/system_stats', (route) => route.abort());
    await page.goto('/studio/assets');

    await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByText(/No image engine is reachable/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });
});
