// apps/e2e/src/visual/suites/inventory.visual.ts
// Inventory View — declarative visual test suite.
//
// Captures the /dev/inventory sandbox with junk items populated.
// Verifies item cards render without overflow, scrolling works,
// and the sticky header/close button remain accessible.
//
// Contract: C-218 — E2E Logic and UI Bug Resolution, C-335 (production-route cases)

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';
import { EMULATOR_PORTS } from '../../config';

// ── Schema ───────────────────────────────────────────────────

const InventorySchema = Type.Object({
  score: Type.Number({ description: '0-100 score of visual correctness' }),
  headerVisible: Type.Boolean({
    description: 'Whether "Inventory" header and close button are visible',
  }),
  itemCardsVisible: Type.Boolean({
    description: 'Whether item cards with names and descriptions are rendered',
  }),
  equipCompareVisible: Type.Boolean({
    description: 'Whether stat compare deltas are visible near equippable items (C-331 AC-4)',
  }),
  useButtonVisible: Type.Boolean({
    description: 'Whether Use button is rendered on consumable items (C-331 AC-4)',
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

/** Opens the standalone inventory sandbox through its production toggle. */
const openInventorySandbox = async (page: import('playwright').Page): Promise<void> => {
  const openButton = page.getByRole('button', { name: 'Open Inventory', exact: true });
  if (await openButton.isVisible().catch(() => false)) {
    await openButton.click();
  }
  await page.getByTestId('inventory-overlay').waitFor({ state: 'visible', timeout: 10_000 });
};

/**
 * Populates the inventory with junk items via the dev tools button.
 */
const setupFillJunk = async (page: import('playwright').Page): Promise<void> => {
  await openInventorySandbox(page);

  // Click "Fill with Junk" dev action button
  const fillBtn = page.getByTestId('dev-action-fill-with-junk');
  await fillBtn.click();

  // Wait for items to populate
  await page.waitForTimeout(1000);

  // Verify items appeared
  await page.getByTestId('inventory-item-list').locator('li').first().waitFor({
    state: 'visible',
    timeout: 5000,
  });
};

/**
 * Sets mobile viewport size for responsive testing.
 */
const setupMobileViewport = async (page: import('playwright').Page): Promise<void> => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openInventorySandbox(page);

  // Click "Fill with Junk" dev action button
  const fillBtn = page.getByTestId('dev-action-fill-with-junk');
  await fillBtn.click();

  // Wait for items to populate
  await page.waitForTimeout(1000);
};

const MANAGEMENT_INVENTORY_PROMPT = [
  'This is the production /game Inventory management task, captured inside the single management workspace.',
  'Observe the equipment paperdoll, the carried bag, and the selected-item detail as one composition.',
  'For populated state, the player should be able to identify equipped gear, a selected bag item, its quantity, slot, attack/defense facts, and available Equip/Use actions.',
  'For empty state, the bag and detail regions should form a deliberate empty task state rather than a clipped grey strip.',
  'Report clipping, overlap, unreadable values, missing actions, or large unexplained blank regions.',
].join('\n');

const hideProductionDevTools = async (page: import('playwright').Page): Promise<void> => {
  await page.evaluate(() => {
    const panel = document.querySelector('button[title="Collapse Dev Tools"]')?.parentElement;
    if (panel) {
      panel.style.display = 'none';
    }
    const eruda = document.querySelector<HTMLElement>('#eruda');
    if (eruda) {
      eruda.style.display = 'none';
    }
  });
};

const openProductionInventory = async (
  page: import('playwright').Page,
  scenario: 'empty' | 'populated',
): Promise<void> => {
  await page.goto(`http://localhost:${EMULATOR_PORTS.client}/game`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByTestId('hud-menu-entry').waitFor({ state: 'visible', timeout: 30_000 });
  const renderer = await page.evaluate(() => {
    const app = (window as unknown as Record<string, unknown>).__PIXI_APP__ as
      | { renderer?: { name?: unknown } }
      | undefined;
    return typeof app?.renderer?.name === 'string' ? app.renderer.name : 'none';
  });
  if (renderer !== 'webgl') {
    throw new Error(`Expected WebGL renderer, received ${renderer}`);
  }
  await page.getByTestId('hud-menu-entry').click();
  await page.getByTestId('section-tab-inventory').click();
  await page.evaluate((contentScenario) => {
    const seam = (window as unknown as Record<string, unknown>).__AIKAMI_TEST__ as
      | {
          seedManagementContent(options: { scenario: 'empty' | 'populated' }): unknown;
        }
      | undefined;
    seam?.seedManagementContent({ scenario: contentScenario });
  }, scenario);
  await page.waitForTimeout(400);
  await hideProductionDevTools(page);
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
      screenshotSelector: '[data-testid="inventory-overlay"]',
      setupHook: openInventorySandbox,
    },
    {
      name: 'Inventory — Filled with Junk',
      prompt: INVENTORY_PROMPT,
      schema: InventorySchema,
      screenshotSelector: '[data-testid="inventory-overlay"]',
      setupHook: setupFillJunk,
    },
    {
      name: 'Inventory — Mobile Viewport Filled',
      prompt: MOBILE_PROMPT,
      schema: InventorySchema,
      screenshotSelector: '[data-testid="inventory-overlay"]',
      setupHook: setupMobileViewport,
    },
    // ── Production Route Case (C-335 AC-7) ────────────────
    {
      name: 'Inventory — Production Route',
      prompt: [
        INVENTORY_PROMPT,
        '',
        'Production /game route — inventory should be opened via keyboard shortcut.',
        'Item cards must render without overflow on the production game overlay.',
      ].join('\n'),
      schema: InventorySchema,
      setupHook: async (page) => {
        // Navigate to production route
        await page.goto('http://localhost:5274/game', {
          waitUntil: 'domcontentloaded',
        });
        // Wait for engine and HUD
        await page.waitForSelector('#game-canvas-container canvas', {
          state: 'attached',
          timeout: 30_000,
        });
        await page.waitForTimeout(3000);
        // Open inventory via 'I' key
        await page.keyboard.press('KeyI');
        await page.waitForTimeout(1000);
      },
    },
    {
      name: 'Inventory — Management Empty',
      prompt: MANAGEMENT_INVENTORY_PROMPT,
      schema: InventorySchema,
      screenshotSelector: '[data-testid="management-workspace"]',
      setupHook: (page) => openProductionInventory(page, 'empty'),
    },
    {
      name: 'Inventory — Management Populated',
      prompt: MANAGEMENT_INVENTORY_PROMPT,
      schema: InventorySchema,
      screenshotSelector: '[data-testid="management-workspace"]',
      setupHook: (page) => openProductionInventory(page, 'populated'),
    },
  ],
});
