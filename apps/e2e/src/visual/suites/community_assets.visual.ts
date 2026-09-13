// apps/e2e/src/visual/suites/community_assets.visual.ts
//
// C-513 AC-4: visual checks for the community browse grid.
//
// The hub is stubbed at the transport boundary, so the suite renders a
// deterministic approved asset: the grid must show its registry tag, its
// provenance/licence attribution and an Import action.
//
// Contract: C-513 End-User Asset Publishing and Community Sharing

import { createHash } from 'node:crypto';
import { CommunityAssetBrowseSchema } from '@aikami/schemas';
import { defineConfig } from '$visual/core/config';

const BYTES = new TextEncoder().encode('community-asset-fixture-bytes');
const SHA = createHash('sha256').update(BYTES).digest('hex');

export default defineConfig({
  id: 'community_assets',
  route: '/studio/community',
  // DOM-only route — it renders `data-testid="community-ready"`.
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'Browse grid with an approved community asset',
      searchParams: {},
      // Capture the community surface itself: the default 256x256 canvas crop
      // is blank on a DOM-only page.
      screenshotSelector: '[data-testid="community-ready"]',
      prompt: `Evaluate the community asset browse page. It should show:
1. A "Community assets" heading and a short explanatory line
2. A "Browse" section with a Refresh button
3. At least one asset row showing its registry tag, its title, a category badge,
   its provenance ("original"), its licence ("CC-BY-4.0"), a file size and an
   "Import" button
4. Clean spacing, readable labels, no overlapping or clipped controls`,
      schema: CommunityAssetBrowseSchema,
      setupHook: async (page) => {
        await page.route('**/api/hub/assets/community**', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              items: [
                {
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
                  deliveryUrl: `https://assets.bearlysing.test/assets/${SHA.slice(0, 2)}/${SHA}.webp`,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
          }),
        );
        // The suite's `setupHook` runs *after* the initial navigation, so the
        // ViewModel's first list call already fired without the stub. Refresh
        // re-issues it through the stub — the production refresh path.
        await page.getByRole('button', { name: 'Refresh' }).click();
        await page.getByTestId('community-row').first().waitFor({ timeout: 20_000 });
      },
    },
  ],
});
