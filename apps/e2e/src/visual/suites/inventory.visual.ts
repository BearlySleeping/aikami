// apps/e2e/src/visual/suites/inventory.visual.ts
// Inventory View — declarative visual test suite.
//
// Captures the /dev/inventory sandbox with junk items populated.
// Verifies item cards render without overflow, scrolling works,
// and the sticky header/close button remain accessible.
//
// Contract: C-218 — E2E Logic and UI Bug Resolution

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

// ── Schema ───────────────────────────────────────────────────

const InventorySchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  headerVisible: Type.Boolean({
    description: 'Whether "Inventory" header and close button are visible',
  }),
  itemCardsVisible: Type.Boolean({
    description: 'Whether item cards with names and descriptions are rendered',
  }),
  noOverflow: Type.Boolean({
    description:
      'Whether all content stays within the modal bounds (no items cut off, no horizontal overflow)',
  }),
  fillWithJunkButtonVisible: Type.Boolean({
    description: 'Whether the "Fill with Junk" dev action button is visible',
  }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

// ── Prompts ──────────────────────────────────────────────────

const INVENTORY_PROMPT = [
  'This is a screenshot of the Aikami Inventory overlay (/dev/inventory sandbox).',
  '',
  'EXPECTED LAYOUT:',
  '- Dark modal overlay with centered white card.',
  '- "Inventory" heading with close (✕) button in the top-right.',
  '- Grid of item cards below the header, each showing:',
  '  - Item name in bold.',
  '  - Item description text.',
  '  - Gold value badge.',
  '- Dev tools panel with "Fill with Junk" and "Clear Inventory" buttons.',
  '',
  'EVALUATE:',
  '- Is the "Inventory" header and close button visible?',
  '- Are item cards rendered with names and descriptions?',
  '- Does the content stay within the card bounds (no overflow)?',
  '- Is the dev tools panel with action buttons visible?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

const MOBILE_PROMPT = [
  'This is a mobile viewport (375×667) screenshot of the Aikami Inventory overlay.',
  '',
  'EXPECTED LAYOUT:',
  '- Inventory modal should fill the screen width.',
  '- Item cards should be scrollable without horizontal overflow.',
  '- Header and close button must be visible and not clipped.',
  '- Dev tools must be accessible at the bottom.',
  '',
  'EVALUATE:',
  '- Does the inventory modal fit within the mobile screen?',
  '- Are items scrollable without clipping?',
  '- Are all interactive elements (close button, action buttons) visible and tappable?',
  '',
  'Return ONLY valid JSON matching the schema.',
].join('\n');

// ── Setup hooks ──────────────────────────────────────────────

/**
 * Populates the inventory with junk items via the dev tools button.
 */
const setupFillJunk = async (page: import('playwright').Page): Promise<void> => {
  // Wait for the page to fully render
  await page.waitForSelector('h2:has-text("Inventory")', { timeout: 10_000 });

  // Click "Fill with Junk" dev action button
  const fillBtn = page.locator('button', { hasText: 'Fill with Junk' });
  await fillBtn.click();

  // Wait for items to populate
  await page.waitForTimeout(1000);

  // Verify items appeared
  await page.waitForSelector('.card-body', { timeout: 5000 });
};

/**
 * Sets mobile viewport size for responsive testing.
 */
const setupMobileViewport = async (page: import('playwright').Page): Promise<void> => {
  await page.setViewportSize({ width: 375, height: 667 });

  // Wait for the page to fully render
  await page.waitForSelector('h2:has-text("Inventory")', { timeout: 10_000 });

  // Click "Fill with Junk" dev action button
  const fillBtn = page.locator('button', { hasText: 'Fill with Junk' });
  await fillBtn.click();

  // Wait for items to populate
  await page.waitForTimeout(1000);
};

// ── Suite ────────────────────────────────────────────────────

export default defineConfig({
  id: 'inventory',
  route: '/dev/inventory',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'Inventory — Empty (Default Viewport)',
      prompt: INVENTORY_PROMPT,
      schema: InventorySchema,
    },
    {
      name: 'Inventory — Filled with Junk',
      prompt: INVENTORY_PROMPT,
      schema: InventorySchema,
      setupHook: setupFillJunk,
    },
    {
      name: 'Inventory — Mobile Viewport Filled',
      prompt: MOBILE_PROMPT,
      schema: InventorySchema,
      setupHook: setupMobileViewport,
    },
  ],
});
