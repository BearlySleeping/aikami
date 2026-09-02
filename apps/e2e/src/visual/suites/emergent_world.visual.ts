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
  npcsOccupyVariedPositions: Type.Boolean({
    description: 'Whether NPCs are distributed rather than frozen at spawn points',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt ───────────────────────────────────────────────────

const EMERGENT_WORLD_PROMPT = [
  'This is a screenshot from the Aikami emergent world integration test',
  '(/dev/sandbox/map?test_integration=true).',
  '',
  'A black badge in the top-left corner reads NPCS_MOVED:true or',
  'NPCS_MOVED:false — this is the TIME-SEPARATED movement result computed',
  'from two debug-bridge position samples 2s apart, NOT inferred from this',
  'single screenshot (CodeRabbit review, C-379).',
  '',
  'EXPECTED:',
  '- A PixiJS canvas showing a tilemap with characters (NPCs, guards, player).',
  '- After a crime tool action is streamed, nearby guard entities should show',
  '  alert visual indicators (red tint, exclamation marks, or combat wedges).',
  '- Pursuing entities should calculate A* paths around static blockages',
  '  (walls, buildings) — no straight-line clipping through walls.',
  '- Off-screen macro characters should maintain logical sector positions',
  '  without rendering anomalies or disappearing.',
  '- The full 6-step pipeline (ingestion → macro sim → perception →',
  '  cognition → navigation → resolution) should execute without frame drops',
  '  or rendering artifacts.',
  '',
  'EVALUATE:',
  '- Read the top-left badge: NPCS_MOVED:true → set npcsOccupyVariedPositions',
  '  to true; NPCS_MOVED:false → set it to false.',
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
      searchParams: { test_integration: 'true' },
      prompt: EMERGENT_WORLD_PROMPT,
      schema: EmergentWorldSchema,
      // Clip to the full canvas so the NPCS_MOVED badge (fixed at the
      // top-left) lands inside the screenshot — the default 256×256
      // center-crop would exclude it (CodeRabbit review, C-379).
      screenshotSelector: 'canvas',
      // C-379 AC-7: NPC movement is measured from TWO time-separated
      // debug-bridge position samples, not inferred from a single
      // screenshot. The result is rendered into a DOM badge the VLM reads
      // (CodeRabbit review, C-379).
      setupHook: async (page) => {
        const sample = (): Promise<Record<string, { x: number; y: number }>> =>
          page.evaluate(() => {
            const d = (window as any).__AIKAMI_DEBUG__ as // guard-ignore lint/type-safety/casting: custom window property for e2e hooks
              | { entityPositions?: Record<string, { x: number; y: number }> }
              | undefined;
            return d?.entityPositions ?? {};
          });
        const before = await sample();
        await page.waitForTimeout(2000);
        const after = await sample();
        const playerEid = await page.evaluate(() => {
          const d = (window as any).__AIKAMI_DEBUG__ as { playerEid?: number } | undefined; // guard-ignore lint/type-safety/casting: custom window property for e2e hooks
          return d?.playerEid ?? 0;
        });
        let npcMoved = false;
        for (const [eid, pos] of Object.entries(before)) {
          if (Number(eid) === playerEid) {
            continue;
          }
          const afterPos = after[eid];
          if (afterPos && (afterPos.x !== pos.x || afterPos.y !== pos.y)) {
            npcMoved = true;
            break;
          }
        }
        await page.evaluate((moved) => {
          const existing = document.getElementById('npcs-moved-badge');
          existing?.remove();
          const el = document.createElement('div');
          el.id = 'npcs-moved-badge';
          el.textContent = moved ? 'NPCS_MOVED:true' : 'NPCS_MOVED:false';
          el.style.cssText =
            'position:fixed;top:4px;left:4px;z-index:99999;background:#000;' +
            'color:#0f0;font:12px monospace;padding:2px 4px;';
          document.body.appendChild(el);
        }, npcMoved);
      },
    },
  ],
});
