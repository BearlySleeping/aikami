// apps/e2e/src/visual/suites/theme_shared_palette.visual.ts
//
// C-529 AC-1 / AC-8 — the shared-package blast radius.
//
// `aikami_theme.css` and `aikami_ui.css` are imported by BOTH the client and the
// hub, and the generated stylesheet is now a build artifact of the token source.
// This suite runs on the HUB server (`app: 'hub'`) so a generated-CSS change that
// broke the unrelated SSR app would be caught visually, not just by a build.
//
// Contract: C-529 AC-1, AC-8.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const SharedPaletteSchema = Type.Object({
  score: Type.Number({ minimum: 0, maximum: 100, description: '0-100 visual quality score' }),
  unreadableText: Type.Boolean({ description: 'Any essential text is unreadable' }),
  overlappingControls: Type.Boolean({ description: 'Essential controls overlap each other' }),
  missingCriticalAction: Type.Boolean({
    description: 'A required navigation or search control is missing',
  }),
  unstyledSurface: Type.Boolean({
    description: 'The page renders without the shared Aikami surfaces/typography (unstyled HTML)',
  }),
  issues: Type.Array(Type.String(), { description: 'Concrete defects found' }),
});

export default defineConfig({
  id: 'theme-shared-palette',
  app: 'hub',
  // `hub_ready` resolves on the catalog grid marker, so the case runs on a
  // catalog route — the same one the C-396 hub suite uses.
  route: '/catalog/lpc',
  waitCondition: 'hub_ready',
  cases: [
    {
      name: 'hub-catalog-shared-palette',
      prompt:
        'This is the Aikami Hub (server-rendered) catalog page, which imports the same GENERATED palette file as the game client. Expected: a grid of asset tiles using the shared Aikami surfaces and typography — readable body text on a themed surface, visible accent colour on interactive elements, consistent corner radii, and a visible search/filter control. Flag unstyledSurface when the page looks like raw unstyled HTML (default serif body text, no surface colours, no accent colours).',
      schema: SharedPaletteSchema,
      screenshotSelector: 'body',
      requiredFalseFields: [
        'missingCriticalAction',
        'overlappingControls',
        'unreadableText',
        'unstyledSurface',
      ],
      minScore: 85,
    },
  ],
});
