// apps/e2e/src/visual/suites/hub_lpc_preview.visual.ts
// Hub LPC asset preview — AI visual validation (C-446 AC-2).
//
// Route: /catalog/lpc/<tag> on the HUB dev server.
// Asserts: a composed LPC character renders in the preview island,
// layers are correctly stacked, and direction controls work.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const HubLpcPreviewSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual correctness score' }),
  characterVisible: Type.Boolean({
    description: 'A pixel-art LPC character sprite is visible in the preview',
  }),
  layersComposited: Type.Boolean({
    description: 'Multiple layers (body, head, hair, etc.) are composited correctly',
  }),
  facingDirection: Type.String({
    description: 'The direction the character is facing: down, up, left, or right',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const HUB_LPC_PROMPT = [
  'This is the Aikami Hub catalog asset detail page for an LPC character.',
  'The preview island shows a composed LPC character rendered by PixiJS.',
  '',
  'EVALUATE:',
  '- Is a pixel-art LPC character sprite clearly visible in the preview area?',
  '- Are the character layers composited correctly (body, head, hair, etc.)?',
  '- What direction is the character facing?',
  '- Is the character well-centered in the preview frame?',
  '',
  'Score: 90+ for a clear, well-composited character; 70-89 for minor issues; 0-69 for broken/missing character.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

export default defineConfig({
  id: 'hub_lpc_preview',
  app: 'hub',
  route: '/catalog/lpc/lpc%3Abeard%3Abeard%3A5oclock_shadow%3Abackslash',
  waitCondition: 'hub_ready',
  cases: [
    {
      name: 'hub-lpc-down',
      searchParams: {},
      prompt: [
        HUB_LPC_PROMPT,
        'The character should be facing DOWN (toward the viewer).',
      ].join('\n'),
      schema: HubLpcPreviewSchema,
      screenshotSelector: '[data-testid="catalog-asset"]',
      requiredTrueFields: ['characterVisible', 'layersComposited'],
    },
    {
      name: 'hub-lpc-up',
      searchParams: { dir: '0' },
      prompt: [
        HUB_LPC_PROMPT,
        'The character should be facing UP (away from the viewer).',
        'Layer ordering is most likely to break in this direction.',
      ].join('\n'),
      schema: HubLpcPreviewSchema,
      screenshotSelector: '[data-testid="catalog-asset"]',
      requiredTrueFields: ['characterVisible', 'layersComposited'],
    },
    {
      name: 'hub-lpc-left',
      searchParams: { dir: '3' },
      prompt: [
        HUB_LPC_PROMPT,
        'The character should be facing LEFT (profile view).',
      ].join('\n'),
      schema: HubLpcPreviewSchema,
      screenshotSelector: '[data-testid="catalog-asset"]',
      requiredTrueFields: ['characterVisible', 'layersComposited'],
    },
  ],
});
