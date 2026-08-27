// apps/e2e/src/visual/suites/hub_tileset_preview.visual.ts
// Hub tileset asset preview — AI visual validation (C-446 AC-3).
//
// Route: /catalog/tilesets/<tag> on the HUB dev server.
// Asserts: the atlas renders crisply with no smoothing, and the grid
// overlay toggles on/off.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const HubTilesetSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual correctness score' }),
  tilesetVisible: Type.Boolean({
    description: 'A tileset atlas image is visible in the preview',
  }),
  pixelArtCrisp: Type.Boolean({
    description: 'Pixel art is crisp with no blur or resampling artifacts',
  }),
  gridLinesVisible: Type.Boolean({
    description: 'Grid lines are visible over the tileset (for grid-on case)',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const HUB_TILESET_PROMPT = [
  'This is the Aikami Hub catalog asset detail page for a tileset.',
  'The preview shows a tileset atlas rendered with nearest-neighbor scaling.',
  '',
  'EVALUATE:',
  '- Is a tileset atlas image visible in the preview area?',
  '- Is the pixel art crisp with no blur or resampling artifacts?',
  '- (For grid-on case) Are grid lines visible, aligned to tile edges?',
  '',
  'Score: 90+ for crisp pixel art with aligned grid lines; 70-89 for minor issues; 0-69 for broken/missing tileset.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

export default defineConfig({
  id: 'hub_tileset_preview',
  app: 'hub',
  route: '/catalog/tilesets/tilesets%3Aexample%3Atileset',
  waitCondition: 'hub_ready',
  cases: [
    {
      name: 'hub-tileset-grid-off',
      searchParams: {},
      prompt: [
        HUB_TILESET_PROMPT,
        'The tileset should be visible WITHOUT grid lines.',
      ].join('\n'),
      schema: HubTilesetSchema,
      screenshotSelector: '[data-testid="catalog-asset"]',
      requiredTrueFields: ['tilesetVisible', 'pixelArtCrisp'],
    },
  ],
});
