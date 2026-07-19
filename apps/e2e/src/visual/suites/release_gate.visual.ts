// apps/e2e/src/visual/suites/release_gate.visual.ts
//
// Release Gate Visual Suite — full-journey screenshot checkpoints
// captured on the production /game route. Evaluates boot, dialogue,
// combat, post-reward HUD, and inventory states via AI.
//
// Contract: C-335 AC-7 — Visual Checkpoint Snapshots on Production Routes

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const ReleaseGateSchema = Type.Object({
  score: Type.Number({ description: '0-100 overall gate quality score' }),
  bootCompleted: Type.Boolean({
    description: 'Game booted to playing state with canvas and HUD visible',
  }),
  npcDialogueRendered: Type.Boolean({
    description: 'NPC dialogue overlay visible with authored text',
  }),
  combatTriggered: Type.Boolean({
    description: 'Combat UI visible with HP bars and action buttons',
  }),
  questRewardReceived: Type.Boolean({
    description: 'Quest reward notification or inventory item added',
  }),
  inventoryAccessible: Type.Boolean({
    description: 'Inventory overlay opens with items listed',
  }),
  saveIndicatorVisible: Type.Boolean({
    description: 'Autosave indicator or save confirmation visible',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

export type ReleaseGateResult = import('typebox').Static<typeof ReleaseGateSchema>;

// ── Prompts ──────────────────────────────────────────────────

const BOOT_COMPLETE_PROMPT = [
  'This is a screenshot of the Aikami game after booting to the production /game route.',
  '',
  'EXPECTED ELEMENTS:',
  '- The game canvas with a visible map or environment.',
  '- Player HUD in the bottom-left corner showing HP bar and player name.',
  '- Clock HUD in the top-right corner.',
  '- Quest tracker in the bottom-left area.',
  '- No loading overlay or error messages.',
  '',
  'EVALUATE:',
  '- Is the game canvas rendered with visible terrain/characters?',
  '- Are all HUD zones visible (HP, clock, quest tracker)?',
  '- Is there no loading text or error overlay?',
  '',
  'Score 90+: All HUD zones visible, canvas rendered, no errors.',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const HUD_VISIBLE_PROMPT = [
  'This is a screenshot of the Aikami game HUD during exploration.',
  '',
  'EXPECTED ELEMENTS:',
  '- Three HUD zones: HP bar (top-left), clock (top-right), objective (bottom-left).',
  '- HP bar shows a progress fill with current/max values.',
  '- Clock displays in-game time.',
  '- No HUD elements overlap each other.',
  '',
  'EVALUATE:',
  '- Are all three HUD zones visible and properly positioned?',
  '- Is the HP progress bar showing a valid fill level?',
  '- Are elements cleanly separated without overlap?',
  '',
  'Score 90+: All three zones visible, clean layout, no overlap.',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const DIALOGUE_ACTIVE_PROMPT = [
  'This is a screenshot of the Aikami dialogue overlay during NPC interaction.',
  '',
  'EXPECTED ELEMENTS:',
  '- Dialogue overlay with NPC name displayed prominently.',
  '- Authored reply text in the dialogue body area.',
  '- 2-4 distinct choice buttons below the NPC reply.',
  '- Proper dark fantasy-themed styling.',
  '',
  'EVALUATE:',
  '- Is the NPC name visible?',
  '- Is the authored reply text visible (not raw error strings)?',
  '- Are 2-4 choice buttons rendered?',
  '- Is the styling consistent (dark theme, readable text)?',
  '',
  'Score 85+: NPC name, reply text, 2-4 choices, no error strings.',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const COMBAT_ACTIVE_PROMPT = [
  'This is a screenshot of the Aikami combat UI during an active encounter.',
  '',
  'EXPECTED ELEMENTS:',
  '- Combat sidebar with player and enemy HP bars.',
  '- Action buttons: Attack, Defend, Flee.',
  '- Combat log with attack/damage entries.',
  '- Character stats display.',
  '- Dark fantasy-themed styling.',
  '',
  'EVALUATE:',
  '- Are HP bars visible with numeric values?',
  '- Are action buttons (Attack, Defend, Flee) rendered?',
  '- Is the combat log showing entries?',
  '- Is the layout structurally sound?',
  '',
  'Score 85+: HP bars, action buttons, combat log, no overlapping elements.',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const INVENTORY_OPEN_PROMPT = [
  'This is a screenshot of the Aikami inventory overlay opened on the production /game route.',
  '',
  'EXPECTED ELEMENTS:',
  '- Dark modal overlay with centered white card.',
  '- "Inventory" heading with close (✕) button.',
  '- Item cards with names, descriptions, and gold values.',
  '- Items do not overflow the card bounds.',
  '',
  'EVALUATE:',
  '- Is the Inventory header and close button visible?',
  '- Are item cards rendered without overflow?',
  '- Is the layout properly structured?',
  '',
  'Score 85+: Header visible, item cards rendered, no overflow.',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite ────────────────────────────────────────────────────

/**
 * Dynamic UI selectors to mask — streaming text indicators, AI
 * typing spinners, and particle overlays that are non-deterministic
 * and cause pixel-diff noise between test runs.
 */
const MASK_SELECTORS = [
  '.ai-typing-indicator',
  '.animate-pulse',
  '.loading',
  '[data-testid="streaming-text"]',
];

export default defineConfig({
  id: 'release-gate',
  route: '/game',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'release-gate-boot-complete',
      searchParams: { bypassTextAi: 'true' },
      prompt: BOOT_COMPLETE_PROMPT,
      schema: ReleaseGateSchema,
      mask: MASK_SELECTORS,
    },
    {
      name: 'release-gate-hud-visible',
      searchParams: { bypassTextAi: 'true' },
      prompt: HUD_VISIBLE_PROMPT,
      schema: ReleaseGateSchema,
      mask: MASK_SELECTORS,
    },
    {
      name: 'release-gate-dialogue-active',
      searchParams: { bypassTextAi: 'true' },
      prompt: DIALOGUE_ACTIVE_PROMPT,
      schema: ReleaseGateSchema,
      mask: MASK_SELECTORS,
    },
    {
      name: 'release-gate-combat-active',
      searchParams: { bypassTextAi: 'true' },
      prompt: COMBAT_ACTIVE_PROMPT,
      schema: ReleaseGateSchema,
      mask: MASK_SELECTORS,
    },
    {
      name: 'release-gate-inventory-open',
      searchParams: { bypassTextAi: 'true' },
      prompt: INVENTORY_OPEN_PROMPT,
      schema: ReleaseGateSchema,
      mask: MASK_SELECTORS,
    },
  ],
});
