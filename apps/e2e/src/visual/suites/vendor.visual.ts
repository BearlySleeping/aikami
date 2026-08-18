// apps/e2e/src/visual/suites/vendor.visual.ts
// Vendor View — declarative visual test suite.
//
// Captures the /dev/vendor sandbox showing buy-list, sell-list,
// gold display, and sell confirmation affordance.
//
// Contract: C-331 AC-3 — Sell section visual verification
// Contract: C-419 AC-3 — collapsed haggle panel until engaged
// Contract: C-419 AC-4 — item icons render content-pack art, 📦 last resort

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schemas ─────────────────────────────────────────────────

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

const CollapsedHaggleSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  hagglePanelCollapsed: Type.Boolean({
    description:
      'Whether the haggle panel is a slim minority of the layout (not ~50% of the screen)',
  }),
  startHaggleAffordanceVisible: Type.Boolean({
    description: 'Whether an obvious affordance to start haggling is visible',
  }),
  inventoryVisible: Type.Boolean({
    description: 'Whether the vendor inventory is still fully visible',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

const ItemArtSchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  itemArtVisible: Type.Boolean({
    description: 'Whether distinct item icons/art are visible for the vendor inventory items',
  }),
  noUniformBoxes: Type.Boolean({
    description:
      'Whether items are NOT all rendered with the same generic 📦 icon — distinct art across dissimilar items',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompts ─────────────────────────────────────────────────

const VENDOR_PROMPT = [
  'This is a screenshot of the Aikami Vendor overlay (/dev/vendor sandbox).',
  '',
  'EXPECTED LAYOUT:',
  '- Two-pane layout: left panel for AI chat/haggle, right panel for items.',
  '- Gold balance badge in the right panel header.',
  '- "For Sale" section listing vendor items with prices and Buy buttons.',
  '- "Sell Your Items" section below with player sellable items,',
  '  prices, and Sell buttons.',
  '- A sell confirmation dialog when a Sell button is clicked.',
  '',
  'EVALUATE with score 90+:',
  '- Are the buy-list and sell-list both visible with prices?',
  '- Is player gold visible?',
  '- Is a confirmation affordance (dialog or prompt) visible for selling?',
  '- No visual overflow or broken layout.',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const COLLAPSED_HAGGLE_PROMPT = [
  'This is a screenshot of the Aikami Vendor overlay (/dev/vendor sandbox)',
  'BEFORE any haggle conversation has started (C-419 AC-3).',
  '',
  'EXPECTED LAYOUT:',
  '- The haggle/chat panel is COLLAPSED to a slim minority of the layout',
  '  (a narrow strip, NOT a full half-width chat pane).',
  '- The vendor inventory (For Sale items with prices) is fully visible',
  '  and takes the majority of the screen.',
  '- An obvious affordance to start haggling is visible in the collapsed',
  '  strip (e.g. a 💬 "Start haggling" button).',
  '',
  'EVALUATE with score 90+:',
  '- Is the haggle panel a slim minority rather than ~50% of the screen?',
  '- Is the start-haggling affordance clearly visible?',
  '- Is the inventory still fully visible and usable?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const ITEM_ART_PROMPT = [
  'This is a screenshot of the Aikami Vendor overlay (/dev/vendor sandbox)',
  'showing the For Sale inventory grid (C-419 AC-4).',
  '',
  'EXPECTED LAYOUT:',
  '- Each inventory item card shows a DISTINCT icon/art for its item',
  '  (swords, shields, armor, potions — pixel-art sprites).',
  '- Items are NOT all rendered with the same generic 📦 emoji.',
  '- Item names, prices and Buy buttons remain visible and readable.',
  '',
  'EVALUATE with score 90+:',
  '- Is distinct item art visible across dissimilar items?',
  '- Are there no uniform generic box icons across all items?',
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
    {
      name: 'Vendor — Collapsed haggle panel (C-419 AC-3)',
      prompt: COLLAPSED_HAGGLE_PROMPT,
      schema: CollapsedHaggleSchema,
      screenshotSelector: 'body',
    },
    {
      name: 'Vendor — Item art in For Sale grid (C-419 AC-4)',
      prompt: ITEM_ART_PROMPT,
      schema: ItemArtSchema,
      // Expand the haggle panel so the items grid is the focus and the
      // collapsed strip does not dominate the frame.
      setupHook: async (page) => {
        const expand = page.getByRole('button', {
          name: /start a conversation to haggle/i,
        });
        if ((await expand.count()) > 0) {
          await expand.first().click();
        }
        await page.waitForTimeout(500);
      },
    },
  ],
});
