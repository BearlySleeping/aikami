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
import { CommunityPage } from '$pom';

const BYTES = new TextEncoder().encode('community-asset-fixture-bytes');
const SHA = createHash('sha256').update(BYTES).digest('hex');
const DELIVERY_URL = `https://assets.bearlysing.test/assets/${SHA.slice(0, 2)}/${SHA}.webp`;

/**
 * A real 1×1 PNG (base64).
 *
 * AC-10's render assertion needs an image a browser will actually decode —
 * arbitrary bytes with an image content-type give a broken `<img>`, which would
 * make "it paints offline" vacuous.
 */
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PNG_BYTES = Buffer.from(PNG_1X1_BASE64, 'base64');
const PNG_SHA = createHash('sha256').update(PNG_BYTES).digest('hex');
const PNG_DELIVERY_URL = `https://assets.bearlysing.test/assets/${PNG_SHA.slice(0, 2)}/${PNG_SHA}.png`;

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
    const community = new CommunityPage(page);
    await community.goto();

    await expect(community.heading).toBeVisible({
      timeout: 15_000,
    });

    const row = community.firstCommunityRow;
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('music:community:tavern-theme');
    await expect(row).toContainText('1 KB');

    await community.importFirstAsset();
    await expect(community.importMessage).toContainText('Imported "music:community:tavern-theme"', {
      timeout: 15_000,
    });
  });

  test('degraded mode: an unreachable hub shows a message, never a broken page', async ({
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

  test('AC-10: an imported visual still renders after a reload with networking blocked', async ({
    page,
  }) => {
    // One approved visual asset whose bytes are a decodable PNG.
    await stubHub(page, [
      asset({
        slug: 'guild-banner',
        revision: 1,
        title: 'Guild Banner',
        category: 'sprites',
        tag: 'sprites:community:guild-banner',
        sha256: PNG_SHA,
        ext: '.png',
        sizeBytes: PNG_BYTES.byteLength,
        deliveryUrl: PNG_DELIVERY_URL,
      }),
    ]);
    await page.unroute('**/assets.bearlysing.test/assets/**');
    await page.route('**/assets.bearlysing.test/assets/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PNG_BYTES }),
    );

    // ── Import while online ────────────────────────────────────────────────
    await page.goto('/studio/community');
    const row = page.getByTestId('community-row').first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByTestId('community-message')).toContainText('Imported', {
      timeout: 15_000,
    });

    // The import is immediately visible on-device, painted from cached bytes.
    const libraryRow = page.getByTestId('community-library-row').first();
    await expect(libraryRow).toBeVisible({ timeout: 15_000 });
    await expect(libraryRow).toContainText('sprites:community:guild-banner');
    const preview = page.getByTestId('community-library-preview').first();
    await expect(preview).toBeVisible();
    // naturalWidth > 0 means the browser decoded the pixels, not that a URL exists.
    expect(await preview.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0)).toBe(true);

    // ── Reload with the network blocked ────────────────────────────────────
    //
    // `context.setOffline(true)` cannot be used: it also blocks the page
    // navigation itself, so there would be no app to assert against. Blocking
    // every non-app origin is the faithful simulation — the shell is installed,
    // and nothing off-device is reachable.
    const appOrigin = new URL(page.url()).origin;
    const attempted: string[] = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(appOrigin)) {
        if (new URL(url).pathname.startsWith('/api/hub/')) {
          attempted.push(url);
        }
        return route.continue();
      }
      attempted.push(url);
      return route.abort('internetdisconnected');
    });

    await page.reload();

    const reloadedRow = page.getByTestId('community-library-row').first();
    await expect(reloadedRow).toBeVisible({ timeout: 25_000 });
    await expect(reloadedRow).toContainText('sprites:community:guild-banner');

    const reloadedPreview = page.getByTestId('community-library-preview').first();
    await expect(reloadedPreview).toBeVisible();
    // Served from the on-device cache as a blob URL …
    expect(await reloadedPreview.getAttribute('src')).toMatch(/^blob:/);
    // … and it really paints.
    expect(await reloadedPreview.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0)).toBe(
      true,
    );

    // The hub list is the part that cannot work offline — it degrades, and the
    // library above it is what carries the screen.
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });

    // The hub listing is attempted and fails through the offline dev proxy,
    // while the promoted bytes stay entirely on device.
    expect(attempted.some((url) => url.includes('/api/hub/assets/community'))).toBe(true);
    expect(attempted.filter((url) => url === PNG_DELIVERY_URL)).toEqual([]);
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
