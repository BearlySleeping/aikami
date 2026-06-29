// apps/e2e/src/visual/suites/emergent_world.visual.ts
// Emergent World Integration — declarative visual test suite.
//
// Contract C-196: Captures the complete ecosystem layout showing patrolling
// characters dynamically reacting to a streamed picking pocket tool call event.
//
// Evaluates: guard alert wedges, JPS corner-snapped paths, pursuit behavior,
// and off-screen macro character sector preservation.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const EmergentWorldSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of emergent world correctness' }),
  guardsAlerted: Type.Boolean({
    description: 'Whether nearby guard entities display alert visual indicators after crime event',
  }),
  pursuitActive: Type.Boolean({
    description: 'Whether pursuing entities calculate JPS paths around static blockages',
  }),
  macroCharactersStable: Type.Boolean({
    description: 'Whether off-screen macro characters maintain correct sector locations',
  }),
  canvasLoaded: Type.Boolean({ description: 'Whether the PixiJS canvas has rendered content' }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

const EMERGENT_WORLD_PROMPT = [
  'This is a screenshot from the Aikami emergent world integration test',
  '(/dev/sandbox/map?test_integration=true).',
  '',
  'EXPECTED:',
  '- A PixiJS canvas showing a tilemap with characters (NPCs, guards, player).',
  '- After a crime tool action is streamed, nearby guard entities should show',
  '  alert visual indicators (red tint, exclamation marks, or combat wedges).',
  '- Pursuing entities should calculate JPS paths around static blockages',
  '  (walls, buildings) — no straight-line clipping through walls.',
  '- Off-screen macro characters should maintain logical sector positions',
  '  without rendering anomalies or disappearing.',
  '- The full 6-step pipeline (ingestion → macro sim → perception →',
  '  cognition → navigation → resolution) should execute without frame drops',
  '  or rendering artifacts.',
  '',
  'EVALUATE:',
  '- Are characters visible on the canvas?',
  '- Are any alert indicators present on guard entities?',
  '- Do pursuit paths respect static obstacles (no wall clipping)?',
  '- Are off-screen characters stable (no flickering/missing)?',
  '',
  'Score: 90-100 for full pipeline with guards reacting and pathfinding active,',
  '70-89 for characters visible but no emergent reactions,',
  '0-69 for missing or broken rendering.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'emergent-world',
  route: '/dev/sandbox/map',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Full Cycle Reaction',
      // biome-ignore lint/style/useNamingConvention: URL query param
      searchParams: { test_integration: 'true' },
      prompt: EMERGENT_WORLD_PROMPT,
      schema: EmergentWorldSchema,
    },
  ],
});
