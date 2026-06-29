// apps/e2e/src/visual/suites/vision_cones.visual.ts
//
// Vision Cones — AI visual evaluation for spatial vision debug overlay.
// Contract C-190: Captures the debug view overlay highlighting calculated
// DDA ray traces and shadowed octant boundaries for visual regression.
//
// Evaluation parameters from contract:
//   Score 90+ if the debug layout displays sharp, directional vision cones
//   emanating from NPCs. Patrolling actors should exhibit narrow linear trace
//   lines (DDA), while alert/suspicious actors must show filled wedge-shaped
//   octant sweeps bounded correctly by wall tiles.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema: expected visual properties ───────────────────────

const VisionConeSchema = Type.Object({
  score: Type.Number({
    description: '0-100 score of visual correctness',
  }),
  ddaLinesVisible: Type.Boolean({
    description: 'Whether narrow DDA line traces are visible from patrolling NPCs',
  }),
  shadowWedgeVisible: Type.Boolean({
    description: 'Whether filled wedge-shaped octant sweeps are visible from alert NPCs',
  }),
  wallOcclusionCorrect: Type.Boolean({
    description: 'Whether vision cones are correctly bounded by wall tiles',
  }),
  issues: Type.Array(Type.String(), {
    description: 'List of visual issues detected',
  }),
});

// ── Shared description for AI evaluation prompts ─────────────

const VISION_DESCRIPTION = [
  'This is a screenshot from the Aikami game engine with debug vision overlay enabled.',
  'The overlay visualizes NPC spatial perception:',
  '',
  'VISUAL ELEMENTS:',
  '- DDA ray traces: Thin colored lines radiating from patrolling NPCs.',
  '- Shadow wedges: Filled colored arcs radiating from alert/suspicious NPCs.',
  '- Vision should be occluded (cut off) where walls intersect the vision cone.',
  '- The world contains grass tiles (green), water tiles (blue), and wall tiles (grey).',
];

const VISION_PROMPT = [
  ...VISION_DESCRIPTION,
  '',
  'EVALUATE:',
  '- Are DDA line traces visible around patrolling NPCs?',
  '- Are filled octant shadow wedges visible around alert NPCs?',
  '- Are vision cones correctly bounded/occluded by wall tiles?',
  '- Are the visual elements sharp and directional (not blurry or misaligned)?',
  '',
  'Score breakdown:',
  '- 90-100: Sharp directional vision cones from NPCs, DDA traces + shadow wedges both visible, properly wall-occluded.',
  '- 70-89: Vision cones visible but some issues (misalignment, missing wedge, partial occlusion).',
  '- 50-69: Only basic DDA lines visible, shadow wedges missing or broken.',
  '- 0-49: No vision debug overlay visible, blank canvas, or completely broken rendering.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite definition ─────────────────────────────────────────

export default defineConfig({
  id: 'vision_cones',
  route: '/dev/sandbox/map',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Patrol vs Alert FOV',
      // biome-ignore lint/style/useNamingConvention: URL query parameter names
      searchParams: { debug_vision: 'true' },
      prompt: VISION_PROMPT,
      schema: VisionConeSchema,
    },
  ],
});
