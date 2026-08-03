// apps/e2e/tests/client/offline_assets.spec.ts
//
// C-373 AC-2/AC-3: Offline asset resolution through the hybrid cache.
//
// Flow:
//   1. Online boot — the AssetManager fetches, hash-verifies, and caches
//      manifest binaries (sprites/LPC/audio) into OPFS.
//   2. Install a route that ABORTS every manifest-category binary request
//      (only manifest.json + asset_hashes.json + engine maps stay allowed).
//   3. Reload — the SPA document re-serves, the registry re-seeds
//      idempotently, and previously cached binaries must resolve from OPFS
//      as blob: URLs with ZERO network traffic.
//
// Maps (`/game-data/maps/**`) are engine content-pack assets, not manifest
// entries — out of C-373 scope, so they remain online-routable.

import { expect, test } from '@playwright/test';

test.describe('Offline Assets (C-373)', () => {
  test('AC-2: cached assets render after an offline reload with zero binary requests', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') {
        return;
      }
      const text = msg.text();
      // Expected noise in the offline scenario (filtered, not failures):
      // - "Failed to load resource" — browser-generated message for network
      //   requests that fail while the network is cut.
      // - "[AudioService] transitionToBgm:failed" — the legacy hardcoded
      //   /assets/audio/ BGM path (C-203-era, outside the C-373 manifest-cache
      //   scope) degrades gracefully offline.
      if (text.includes('Failed to load resource') || text.includes('transitionToBgm:failed')) {
        return;
      }
      consoleErrors.push(text);
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(String(err));
    });

    /** Boot progress bar rendered by the boot overlay while loading. */
    const loadingBar = page.locator('progress.progress-primary');

    /**
     * Waits for the boot overlay to appear and then detach — the loading
     * state is gone once the game view mounts (deterministic readiness, no
     * fixed delay).
     */
    const waitForBootComplete = async (): Promise<void> => {
      await expect(loadingBar).toBeVisible({ timeout: 60000 });
      await expect(loadingBar).toBeHidden({ timeout: 60000 });
    };

    /**
     * Waits until the OPFS asset cache stops growing. The engine resolves
     * manifest binaries through the AssetManager shortly after boot — the
     * cache must be warm (and stable) before the network is cut, or the
     * offline reload has nothing to serve.
     */
    const waitForCacheWarm = async (): Promise<void> => {
      let lastCount = -1;
      let stableChecks = 0;
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const count = await page.evaluate(async () => {
          try {
            const root = await navigator.storage.getDirectory();
            const dir = await root.getDirectoryHandle('aikami-assets', { create: false });
            let n = 0;
            for await (const [name] of dir.entries()) {
              if (name) {
                n += 1;
              }
            }
            return n;
          } catch {
            return 0;
          }
        });
        if (count === lastCount && count > 0) {
          stableChecks += 1;
          if (stableChecks >= 3) {
            return; // stable for ~1.5s — warm-up settled
          }
        } else {
          stableChecks = 0;
          lastCount = count;
        }
        await page.waitForTimeout(500);
      }
    };

    // ── 1. Online boot — load + cache assets ───────────────────────────
    await page.goto('/game');

    const canvas = page.locator('#game-canvas-container canvas');
    await expect(canvas).toBeAttached({ timeout: 60000 });

    // Let the engine resolve sprite/LPC/audio loads through the AssetManager
    // so OPFS is warm before we cut the network.
    await waitForBootComplete();
    await waitForCacheWarm();

    // ── 2. Cut the network for manifest binaries ───────────────────────
    const blockedBinaryRequests: string[] = [];
    const failedGameDataRequests: string[] = [];

    // Engine content that loads via RAW urls (never through the manifest
    // resolver) stays routable: maps + tilesets (C-373 scope boundary).
    const isEngineRawAsset = (url: string): boolean =>
      url.includes('/maps/') || url.includes('/tilesets/');

    await page.route('**/game-data/**', async (route) => {
      const url = route.request().url();
      const isManifest = url.includes('manifest.json');
      const isSidecar = url.includes('asset_hashes.json');
      if (isManifest || isSidecar || isEngineRawAsset(url)) {
        await route.continue();
        return;
      }
      blockedBinaryRequests.push(url);
      await route.abort('failed');
    });

    page.on('requestfailed', (request) => {
      if (request.url().includes('/game-data/')) {
        failedGameDataRequests.push(request.url());
      }
    });

    // ── 3. Offline reload ──────────────────────────────────────────────
    await page.reload();

    // The game must boot and render with the network cut for binaries.
    const canvasAfterReload = page.locator('#game-canvas-container canvas');
    await expect(canvasAfterReload).toBeAttached({ timeout: 60000 });
    await expect(canvasAfterReload).toBeVisible({ timeout: 10000 });

    // Wait for the boot overlay to leave the loading state — deterministic
    // settle, no fixed delay.
    await waitForBootComplete();

    // ── Assertions ─────────────────────────────────────────────────────
    // No uncaught JS exceptions — the boot pipeline degrades gracefully.
    expect(pageErrors).toHaveLength(0);

    // No script-level console errors — the offline path must not surface any.
    expect(consoleErrors).toHaveLength(0);

    // Everything the boot needed came from cache: zero manifest-category
    // binary requests should have hit the network while offline.
    expect(blockedBinaryRequests).toHaveLength(0);

    // Boot pipeline completed — the loading state is confirmed absent.
    const loadingGone = await loadingBar.count();
    expect(loadingGone).toBe(0);
  });
});
