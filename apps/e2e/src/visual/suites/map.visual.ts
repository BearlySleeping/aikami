// apps/e2e/src/visual/suites/map.visual.ts
// Map & Zoning Sandbox — declarative visual test suite.
//
// Validates:
//   - Full map rendering with character sprite compositing
//   - Corner spawn clamping: character must appear in the correct
//     screen region with visible green grass underfoot
//
// Map layout (10×10 debug tiles, 32px tiles):
//   - Row 0 & Row 9: green grass (perimeter border)
//   - Col 0 & Col 9: green grass (perimeter border)
//   - Interior rows 1-8, cols 1-8: blue water (walkable decorative)
//   - (2,2)-(4,3): grey house + brown door

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

// ── Corner-specific schema: verifies position + grass ──────

const CornerVisualSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  characterVisible: Type.Boolean({ description: 'Whether the character is visible on the canvas' }),
  onGreenGrass: Type.Boolean({
    description: 'Whether the character is standing on a green grass tile',
  }),
  onBlueWater: Type.Boolean({
    description: 'Whether the character is standing on a blue water tile (should be false)',
  }),
  inCorrectCorner: Type.Boolean({
    description: 'Whether the character appears in the expected screen corner region',
  }),
  cornerLabel: Type.String({
    description:
      'Which corner the character appears in: topLeft, topRight, bottomLeft, bottomRight, or center',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Shared map description for AI prompts ────────────────────

const MAP_DESCRIPTION = [
  'This is a screenshot from a 10×10 tile (32×32px each = 320×320 world) debug map in the Aikami game engine.',
  'The camera FOLLOWS the player, so the player character will always appear near the CENTER of the image.',
  '',
  'MAP LAYOUT:',
  '- Green tiles = grass (only on outermost perimeter: row 0, row 9, col 0, col 9; plus a column 3 vertical bridge from row 9 to row 4).',
  '- Blue tiles = water (the entire interior — blocked/non-walkable).',
  '- Grey tiles = house walls (tiles (2,2), (4,2), (2,3), (4,3)).',
  '- Brown tile = house door (tile (3,3)).',
  '- The pixel-art player character uses LPC sprites (natural colors: skin tones, brown hair, clothing with torso/legs).',
  '',
  'SPAWN POSITIONS for corner tests:',
  '- Top-Left:    player spawns at grass tile (0,0) — pixel center (16, 16).',
  '- Top-Right:   player spawns at grass tile (9,0) — pixel center (304, 16).',
  '- Bottom-Left: player spawns at grass tile (0,9) — pixel center (16, 304).',
  '- Bottom-Right: player spawns at grass tile (9,9) — pixel center (304, 304).',
];

// ── Zone evaluation prompts ──────────────────────────────────

const ZONE_PROMPT = [
  ...MAP_DESCRIPTION,
  '',
  'EVALUATE:',
  '- Is an LPC pixel-art character (natural skin/clothing colors) visible on the canvas?',
  '- Are the character layers composited correctly (head, body, legs, torso, feet)?',
  '- Is the map background rendered with green grass tiles on the perimeter?',
  '- Is the blue water interior visible?',
  '- Is the grey house structure visible?',
  '',
  'Score breakdown:',
  '- 95-100: Fully composited LPC character, map tiles clearly distinguishable (green grass, blue water, grey house, brown door).',
  '- 80-94: Character visible, map tiles partially rendered but colors/placement partially correct.',
  '- 50-79: Character visible but map tiles are wrong colors or missing entirely.',
  '- 0-49: Character not visible, or canvas is blank/solid color.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Corner evaluation prompt builder ─────────────────────────

const cornerPrompt = (corner: string, expectedTile: string): string =>
  [
    ...MAP_DESCRIPTION,
    '',
    `CORNER TEST: The player was spawned at the ${corner} corner of the map at ${expectedTile}.`,
    'The camera CENTERS on the player, so the character sprite will appear in the CENTER of the image.',
    'To determine which corner the player is on, look at the TILES surrounding the character.',
    '',
    'EVALUATE:',
    '- Is an LPC pixel-art character visible?',
    '- What color/type are the tiles under and around the character?',
    `- The player should be on a GREEN grass tile (${expectedTile} in the ${corner} corner).`,
    '- Is the character on GREEN grass (not blue water, not grey house, not brown door)?',
    '- Set cornerLabel to the corner closest to where the surrounding tiles indicate (topLeft, topRight, bottomLeft, bottomRight, or center if ambiguous).',
    '- Set inCorrectCorner to true ONLY if the surrounding tile pattern clearly matches the expected corner.',
    '',
    'Tile patterns to look for:',
    '- Top-Left corner:    character centered, green tiles below and right, blue water above and left of center.',
    '- Top-Right corner:   character centered, green tiles below and left, blue water above and right of center.',
    '- Bottom-Left corner: character centered, green tiles above and right, blue water below and left of center.',
    '- Bottom-Right corner:character centered, green tiles above and left, blue water below and right of center.',
    '',
    'Score breakdown:',
    '- 95-100: Character clearly on green grass. Surrounding tile pattern matches the expected corner.',
    '- 80-94: Character on green grass but surrounding tiles ambiguous or partially wrong.',
    '- 50-79: Character on blue water or non-grass tile.',
    '- 0-49: Character not visible, off-screen, or canvas is blank/solid color.',
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
      screenshotSelector: 'canvas',
      prompt: ZONE_PROMPT,
      schema: MapVisualSchema,
    },

    // ── Zone B: sandbox_zone_b.json ─────────────────────────
    {
      name: 'Zone B — Legacy JSON Map',
      searchParams: { zone: 'b' },
      screenshotSelector: 'canvas',
      prompt: ZONE_PROMPT,
      schema: MapVisualSchema,
    },

    // ── Corner: Top-Left — spawn on grass at row 0, col 0 ──
    //    Grass perimeter: pixel center (16, 16) = tile (0, 0)
    {
      name: 'Corner — Top-Left',
      // biome-ignore lint/style/useNamingConvention: URL query parameter names use snake_case
      searchParams: { position_x: '16', position_y: '16' },
      screenshotSelector: 'canvas',
      prompt: cornerPrompt('top-left', 'tile (0,0)'),
      schema: CornerVisualSchema,
    },

    // ── Corner: Top-Right — spawn on grass at row 0, col 9 ─
    //    Grass perimeter: pixel center (304, 16) = tile (9, 0)
    {
      name: 'Corner — Top-Right',
      // biome-ignore lint/style/useNamingConvention: URL query parameter names use snake_case
      searchParams: { position_x: '304', position_y: '16' },
      screenshotSelector: 'canvas',
      prompt: cornerPrompt('top-right', 'tile (9,0)'),
      schema: CornerVisualSchema,
    },

    // ── Corner: Bottom-Left — spawn on grass at row 9, col 0 ─
    //    Grass perimeter: pixel center (16, 304) = tile (0, 9)
    {
      name: 'Corner — Bottom-Left',
      // biome-ignore lint/style/useNamingConvention: URL query parameter names use snake_case
      searchParams: { position_x: '16', position_y: '304' },
      screenshotSelector: 'canvas',
      prompt: cornerPrompt('bottom-left', 'tile (0,9)'),
      schema: CornerVisualSchema,
    },

    // ── Corner: Bottom-Right — spawn on grass at row 9, col 9 ─
    //    Grass perimeter: pixel center (304, 304) = tile (9, 9)
    {
      name: 'Corner — Bottom-Right',
      // biome-ignore lint/style/useNamingConvention: URL query parameter names use snake_case
      searchParams: { position_x: '304', position_y: '304' },
      screenshotSelector: 'canvas',
      prompt: cornerPrompt('bottom-right', 'tile (9,9)'),
      schema: CornerVisualSchema,
    },
  ],
});
