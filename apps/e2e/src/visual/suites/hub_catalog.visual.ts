// apps/e2e/src/visual/suites/hub_catalog.visual.ts
// Hub catalog category grid — AI visual validation (C-396 AC-1 visual).
//
// Route: /catalog/lpc on the HUB dev server (SSR app on its own port).
// Asserts: a grid of single-frame sprite previews (or the explicit preview
// placeholder for pre-republish entries — NEVER the raw multi-frame sheet),
// each tile shows a name and a license badge, the filter control is present,
// and there is no layout overflow.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const HubCatalogSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual correctness score' }),
  gridVisible: Type.Boolean({ description: 'A grid of asset tiles is visible' }),
  licenseBadges: Type.Boolean({ description: 'Tiles show license badges' }),
  filterControl: Type.Boolean({ description: 'A search/filter input is present' }),
  singleFramePreviews: Type.Boolean({
    description: 'Preview images are single frames/placeholders, NOT raw multi-frame sprite sheets',
  }),
  noOverflow: Type.Boolean({ description: 'No horizontal overflow or broken layout' }),
});

const HUB_CATALOG_PROMPT = [
  'This is the Aikami Hub catalog category page (LPC Characters) rendered server-side.',
  '',
  'EVALUATE:',
  '- Is a grid of asset tiles visible, each with a display name like "5oclock_shadow · backslash"?',
  '- Does each tile show a license badge (e.g. "CC-BY-SA 3.0")?',
  '- Is a search/filter input present near the top?',
  '- Are the previews single sprite frames or placeholder icons — NOT large multi-frame sprite sheets?',
  '- Is the layout clean with no horizontal overflow or cut-off elements?',
  '',
  'Score: 90+ for a clean grid of named, licensed single-frame tiles; 70-89 for minor issues; 0-69 for broken/missing layout.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

export default defineConfig({
  id: 'hub_catalog',
  app: 'hub',
  route: '/catalog/lpc',
  waitCondition: 'hub_ready',
  cases: [
    {
      name: 'lpc_category_grid',
      searchParams: {},
      prompt: HUB_CATALOG_PROMPT,
      schema: HubCatalogSchema,
      screenshotSelector: '[data-testid="catalog-category"]',
      requiredTrueFields: [
        'gridVisible',
        'licenseBadges',
        'filterControl',
        'singleFramePreviews',
        'noOverflow',
      ],
    },
  ],
});
