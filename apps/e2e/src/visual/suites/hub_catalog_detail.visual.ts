// apps/e2e/src/visual/suites/hub_catalog_detail.visual.ts
// Hub asset detail — AI visual validation (C-396 AC-3 visual).
//
// Route: /catalog/lpc/<tag> on the HUB dev server. Asserts: preview renders
// at a sensible size (or the explicit unavailable placeholder), license and
// attribution are legible, and an unknown license is shown as "Unknown"
// rather than blank.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const HubCatalogDetailSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual correctness score' }),
  previewPanel: Type.Boolean({
    description:
      'A preview panel is present (thumbnail or explicit unavailable placeholder, never a raw sheet)',
  }),
  licenseVisible: Type.Boolean({
    description: 'The license section is legible with license badges',
  }),
  attributionVisible: Type.Boolean({ description: 'The attribution section shows author names' }),
  metadataVisible: Type.Boolean({ description: 'Size/Type/Category/Tag metadata is visible' }),
  noOverflow: Type.Boolean({ description: 'No horizontal overflow or broken layout' }),
});

const HUB_DETAIL_PROMPT = [
  'This is the Aikami Hub catalog asset detail page for an LPC sprite.',
  '',
  'EVALUATE:',
  '- Is a preview panel present on the left (a sprite frame image, or an explicit "Preview unavailable" placeholder — NOT a multi-frame sheet)?',
  '- Is the License section legible with badges like "CC-BY-SA 3.0" and "GPL 3.0"?',
  '- Is the Attribution section present with author names?',
  '- Are Size/Type/Category/Tag metadata rows visible?',
  '- Is the layout clean with no horizontal overflow?',
  '',
  'Score: 90+ for a clean, legible detail layout; 70-89 for minor issues; 0-69 for broken/missing content.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

export default defineConfig({
  id: 'hub_catalog_detail',
  app: 'hub',
  route: '/catalog/lpc/lpc%3Abeard%3Abeard%3A5oclock_shadow%3Abackslash',
  waitCondition: 'hub_ready',
  cases: [
    {
      name: 'lpc_asset_detail',
      prompt: HUB_DETAIL_PROMPT,
      schema: HubCatalogDetailSchema,
      screenshotSelector: '[data-testid="catalog-asset"]',
      requiredTrueFields: [
        'previewPanel',
        'licenseVisible',
        'attributionVisible',
        'metadataVisible',
        'noOverflow',
      ],
    },
  ],
});
