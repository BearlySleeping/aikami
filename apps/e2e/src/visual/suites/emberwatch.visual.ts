// apps/e2e/src/visual/suites/emberwatch.visual.ts
// Emberwatch village — production-path visual suite (C-375 AC-1/AC-4/AC-5,
// C-378 AC-1/AC-3/AC-6/AC-9).
//
// Captures the real /game route (Emberwatch default spawn at the village
// gate) and validates the regenerated atlas + rebuilt map render as a
// coherent pixel-art village. C-378 splits the single mega-case into two
// focused cases — fewer booleans per VLM call is the cheapest variance
// reduction — and hard-gates the headline claims via `requiredTrueFields`:
//   - Case A asserts the autotiled grass/dirt/water transitions render
//     naturally (AC-3/AC-6);
//   - Case B asserts the gate arch draws OVER the player standing beneath
//     it (AC-1). The village map places the arch over the walkable gate gap
//     at the default spawn, so overheadOccludesPlayer is true by geometry.

import type { Page } from 'playwright';
import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// Case A — terrain transitions + village coherence (9 fields, focused).
const TerrainSchema = Type.Object({
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
      'Whether grass/dirt/water boundaries have blended diagonal edge tiles rather than hard rectangular seams',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// Case B — overhead occlusion (few fields, one hard claim).
const OverheadSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  villageLooksCoherent: Type.Boolean({
    description: 'Whether the scene reads as a coherent pixel-art village',
  }),
  overheadOccludesPlayer: Type.Boolean({
    description: 'Whether a roof/arch tile is drawn OVER the player character standing beneath it',
  }),
  playerVisible: Type.Boolean({
    description: 'Whether the player character is visible in the gate opening',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// Case C (C-400 AC-1) — complete NPC bodies, no floating heads.
const NpcBodiesSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  allNpcsHaveBodies: Type.Boolean({
    description: 'Whether every visible character sprite has a torso and legs beneath its head',
  }),
  noFloatingHeads: Type.Boolean({
    description: 'Whether zero heads appear without a body',
  }),
  npcVisuallyDistinct: Type.Boolean({
    description:
      'Whether visible NPCs look like complete distinct characters (not identical bald male heads)',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const TERRAIN_PROMPT = [
  'This is a screenshot from the Emberwatch village — a top-down pixel-art JRPG scene from the Aikami game engine.',
  'The player has just spawned at the village gate (south-center of the map) and the camera centers on the player.',
  '',
  'THE SCENE SHOULD CONTAIN AT THE SPAWN POSITION:',
  '- Green grass tiles covering the ground, with some darker grass patches and brown dirt path edges.',
  '- A gray cobblestone path leading north from the player (the main road), and a horizontal path crossing the map.',
  '- A wooden village gate prop with stone posts directly north of the player spawn.',
  '- Gray stone wall tiles forming the village border, with a lighter wall-top rim.',
  '- A pixel-art human player character with natural skin/hair colors standing at the center (their lower body may be partially hidden behind the gate — correct depth occlusion).',
  '- A small pond with blended water/grass edges near the eastern houses (southeast of the center).',
  '',
  'EVALUATE:',
  '- Is the ground clearly a colorful pixel-art village (grass + paths + walls), not a blank or dark grid?',
  '- Are tile boundaries SHARP — hard-edged pixel art with NO blurring, softening, or bilinear interpolation between adjacent tiles?',
  '- Are the stone walls, wall-top rim, and the gate prop visible?',
  '- Are grass/dirt/water boundaries blended with DIAGONAL edge tiles (autotiled corner-16) instead of hard rectangular seams? Look closely at the dirt path edges and the pond shoreline — diagonal transitions are the headline feature.',
  '- Is the player character rendered with natural colors (not a solid green/magenta square)?',
  '- Are there ZERO character-head sprites used as props?',
  '- Are there ZERO solid white squares?',
  '',
  'CRISP TILES (score 90+ requirement): tile edges must be hard and pixelated — if tiles look smooth, soft, or smeared, mark tilesAreCrisp false and score below 90.',
  '',
  'Score breakdown:',
  '- 90-100: Coherent colorful village — grass, paths, walls, gate prop, player all visible, autotiled diagonal transitions present.',
  '- 70-89: Village elements mostly present but some missing/ambiguous.',
  '- 40-69: Partial rendering — map or props broken.',
  '- 0-39: Blank, dark grid, or severely broken rendering.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// C-378 visual determinism: wait for the engine's visual-ready flag (set on
// GAME_READY once the gameHour env command has been applied — either after
// ENVIRONMENT_UPDATED confirms the requested hour, or immediately on a normal
// boot). Shared by both cases so the readiness contract stays in one place.
const waitForVisualReady = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__AIKAMI_VISUAL_READY__ === true,
    undefined,
    { timeout: 10_000 },
  );
};

const NPC_BODIES_PROMPT = [
  'This is a screenshot from the Emberwatch village — a top-down pixel-art JRPG scene from the Aikami game engine.',
  'The player has just spawned at the village gate (south-center of the map) and the camera centers on the player.',
  '',
  'NPC CHECK (C-400 AC-1):',
  '- Every visible character sprite must be COMPLETE — a head connected to a body, torso, legs, and feet.',
  '- ZERO floating heads: no head may appear as a disembodied sprite without a body beneath it.',
  '- The village elder NPC (near the center/upper village) should read as a full robed character, visually distinct from the player — not an identical bald male head.',
  '',
  'EVALUATE:',
  '- Are there ANY heads without bodies (disembodied floating heads)? If yes, noFloatingHeads=false and score below 90.',
  '- Does every character have a torso and legs beneath its head? If any character is just a head, allNpcsHaveBodies=false.',
  '- Are the NPCs visually distinct from one another and from the player (different hair/clothing)?',
  '- Is the scene otherwise a coherent pixel-art village (not a blank/dark grid)?',
  '',
  'Score breakdown:',
  '- 90-100: All characters complete with bodies; zero floating heads; NPCs visually distinct.',
  '- 70-89: Characters mostly complete but some ambiguity in body visibility.',
  '- 40-69: A floating head or bodiless character is visible.',
  '- 0-39: Severely broken rendering (blank grid, heads-only scene).',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const OVERHEAD_PROMPT = [
  'This is a screenshot from the Emberwatch village — a top-down pixel-art JRPG scene from the Aikami game engine.',
  'The player has just spawned at the village gate (south-center of the map) and the camera centers on the player.',
  '',
  'THE SCENE AT THE SPAWN POSITION:',
  '- The player stands in the village gate opening at the bottom-center of the screen.',
  "- DIRECTLY OVER THE PLAYER, a roof/arch tile (brown shingle roof) is drawn ON TOP of the player character — the roof covers part of the player's head/upper body while the lower body remains visible below it.",
  '- A wooden village gate prop with stone posts is directly north of the player.',
  '',
  'EVALUATE:',
  '- Is a roof/arch tile visibly drawn OVER the player character (occluding their head/upper body while they stand beneath it)? This is the KEY question — overheadOccludesPlayer must be TRUE if a roof tile covers any part of the player.',
  '- Is the player character visible at all in the gate opening (partially hidden behind the roof is expected and correct)?',
  '- Is the scene a coherent pixel-art village, not a blank or dark grid?',
  '',
  'Score breakdown:',
  '- 90-100: Roof tile clearly drawn over the player, scene coherent.',
  '- 70-89: Scene coherent but the overhead-occlusion is subtle/ambiguous.',
  '- 40-69: No roof over the player, or scene partially broken.',
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
      name: 'Village — terrain transitions at noon (production /game)',
      screenshotSelector: 'canvas',
      prompt: TERRAIN_PROMPT,
      schema: TerrainSchema,
      // C-378 AC-9: the game boots at midnight and the day/night tint
      // darkens the tilemap. Both cases capture at noon so the autotiled
      // edges are fully lit, and wait for the visual-ready flag (set once
      // the gameHour command has been dispatched) instead of a blind sleep.
      searchParams: { gameHour: '12' },
      // C-378 visual determinism: wait for the engine's visual-ready flag
      // (set once the noon env command has been applied) so the noon tint
      // is in effect before capture — replaces the blind 2s sleep with a
      // deterministic condition.
      setupHook: waitForVisualReady,
      requiredTrueFields: ['terrainTransitionsLookNatural'],
    },
    {
      name: 'Village — player beneath the gate arch (production /game)',
      screenshotSelector: 'canvas',
      prompt: OVERHEAD_PROMPT,
      schema: OverheadSchema,
      searchParams: { gameHour: '12' },
      setupHook: waitForVisualReady,
      // C-378 AC-1: overheadOccludesPlayer is a HARD gate — a generous
      // score must not paper over the headline visual claim.
      requiredTrueFields: ['overheadOccludesPlayer'],
    },
    {
      // C-400 AC-1: complete NPC bodies — the headline defect this contract
      // fixes. The village map's authored NPC (village_elder) must render
      // with all six slots visible; zero heads may float without a body.
      name: 'Village — NPC renders a complete body (production /game)',
      screenshotSelector: 'canvas',
      prompt: NPC_BODIES_PROMPT,
      schema: NpcBodiesSchema,
      // Noon ambient so the LPC sprites are fully lit (C-404 makes the
      // default night ambient too dark for the VLM to read).
      searchParams: { gameHour: '12' },
      setupHook: waitForVisualReady,
      requiredTrueFields: ['allNpcsHaveBodies', 'noFloatingHeads'],
    },
  ],
});
