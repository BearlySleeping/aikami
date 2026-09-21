// apps/e2e/src/visual/suites/onboarding_presets.visual.ts
// Onboarding Presets — declarative visual test suite for the preset-first
// character creation flow.
//
// Captures /personas/create?onboarding=1, asserting that illustrated starter
// heroes are the PRIMARY affordance (C-498 AC-1) and that each card renders a
// REAL LPC portrait — no empty placeholder frame, no hard-coded emoji (AC-3).
//
// The PixiJS portrait canvas in each starter hero card sets
// window.__PIXI_LPC_PREVIEW_LOADED__ once initialized, so the pixi_loaded
// wait condition gates on portraits being actually rendered.
//
// Contract: C-498 A preset means the character is ready

import { HeroCardsSchema } from '@aikami/schemas';
import { defineConfig } from '$visual/core/config';

const HERO_CARDS_PROMPT = [
  'This is a screenshot of the Aikami character creation screen (onboarding).',
  'The page title should read "Choose Your Hero".',
  '',
  'EVALUATE:',
  '- Are 3 illustrated starter hero cards displayed as the PRIMARY, topmost content?',
  '- Does each card show a real pixel-art character portrait (not an emoji icon or empty grey box)?',
  '- Are the hero names (Thaldrin, Lyra, Zeph) and race/class badges visible on the cards?',
  '- Are the AI chat / manual creation options clearly SECONDARY, positioned below the hero cards?',
  '- Is the layout clean and readable (no overlapping text, no broken images)?',
  '',
  'Score: 90-100 for illustrated cards with real portraits as primary affordance, 70-89 for minor issues, 0-69 for broken layout or missing portraits.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

export default defineConfig({
  id: 'onboarding-presets',
  route: '/personas/create',
  waitCondition: 'pixi_loaded',
  requiresAuth: false,
  cases: [
    {
      name: 'Starter Heroes Primary — Illustrated Cards with Portraits',
      searchParams: { onboarding: '1' },
      prompt: HERO_CARDS_PROMPT,
      schema: HeroCardsSchema,
    },
  ],
});
