// apps/e2e/src/visual/suites/combat.visual.ts
// Combat UI — declarative visual test suite.
//
// Port of combat_visual.spec.ts. Captures the combat overlay in
// various game states (initial, log-filled, low-hp, victory, defeat)
// using the /dev/combat sandbox with ?state= query params.
//
// Contract: C-166, C-164, C-145

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const CombatSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  combatUIVisible: Type.Boolean({ description: 'Whether the combat overlay/sidebar is rendered' }),
  hpBarsVisible: Type.Boolean({
    description: 'Whether HP bars for player and/or enemy are visible',
  }),
  actionButtonsVisible: Type.Boolean({
    description: 'Whether attack/defend/flee buttons are visible',
  }),
  layoutCorrect: Type.Boolean({
    description: 'Whether the split-screen or overlay layout is properly structured',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompt shared by all cases ───────────────────────────────

const COMBAT_PROMPT = [
  'This is a screenshot from the Aikami game combat UI (/dev/combat sandbox).',
  '',
  'EXPECTED ELEMENTS:',
  '- Combat sidebar or overlay with player and enemy HP bars.',
  '- Action buttons (Attack, Defend, Flee) or combat log entries.',
  '- Character stats display (HP, ATK, DEF, etc.).',
  '- Dark fantasy-themed styling with DaisyUI components.',
  '',
  'EVALUATE:',
  '- Is the combat UI rendered and visible?',
  '- Are HP bars present and displaying health values?',
  '- Are action buttons or combat log entries visible?',
  '- Is the layout structurally sound (no overlapping, no cut-off elements)?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── State-specific extra prompt text ─────────────────────────

const STATE_PROMPTS: Record<string, string> = {
  initial:
    'This should show the initial combat state — both characters at full HP with action buttons visible.',
  'log-filled': 'The combat log should have multiple entries showing attack/damage history.',
  'low-hp': 'The player HP bar should be critically low (red/danger zone).',
  victory: 'A victory banner or message should be visible indicating combat was won.',
  defeat: 'A defeat banner or game over message should be visible.',
};

// ── Suite ────────────────────────────────────────────────────

/**
 * Dynamic UI selectors to mask — streaming text indicators, AI
 * typing spinners, and particle overlays that are non-deterministic
 * and cause pixel-diff noise between test runs.
 */
const COMBAT_MASK_SELECTORS = [
  '.ai-typing-indicator',
  '.animate-pulse',
  '.loading',
  '[data-testid="streaming-text"]',
];

export default defineConfig({
  id: 'combat',
  route: '/dev/combat',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Combat — Initial State',
      searchParams: { state: 'initial' },
      prompt: [COMBAT_PROMPT, '', STATE_PROMPTS.initial].join('\n'),
      schema: CombatSchema,
      mask: COMBAT_MASK_SELECTORS,
    },
    {
      name: 'Combat — Log Filled',
      searchParams: { state: 'log-filled' },
      prompt: [COMBAT_PROMPT, '', STATE_PROMPTS['log-filled']].join('\n'),
      schema: CombatSchema,
      mask: COMBAT_MASK_SELECTORS,
    },
    {
      name: 'Combat — Low HP',
      searchParams: { state: 'low-hp' },
      prompt: [COMBAT_PROMPT, '', STATE_PROMPTS['low-hp']].join('\n'),
      schema: CombatSchema,
      mask: COMBAT_MASK_SELECTORS,
    },
    {
      name: 'Combat — Victory',
      searchParams: { state: 'victory' },
      prompt: [COMBAT_PROMPT, '', STATE_PROMPTS.victory].join('\n'),
      schema: CombatSchema,
      mask: COMBAT_MASK_SELECTORS,
    },
    {
      name: 'Combat — Defeat',
      searchParams: { state: 'defeat' },
      prompt: [COMBAT_PROMPT, '', STATE_PROMPTS.defeat].join('\n'),
      schema: CombatSchema,
      mask: COMBAT_MASK_SELECTORS,
    },
  ],
});
