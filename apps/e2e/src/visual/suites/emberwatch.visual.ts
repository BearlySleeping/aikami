// apps/e2e/src/visual/suites/emberwatch.visual.ts
// Emberwatch village — production-path visual suite (C-375 AC-1/AC-4/AC-5).
//
// Captures the real /game route (Emberwatch default spawn at the village
// gate) and validates the regenerated atlas + rebuilt map render as a
// coherent pixel-art village: grass, paths, visible walls, props (well,
// notice board, gate), zero LPC-head props, zero white squares.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const EmberwatchSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  villageLooksCoherent: Type.Boolean({
    description: 'Whether the scene reads as a coherent pixel-art village',
  }),
  tilesAreCrisp: Type.Boolean({
    description: 'Whether tile edges are hard-edged pixel art with no blur',
  }),
  wallsVisible: Type.Boolean({ description: 'Whether stone walls / wall rims are visible' }),
  propsVisible: Type.Boolean({
    description: 'Whether prop sprites (well, notice board, gate) are visible as distinct art',
  }),
  noLpcHeads: Type.Boolean({
    description: 'Whether zero LPC character heads are used as props',
  }),
  noWhiteSquares: Type.Boolean({ description: 'Whether zero solid white squares appear' }),
  terrainTransitionsLookNatural: Type.Boolean({
    description:
      'Whether grass/dirt/path boundaries have blended edge tiles rather than hard rectangular seams',
  }),
  overheadOccludesPlayer: Type.Boolean({
    description: 'Whether roof/canopy tiles draw over the player when standing beneath them',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const VILLAGE_PROMPT = [
  'This is a screenshot from the Emberwatch village — a top-down pixel-art JRPG scene from the Aikami game engine.',
  'The player has just spawned at the village gate (south-center of the map) and the camera centers on the player.',
  '',
  'THE SCENE SHOULD CONTAIN AT THE SPAWN POSITION:',
  '- Green grass tiles covering the ground, with some darker grass patches and brown dirt path edges.',
  '- A gray cobblestone path leading north from the player (the main road), and a horizontal path crossing the map.',
  '- A wooden village gate prop with stone posts directly north of the player spawn.',
  '- Gray stone wall tiles forming the village border, with a lighter wall-top rim.',
  '- A pixel-art human player character with natural skin/hair colors standing at the center (their lower body may be partially hidden behind the gate — correct depth occlusion).',
  '',
  'EVALUATE:',
  '- Is the ground clearly a colorful pixel-art village (grass + paths + walls), not a blank or dark grid?',
  '- Are tile boundaries SHARP — hard-edged pixel art with NO blurring, softening, or bilinear interpolation between adjacent tiles?',
  '- Are the stone walls, wall-top rim, and the gate prop visible?',
  '- Are grass/dirt/path boundaries blended with diagonal edge tiles (autotiled corner-16) instead of hard rectangular seams?',
  '- Is the player character rendered with natural colors (not a solid green/magenta square)?',
  '- Are there ZERO character-head sprites used as props?',
  '- Are there ZERO solid white squares?',
  '',
  'CRISP TILES (score 90+ requirement): tile edges must be hard and pixelated — if tiles look smooth, soft, or smeared, mark tilesAreCrisp false and score below 90.',
  '',
  'Score breakdown:',
  '- 90-100: Coherent colorful village — grass, paths, walls, gate prop, player all visible.',
  '- 70-89: Village elements mostly present but some missing/ambiguous.',
  '- 40-69: Partial rendering — map or props broken.',
  '- 0-39: Blank, dark grid, or severely broken rendering.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

export default defineConfig({
  id: 'emberwatch',
  route: '/game',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Village — default spawn at noon (production /game)',
      screenshotSelector: 'canvas',
      prompt: VILLAGE_PROMPT,
      schema: EmberwatchSchema,
      // C-378 AC-9: the game boots at midnight and the day/night tint
      // darkens the tilemap. The terrain evidence case captures at noon so
      // the autotiled grass/dirt/water edges are fully lit.
      searchParams: { gameHour: '12' },
    },
  ],
});
