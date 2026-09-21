// apps/e2e/src/visual/suites/npc_identity.visual.ts
// NPC identity + prop transparency — declarative visual test suite.
//
// Captures the village scene at /game and evaluates (via AI) that:
//   - authored NPCs render with adult anatomy (no child/adult mismatch);
//   - props/decor over grass show transparent unpainted regions (no opaque
//     substrate squares).
//
// Contract: C-504 AC-5 (named NPC identity in the real scene).

import { NpcSceneSchema } from '@aikami/schemas';
import { defineConfig } from '$visual/core/config';

// ── Prompts ──────────────────────────────────────────────────

const PROMPT = [
  'This is a screenshot of the Aikami Emberwatch village game scene (pixel-art JRPG).',
  '',
  'EXPECTED:',
  '- A top-down village: grass terrain with the village elder NPC and possibly other villagers.',
  '- NPCs are pixel-art characters with ADULT proportions (tall, mature body/head).',
  '- Props (well, fence, gate, notice board, crates/barrels) sit ON the grass with transparent',
  '  unpainted areas — you should NOT see opaque green/brown squares around them.',
  '',
  'EVALUATE:',
  '- Is at least one NPC character clearly visible?',
  '- Do the NPCs look like ADULTS (not children with oversized heads)?',
  '- Do props blend into the ground via transparency rather than as opaque blocks?',
  '- Is the scene coherent (no magenta placeholders, no white squares)?',
  '',
  'Score: 90-100 for adult NPCs + transparent props, 70-89 for minor issues, 0-69 for broken/mismatched rendering.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'npc_identity',
  route: '/game',
  waitCondition: 'pixi_loaded' as const,
  cases: [
    {
      name: 'village-npc-identity',
      prompt: PROMPT,
      schema: NpcSceneSchema,
    },
  ],
});
