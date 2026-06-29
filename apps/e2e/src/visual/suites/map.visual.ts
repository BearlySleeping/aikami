// apps/e2e/src/visual/suites/map.visual.ts
// Map & Zoning Sandbox — declarative visual test suite.
//
// Port of map_sandbox_eval.ts into the AI Visual Testing Framework.
// Validates map rendering, sprite compositing, and corner clamping
// via AI visual evaluation with TypeBox schema enforcement.
//
// Test cases:
//   - zone_a / zone_b: Full map render with character visibility
//   - corner_*: Spawn position clamping at all 4 map corners

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Base schema: common fields for all map tests ─────────────

const MapVisualSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  characterVisible: Type.Boolean({
    description: 'Whether a pixel-art character is visible on the canvas',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Corner-specific schema extends base with position checks ─

const CornerVisualSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  characterVisible: Type.Boolean({ description: 'Whether the character is visible on the canvas' }),
  onGreenGrass: Type.Boolean({
    description: 'Whether the character is standing on a green grass tile',
  }),
  onBlueWater: Type.Boolean({
    description: 'Whether the character is standing on a blue water tile (should be false)',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Shared map description for AI prompts ────────────────────

const MAP_DESCRIPTION = [
  'This is a screenshot from a 10×10 tile debug map in the Aikami game engine.',
  '',
  'MAP LAYOUT:',
  '- Green tiles = grass (walkable interior, 8×8 center).',
  '- Blue tiles = water (collision border, only on row 0, row 9, col 0, col 9).',
  '- Grey tiles = house walls (middle-left area).',
  '- Brown tile = house door.',
  '- Pink/cyan pixel-art character = player spawn.',
];

// ── Zone evaluation prompts ──────────────────────────────────

const ZONE_PROMPT = [
  ...MAP_DESCRIPTION,
  '',
  'EVALUATE:',
  '- Is the pink/cyan pixel-art character visible on the canvas?',
  '- Are the character layers composited correctly (head, body, legs)?',
  '- Is the map background rendered with green grass and blue water tiles?',
  '- Is the grey house visible?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Corner evaluation prompts ────────────────────────────────

const CORNER_PROMPT = [
  ...MAP_DESCRIPTION,
  '',
  'EVALUATE:',
  '- Is the pink/cyan pixel-art character visible on the canvas?',
  '- Is the character standing on a GREEN tile (grass)?',
  '- Is the character NOT standing on a BLUE tile (water)?',
  '- Is the character within the 8×8 interior (not on the outermost border rows/cols)?',
  '',
  'Score breakdown:',
  '- 95-100: Character clearly on green grass, well inside the interior.',
  '- 80-94: Character on grass but near a wall/border.',
  '- 50-79: Character on a non-grass tile (grey house, brown door).',
  '- 0-49: Character on blue water, outside the map, or not visible at all.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite definition ─────────────────────────────────────────

export default defineConfig({
  id: 'map',
  route: '/dev/sandbox/map',
  waitCondition: 'game_ready',
  cases: [
    // ── Zone A: debug_map.jton ──────────────────────────────
    {
      name: 'Zone A — Debug JTON Map',
      searchParams: { zone: 'a' },
      prompt: ZONE_PROMPT,
      schema: MapVisualSchema,
    },

    // ── Zone B: sandbox_zone_b.json ─────────────────────────
    {
      name: 'Zone B — Legacy JSON Map',
      searchParams: { zone: 'b' },
      prompt: ZONE_PROMPT,
      schema: MapVisualSchema,
    },

    // ── Corner clamping: top-left (0, 0) ────────────────────
    {
      name: 'Corner — Top-Left',
      // biome-ignore lint/style/useNamingConvention: URL query parameter names
      searchParams: { position_x: '0', position_y: '0' },
      prompt: CORNER_PROMPT,
      schema: CornerVisualSchema,
    },

    // ── Corner clamping: top-right (320, 0) ─────────────────
    {
      name: 'Corner — Top-Right',
      // biome-ignore lint/style/useNamingConvention: URL query parameter names
      searchParams: { position_x: '320', position_y: '0' },
      prompt: CORNER_PROMPT,
      schema: CornerVisualSchema,
    },

    // ── Corner clamping: bottom-left (0, 320) ───────────────
    {
      name: 'Corner — Bottom-Left',
      // biome-ignore lint/style/useNamingConvention: URL query parameter names
      searchParams: { position_x: '0', position_y: '320' },
      prompt: CORNER_PROMPT,
      schema: CornerVisualSchema,
    },

    // ── Corner clamping: bottom-right (320, 320) ────────────
    {
      name: 'Corner — Bottom-Right',
      // biome-ignore lint/style/useNamingConvention: URL query parameter names
      searchParams: { position_x: '320', position_y: '320' },
      prompt: CORNER_PROMPT,
      schema: CornerVisualSchema,
    },
  ],
});
