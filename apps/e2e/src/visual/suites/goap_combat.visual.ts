// apps/e2e/src/visual/suites/goap_combat.visual.ts
// GOAP Combat Tactics — declarative visual test suite.
//
// Captures the split-screen staging viewport during active combat
// testing loops. Evaluates whether enemy models dynamically reposition
// themselves on the grid to settle within their preferredRange zones
// relative to the player.
//
// Contract: C-197

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const TacticalCombatSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of tactical correctness' }),
  enemyPositions: Type.Boolean({
    description: 'Whether enemies are properly positioned on the grid',
  }),
  dynamicReposition: Type.Boolean({
    description: 'Whether enemies reposition dynamically based on preferred range',
  }),
  uiOverlayVisible: Type.Boolean({
    description: 'Whether combat UI overlay is visible',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

const TACTICS_PROMPT = [
  'This is a screenshot from the Aikami game combat sandbox with tactical AI enabled.',
  'The /dev/sandbox/combat page is running with test_tactics=true.',
  '',
  'EXPECTED BEHAVIOR:',
  '- Enemy models settle at their preferred range distances from the player.',
  '- Ranged enemies maintain distance; melee enemies close to attack range.',
  '- Combat UI (split-screen or overlay) is visible.',
  '- No overlapping, cut-off, or misaligned elements.',
  '',
  'EVALUATE:',
  '- Score 90+ if enemy models dynamically reposition themselves on the grid',
  '  to settle within their preferredRange zones relative to the player.',
  '- Flanking units must route around obstacles to maximize advantage bits,',
  '  while ranged units maintain distance parameters cleanly.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'goap_combat_tactics',
  route: '/dev/sandbox/combat',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Tactical Aggro Reposition',
      searchParams: { testTactics: 'true' },
      prompt: TACTICS_PROMPT,
      schema: TacticalCombatSchema,
    },
  ],
});
