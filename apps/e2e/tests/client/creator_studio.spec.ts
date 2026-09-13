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

import { expect, test } from '@playwright/test';
import { stubImageEngine, stubNoImageEngine } from '$utils/image_engine_stub';

/** Opens the studio from the start menu — the contract's documented entry. */
const openStudioFromStartMenu = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/');
  await page.locator('summary', { hasText: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Creator Studio' }).click();
  await expect(page).toHaveURL(/\/studio\/assets/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible({
    timeout: 15_000,
  });
};

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
    const entry = page.locator('li', { hasText: 'props:rusty-iron-gate' });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('generated:sdcpp');

    // AC-1: it survives a reload of the production route. The studio must open
    // the registry itself — a deep link never runs the game boot pipeline.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('li', { hasText: 'props:rusty-iron-gate' })).toBeVisible({
      timeout: 20_000,
    });
    // Every image recipe must still be selectable (engine detected after the
    // runtime config loaded, not before it).
    await expect(page.locator('#studio-recipe option[value="prop"]')).toBeEnabled();
    await expect(page.getByText(/No image engine is reachable/)).toHaveCount(0);
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
    await expect(page.locator('li', { hasText: 'portraits:merchant-neutral' })).toBeVisible();
  });

  test('AC-4: rename and delete a local asset from the library', async ({ page }) => {
    await stubImageEngine(page);
    await openStudioFromStartMenu(page);

    await page.locator('#studio-prompt').fill('A lantern');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText('Tag: props:a-lantern')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Save to library' }).click();
    await expect(page.getByText(/Saved "props:a-lantern"/)).toBeVisible({ timeout: 15_000 });

    const entry = page.locator('li', { hasText: 'props:a-lantern' });
    await expect(entry).toBeVisible();

    await entry.getByRole('button', { name: 'Rename' }).click();
    await page.locator('#studio-rename').fill('props:the-lantern');
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
    await stubNoImageEngine(page);
    await page.goto('/studio/assets');

    await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByText(/No image engine is reachable/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  });
});
