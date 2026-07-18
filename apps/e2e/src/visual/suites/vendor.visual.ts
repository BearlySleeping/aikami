// apps/e2e/src/visual/suites/vendor.visual.ts
// Vendor View — declarative visual test suite.
//
// Captures the /dev/vendor sandbox showing buy-list, sell-list,
// gold display, and sell confirmation affordance.
//
// Contract: C-331 AC-3 — Sell section visual verification

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const VendorSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  buyListVisible: Type.Boolean({
    description: 'Whether the vendor buy list with prices is rendered',
  }),
  sellListVisible: Type.Boolean({
    description: 'Whether the player sell list with prices is rendered (C-331 AC-3)',
  }),
  goldVisible: Type.Boolean({
    description: 'Whether player gold balance is visible in the header',
  }),
  confirmationVisible: Type.Boolean({
    description: 'Whether a sell confirmation affordance is present',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompts ──────────────────────────────────────────────────

const VENDOR_PROMPT = [
  'This is a screenshot of the Aikami Vendor overlay (/dev/vendor sandbox).',
  '',
  'EXPECTED LAYOUT:',
  '- Two-pane layout: left panel for AI chat/haggle, right panel for items.',
  '- Gold balance badge in the right panel header.',
  '- "For Sale" section listing vendor items with prices and Buy buttons.',
  '- "Sell Your Items" section below with player sellable items,',
  '  prices, and Sell buttons.',
  '- A sell confirmation dialog when a Sell button is clicked (optional).',
  '',
  'EVALUATE with score 90+:',
  '- Are the buy-list and sell-list both visible with prices?',
  '- Is player gold visible?',
  '- Is a confirmation affordance (dialog or prompt) present for selling?',
  '- No visual overflow or broken layout.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'vendor',
  route: '/dev/vendor',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'Vendor — Buy + Sell lists with sell confirmation',
      prompt: VENDOR_PROMPT,
      schema: VendorSchema,
    },
  ],
});
