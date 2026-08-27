// apps/e2e/src/visual/suites/hub_walk_sandbox.visual.ts
//
// C-447 AC-1, AC-2, AC-3: Hub walk sandbox visual tests.
// Validates map rendering, collision overlay, and z-band/render-order overlays.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ────────────────────────────────────────────────────────────────

const SandboxLoadedSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  mapRendered: Type.Boolean({ description: 'Whether a tilemap is rendered on the canvas' }),
  characterVisible: Type.Boolean({
    description: 'Whether a single visible humanoid character is standing on the map',
  }),
  noPlaceholders: Type.Boolean({
    description: 'No untextured placeholders or solid-color blocks',
  }),
  characterInBounds: Type.Boolean({
    description: 'Character is drawn within the map bounds, not outside',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const CollisionOverlaySchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  tintedCells: Type.Boolean({
    description: 'Tinted cells cover solid features — walls, water, cliffs',
  }),
  noTintOnFloor: Type.Boolean({
    description: 'No tint on open walkable floor areas',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const ZOrderSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  characterOccluded: Type.Boolean({
    description: 'In the "behind" case the character is partly occluded by the object',
  }),
  characterOccluding: Type.Boolean({
    description: 'In the "in front" case the character fully occludes the object\'s base',
  }),
  noOverlapOcclusion: Type.Boolean({
    description: 'No case shows the character both overlapping and occluded',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompts ───────────────────────────────────────────────────────────────

const SANDBOX_LOADED_PROMPT = [
  'This is a screenshot from the Aikami Hub walk sandbox (/sandbox/[mapTag]).',
  '',
  'EXPECTED:',
  '- A rendered tilemap with visible tiles (ground, walls, objects).',
  '- A single visible humanoid character standing on the map.',
  '- No untextured placeholders or solid-color blocks.',
  '- The character is drawn within the map bounds, not outside.',
  '',
  'EVALUATE:',
  '- Is a tilemap rendered on the canvas?',
  '- Is a humanoid character visible?',
  '- Are there any untextured placeholders?',
  '- Is the character within the map bounds?',
  '',
  'Score: 90-100 for clear map with character, 70-89 for partial rendering, 0-69 for missing or broken.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const COLLISION_OVERLAY_PROMPT = [
  'This is a screenshot from the Aikami Hub walk sandbox with the collision overlay enabled.',
  '',
  'EXPECTED:',
  '- Tinted cells (red overlay) cover solid features — walls, water, cliffs.',
  '- Open walkable floor areas are NOT tinted.',
  '- The overlay aligns with the tilemap grid.',
  '',
  'EVALUATE:',
  '- Are solid features covered by tinted cells?',
  '- Is open floor left untinted?',
  '- Does the overlay align with the grid?',
  '',
  'Score: 90-100 for correct overlay, 70-89 for partial coverage, 0-69 for incorrect or missing.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const ZORDER_BEHIND_PROMPT = [
  'This is a screenshot from the Aikami Hub walk sandbox showing a character behind a tall object.',
  '',
  'EXPECTED:',
  '- The character is positioned above a tall object (wall, tree, building).',
  '- The character is partly occluded by the object (drawn behind it).',
  '- The character does NOT overlap the object while also being occluded.',
  '',
  'EVALUATE:',
  '- Is the character behind the object?',
  '- Is the character partly occluded?',
  '- Is there any conflicting overlap?',
  '',
  'Score: 90-100 for correct z-ordering, 70-89 for partial, 0-69 for incorrect.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const ZORDER_FRONT_PROMPT = [
  'This is a screenshot from the Aikami Hub walk sandbox showing a character in front of a tall object.',
  '',
  'EXPECTED:',
  '- The character is positioned below a tall object (wall, tree, building).',
  '- The character fully occludes the object\'s base (drawn in front).',
  '- The character does NOT overlap the object while also being occluded.',
  '',
  'EVALUATE:',
  '- Is the character in front of the object?',
  '- Does the character occlude the object\'s base?',
  '- Is there any conflicting overlap?',
  '',
  'Score: 90-100 for correct z-ordering, 70-89 for partial, 0-69 for incorrect.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite ─────────────────────────────────────────────────────────────────

export default defineConfig({
  id: 'hub-walk-sandbox',
  route: '/sandbox/maps:sandbox_zone_a',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'sandbox-loaded',
      searchParams: {},
      prompt: SANDBOX_LOADED_PROMPT,
      schema: SandboxLoadedSchema,
      canvasSelector: 'canvas',
      clipSize: 640,
    },
    {
      name: 'sandbox-collision-overlay',
      searchParams: {},
      prompt: COLLISION_OVERLAY_PROMPT,
      schema: CollisionOverlaySchema,
      canvasSelector: 'canvas',
      clipSize: 640,
      setupHook: async (page) => {
        await page.getByTestId('sandbox-overlay-toggle-collision').click();
        await page.waitForTimeout(500);
      },
    },
    {
      name: 'sandbox-behind-object',
      searchParams: { spawn: '10,5' },
      prompt: ZORDER_BEHIND_PROMPT,
      schema: ZOrderSchema,
      canvasSelector: 'canvas',
      clipSize: 640,
    },
    {
      name: 'sandbox-in-front-of-object',
      searchParams: { spawn: '10,15' },
      prompt: ZORDER_FRONT_PROMPT,
      schema: ZOrderSchema,
      canvasSelector: 'canvas',
      clipSize: 640,
    },
  ],
});
