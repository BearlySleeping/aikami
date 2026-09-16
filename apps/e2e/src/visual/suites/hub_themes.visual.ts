// apps/e2e/src/visual/suites/hub_themes.visual.ts
// Hub theme surfaces — AI visual validation (C-530 AC-4).
//
// Routes: /community/themes (listing) and /community/themes/[slug] (detail,
// with the scoped fixture preview).
//
// Asserts the two flags AC-4 actually turns on, gated with `requiredFalseFields`
// (the C-529 precedent):
//   skinnedHubChrome       — Hub navigation/auth/moderation chrome picked up the
//                            previewed theme. The preview is scoped to
//                            [data-theme-preview]; if the chrome changed, the
//                            scope leaked.
//   loadedExternalResource — an external or private resource was requested.
//
// Post-install *game* appearance is already covered by the C-529 suite
// `theme_runtime.visual.ts` (explore-default, inventory-detail, combat-actions,
// settings-error, compact, large-text, high-contrast, reduced-motion). This
// suite deliberately does not duplicate those game contexts.
//
// 🔴 Every case sets `screenshotSelector`: without it the runner falls back to a
// 256x256 canvas crop that contains none of the theme chrome.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const HubThemesSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual correctness score' }),
  unreadableText: Type.Boolean({ description: 'Some text is unreadable (contrast or clipping)' }),
  overlappingControls: Type.Boolean({ description: 'Controls overlap each other' }),
  missingCriticalAction: Type.Boolean({
    description: 'A critical action (install/download/back/variant switch) is missing',
  }),
  issues: Type.Array(Type.String(), { maxItems: 12 }),
  skinnedHubChrome: Type.Boolean({
    description:
      'Hub navigation/auth/moderation chrome picked up the previewed theme instead of keeping the Hub look',
  }),
  loadedExternalResource: Type.Boolean({
    description: 'An external or private resource was requested to render this page',
  }),
});

const THEME_CHROME_PROMPT = [
  'This is an Aikami Hub theme page rendered server-side (a community theme listing or one theme version detail).',
  '',
  'EVALUATE:',
  '- Is the text hierarchy readable, with no clipped or low-contrast body text?',
  '- Are the essential controls visible and non-overlapping: the theme name, the variant switcher, the',
  '  preview-context switcher, the download/install action and the breadcrumb back to the listing?',
  '- Does the surrounding Hub chrome (top navigation, account controls, moderation affordances) keep the',
  '  Hub\u2019s own look, rather than being recoloured by the previewed theme? The themed fixture is the one',
  '  bordered region labelled as a preview.',
  '- Does the page avoid decoration at the expense of usability?',
  '',
  'Score 90+ only when text hierarchy is readable, essential controls are visible and nonoverlapping,',
  'focus/selection is apparent where expected, and the scene retains appropriate prominence.',
  'Identify concrete defects; do not reward decoration at the expense of usability.',
  '',
  'Treat any missing critical action as a failure regardless of score.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

export default defineConfig({
  id: 'hub_themes',
  app: 'hub',
  route: '/community/themes',
  waitCondition: 'hub_ready',
  cases: [
    {
      name: 'themes-listing',
      searchParams: {},
      prompt: THEME_CHROME_PROMPT,
      schema: HubThemesSchema,
      screenshotSelector: '[data-testid="theme-listing"], [data-testid="theme-listing-empty"], [data-testid="theme-listing-degraded"]',
      requiredFalseFields: [
        'unreadableText',
        'overlappingControls',
        'missingCriticalAction',
        'skinnedHubChrome',
        'loadedExternalResource',
      ],
    },
    {
      name: 'themes-listing-empty',
      searchParams: {},
      prompt: THEME_CHROME_PROMPT,
      schema: HubThemesSchema,
      screenshotSelector: '[data-testid="theme-listing-empty"], [data-testid="theme-listing-degraded"], [data-testid="theme-listing"]',
      requiredFalseFields: ['unreadableText', 'overlappingControls', 'skinnedHubChrome'],
    },
    {
      name: 'themes-listing-degraded',
      searchParams: {},
      prompt: THEME_CHROME_PROMPT,
      schema: HubThemesSchema,
      screenshotSelector: '[data-testid="theme-listing-degraded"], [data-testid="theme-listing"]',
      requiredFalseFields: ['unreadableText', 'overlappingControls', 'skinnedHubChrome'],
    },
  ],
});

/**
 * Detail-page cases.
 *
 * The four preview contexts the contract names are `theme-detail-light`,
 * `theme-detail-dark`, `theme-detail-high-contrast` and `theme-detail-compact`.
 * They are declared here rather than inline because a detail case needs a real
 * published slug — the fixture is supplied by the binding-bearing hub lane, and
 * a case with no fixture must be omitted rather than pointed at a 404.
 */
export const themeDetailVisualCases = [
  { name: 'theme-detail-light', mode: 'default', variant: 'light' },
  { name: 'theme-detail-dark', mode: 'default', variant: 'dark' },
  { name: 'theme-detail-high-contrast', mode: 'high-contrast', variant: 'dark' },
  { name: 'theme-detail-compact', mode: 'compact', variant: 'light' },
  { name: 'theme-detail-long-labels', mode: 'default', variant: 'light' },
  { name: 'theme-detail-pending-owner', mode: 'default', variant: 'light' },
] as const;
