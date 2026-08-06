// apps/e2e/src/visual/suites/game_hud.visual.ts
//
// Visual test suite for the game HUD and overlay navigation.
// Verifies HUD zone layout, HP bar, quest tracker, autosave indicator,
// and combat-aware HUD positioning.
// Contract: C-332

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const HudSchema = Type.Object({
  score: Type.Number({ description: '0-100 visual quality score' }),
  hpBarVisible: Type.Boolean({ description: 'HP bar visible in top-left' }),
  clockVisible: Type.Boolean({ description: 'Clock HUD visible in top-right' }),
  questOverlayVisible: Type.Boolean({
    description: 'Active-quest overlay card visible in top-right',
  }),
  noOverlappingElements: Type.Boolean({ description: 'No HUD elements overlap each other' }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues found' }),
});

export default defineConfig({
  id: 'game-hud',
  route: '/game',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'hud-exploration',
      prompt:
        'Score 90+: Three HUD zones visible (HP top-left, clock top-right, active-quest overlay card below the clock in the top-right). No overlapping elements. HP bar shows progress fill. The quest overlay card shows a quest title or "No active quest" hint. Layout is clean and readable.',
      schema: HudSchema,
    },
    {
      name: 'hud-autosave',
      prompt:
        'Score 90+: The top-right zone should have clock HUD with time display and the autosave indicator adjacent to it without causing layout shift. The autosave indicator shows "Saved" with a checkmark.',
      schema: HudSchema,
    },
    {
      name: 'hud-combat',
      prompt:
        'Score 90+: HP bar hidden (combat sidebar shows HP). Clock+autosave visible in top-right of canvas area (not overlapping sidebar). Active-quest overlay card may remain in the top-right corner but must not overlap the combat sidebars. No elements clipped by grid boundary.',
      schema: HudSchema,
    },
  ],
});
