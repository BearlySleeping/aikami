// apps/e2e/tests/client/community_asset_import.spec.ts
//
// C-513 AC-4 / AC-10 / AC-11: the community browse + import production path.
//
// The hub is stubbed at the transport boundary (`/api/hub/*`, which the client
// reaches via the Vite dev proxy in emulator mode) so the flow is deterministic
// and needs no live hub or D1. Everything else — the registry, the content-hash
// cache, the ViewModel — is the real client.
//
// Contract: C-513 End-User Asset Publishing and Community Sharing

import { createHash } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';

const BYTES = new TextEncoder().encode('community-asset-fixture-bytes');
const SHA = createHash('sha256').update(BYTES).digest('hex');
const DELIVERY_URL = `https://assets.bearlysing.test/assets/${SHA.slice(0, 2)}/${SHA}.webp`;

const asset = (overrides: Record<string, unknown> = {}) => ({
  slug: 'tavern-theme',
  revision: 1,
  title: 'Tavern Theme',
  category: 'music',
  tag: 'music:community:tavern-theme',
  sha256: SHA,
  ext: '.webp',
  sizeBytes: BYTES.byteLength,
  provenance: { source: 'original', license: 'CC-BY-4.0' },
  license: 'CC-BY-4.0',
  moderationState: 'approved',
  isOwner: false,
  promoted: true,
  deliveryUrl: DELIVERY_URL,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

/** Installs a hub whose community listing/bytes are served from `items`. */
const stubHub = async (page: Page, items: readonly unknown[]): Promise<void> => {
  // The listing.
  await page.route('**/api/hub/assets/community**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items }),
    }),
  );
  // The promoted bytes (public, content-addressed).
  await page.route('**/assets.bearlysing.test/assets/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.from(BYTES) }),
  );
};

/** Blocks every hub call — the hub-unavailable degraded state. */
const blockHub = async (page: Page): Promise<void> => {
  await page.route('**/api/hub/**', (route) => route.abort());
};

test.describe('Community assets (C-513)', () => {
  test('AC-4: browse lists approved assets and import writes them locally', async ({ page }) => {
    await stubHub(page, [asset()]);
    await page.goto('/studio/community');

    await expect(page.getByRole('heading', { name: 'Community assets' })).toBeVisible({
      timeout: 15_000,
    });

    const row = page.getByTestId('community-row').first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('music:community:tavern-theme');
    await expect(row).toContainText('1 KB');

    await row.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByTestId('community-message')).toContainText(
      'Imported "music:community:tavern-theme"',
      { timeout: 15_000 },
    );
  });

  test('AC-10: the hub being unavailable degrades to a message, never a broken page', async ({
    page,
  }) => {
    await blockHub(page);
    await page.goto('/studio/community');

    await expect(page.getByRole('heading', { name: 'Community assets' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
    // The local side is untouched: the route renders and stays interactive.
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  test('AC-11: a tag collision is surfaced for an explicit decision', async ({ page }) => {
    // First import succeeds …
    await stubHub(page, [asset()]);
    await page.goto('/studio/community');
    const row = page.getByTestId('community-row').first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByTestId('community-message')).toContainText('Imported', {
      timeout: 15_000,
    });

    // … then the same tag arrives with different bytes.
    const otherBytes = new TextEncoder().encode('a-different-revision-of-the-tune');
    const otherSha = createHash('sha256').update(otherBytes).digest('hex');
    await page.unroute('**/api/hub/assets/community**');
    await page.unroute('**/assets.bearlysing.test/assets/**');
    await stubHub(page, [asset({ sha256: otherSha, sizeBytes: otherBytes.byteLength })]);
    await page.route('**/assets.bearlysing.test/assets/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.from(otherBytes) }),
    );

    await page.getByRole('button', { name: 'Refresh' }).click();
    const refreshed = page.getByTestId('community-row').first();
    await expect(refreshed).toBeVisible({ timeout: 15_000 });
    await refreshed.getByRole('button', { name: 'Import' }).click();

    const collision = page.getByTestId('community-collision');
    await expect(collision).toBeVisible({ timeout: 15_000 });
    await expect(collision).toContainText('Import as a new version');

    // The explicit decision is what resolves it.
    await collision.getByRole('button', { name: 'Import as a new version' }).click();
    await expect(page.getByTestId('community-message')).toContainText('as a new version', {
      timeout: 15_000,
    });
  });
});
