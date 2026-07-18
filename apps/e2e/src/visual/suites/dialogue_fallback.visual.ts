// apps/e2e/src/visual/suites/dialogue_fallback.visual.ts
// biome-ignore-all lint/style/useNamingConvention: URL search parameter keys
// Authored Fallback Dialogue — declarative visual test suite.
//
// Validates that authored fallback dialogue renders correctly when
// AI is unavailable (offline mode). Captures the dialogue sandbox
// with forceOffline toggle and evaluates via AI.
//
// Contract: C-328 Integrate Bounded AI NPC Dialogue with Authored Fallbacks
//   AC-1: Authored fallback — dialogue never dead-ends
//   AC-4: Context projection via orchestrator

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const DialogueFallbackSchema = Type.Object({
  score: Type.Number({
    description: '0-100 score of visual correctness',
    minimum: 0,
    maximum: 100,
  }),
  dialogueVisible: Type.Boolean({
    description: 'Whether the dialogue overlay is visible with NPC name and reply',
  }),
  choicesVisible: Type.Boolean({
    description: 'Whether 2-4 distinct choice buttons are visible',
  }),
  choiceCountInRange: Type.Boolean({
    description: 'Whether choice count is between 2 and 4',
  }),
  noErrorText: Type.Boolean({
    description:
      'Whether NO raw error strings, *...* placeholders, or blank dialogue areas are shown',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const FALLBACK_PROMPT = [
  'This is a screenshot of the Aikami dialogue sandbox with the "Force Offline" toggle enabled.',
  '',
  'EXPECTED BEHAVIOR:',
  '- The dialogue overlay should be visible with an NPC name (e.g., Elder Thalia).',
  '- An authored reply text should be visible in the dialogue area.',
  '- 2–4 distinct choice buttons should be rendered below the NPC reply.',
  '- NO raw error strings, *...* placeholders, or blank dialogue areas should be visible.',
  '- The dialogue box should have a stable, properly styled layout.',
  '',
  'SCORING:',
  '- Score 90+ if the overlay is visible with authored reply, 2-4 choices, and zero errors.',
  '- Score 70-89 if the overlay is visible but choices are missing or malformed.',
  '- Score 50-69 if the overlay is visible but auth line has errors or formatting issues.',
  '- Score below 50 if the page is blank, the overlay is not visible, or there are error strings.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

export default defineConfig({
  id: 'dialogue_fallback',
  route: '/dev/sandbox/dialogue',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'authored-fallback',
      searchParams: { forceOffline: '1' },
      prompt: FALLBACK_PROMPT,
      schema: DialogueFallbackSchema,
    },
  ],
});
