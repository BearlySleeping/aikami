// apps/e2e/src/visual/suites/hub_map_preview.visual.ts
// Hub map asset preview — AI visual validation (C-446 AC-4).
//
// Route: /catalog/maps/<tag> on the HUB dev server.
// Asserts: the tilemap renders with layers in order and no missing tiles.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const HubMapSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual correctness score' }),
  mapVisible: Type.Boolean({
    description: 'A tilemap is visible in the preview area',
  }),
  noMissingTiles: Type.Boolean({
    description: 'No untextured magenta/checkerboard placeholders or missing tiles',
  }),
  noTileSeams: Type.Boolean({
    description: 'No misaligned tile seams or gaps between tiles',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const HUB_MAP_PROMPT = [
  'This is the Aikami Hub catalog asset detail page for a map.',
  'The preview shows a rendered tilemap.',
  '',
  'EVALUATE:',
  '- Is a tilemap clearly visible in the preview area?',
  '- Are there any untextured magenta/checkerboard placeholders or missing tiles?',
  '- Are there any misaligned tile seams or gaps between tiles?',
  '',
  'Score: 90+ for a coherent tilemap with no gaps or missing textures; 70-89 for minor issues; 0-69 for broken/missing map.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

export default defineConfig({
  id: 'hub_map_preview',
  app: 'hub',
  route: '/catalog/maps',
  waitCondition: 'hub_ready',
  cases: [
    {
      name: 'hub-map-render',
      searchParams: {},
      prompt: HUB_MAP_PROMPT,
      schema: HubMapSchema,
      screenshotSelector: '[data-testid="catalog-asset"]',
      requiredTrueFields: ['mapVisible', 'noMissingTiles', 'noTileSeams'],
    },
  ],
});
