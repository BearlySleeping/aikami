// apps/e2e/src/visual/suites/combat_enhancements.visual.ts
// C-234 Combat Enhancements — AI visual test suite
//
// Visual tests for the 5 new UI features in the combat-enhancements sandbox:
// - Dice quick menu
// - Initiative tracker
// - Turn tracker header
// - Enriched log entry
// - Full sandbox layout

import { Type } from '@sinclair/typebox';
import { defineConfig } from '$visual/core/config';

const CombatEnhancementsSchema = Type.Object({
  score: Type.Number({ description: '0–100 match score' }),
  elementsVisible: Type.Boolean({ description: 'Whether key UI elements are visible' }),
  issues: Type.Array(Type.String(), { description: 'Visual issues found' }),
});

export default defineConfig({
  id: 'combat-enhancements',
  route: '/dev/combat-enhancements',
  waitCondition: 'pixi_loaded',
  requiresAuth: false,
  cases: [
    {
      name: 'Full Sandbox Layout',
      searchParams: {},
      prompt: `Evaluate the combat enhancements dev sandbox page. It should show:
1. A heading "🎲 Combat Enhancements — Dev Sandbox"
2. Section 1: Dice Quick Menu with preset dice buttons (d4, d6, d8, d10, d12, d20, d100, 2d6) in a 4-column grid
3. Section 2: Initiative Tracker showing 3 combatants (Player, Goblin, Skeleton) with HP bars
4. Section 3: Turn Tracker Header showing "Your Turn"/"Enemy Turn" with action economy dots
5. Section 4: Enriched Combat Log with input field and test preset buttons
6. Section 5: Full Example section showing enriched log entries

Rate the overall layout, spacing, and readability. Check that the DaisyUI dark theme is applied correctly (bg-base-100 backgrounds, proper text contrast).`,
      schema: CombatEnhancementsSchema,
      setupHook: async (page) => {
        // Wait for the sandbox to render
        await page.waitForSelector('h1', { timeout: 10_000 });
        await page.waitForTimeout(500);
      },
    },
    {
      name: 'Dice Detail View',
      searchParams: {},
      prompt: `Focus on the Dice Quick Menu section (Section 1). It should show:
1. A header "🎲 Quick Dice"
2. A 4-column grid with 8 preset dice buttons: d4, d6, d8, d10, d12, d20, d100, 2d6
3. A text input for custom notation (placeholder "e.g. 3d8")
4. An "+Add" button next to the input

Rate layout, button sizing, and spacing. Buttons should use btn-outline btn-xs style with font-mono.`,
      schema: CombatEnhancementsSchema,
      setupHook: async (page) => {
        await page.waitForSelector('h1', { timeout: 10_000 });
        await page.waitForTimeout(300);
      },
    },
    {
      name: 'Initiative Tracker Detail',
      searchParams: {},
      prompt: `Focus on the Initiative Tracker section (Section 2). It should show:
1. A header with "⚔️ Initiative" and combatant count
2. A list of combatants sorted by initiative
3. Each combatant row shows: name, initiative value in parentheses, and an HP bar
4. The current turn combatant should have a highlighted (bg-primary/10) background
5. Defeated combatants should show "💀 Defeated" label and have reduced opacity

Rate layout clarity, visual hierarchy, and readability of the HP bars.`,
      schema: CombatEnhancementsSchema,
      setupHook: async (page) => {
        await page.waitForSelector('h1', { timeout: 10_000 });
        await page.waitForTimeout(300);
      },
    },
    {
      name: 'Enriched Log Entry Detail',
      searchParams: {},
      prompt: `Focus on the Enriched Combat Log section (Section 4). It should show:
1. An input field pre-filled with example combat log text
2. Below the input, the parsed enriched log entry with bolded dice value
3. Below that, a row of preset test buttons

The enriched entry should render:
- Bolded font-mono dice value
- Color-coded damage type label (like "slashing" in warning color)
- Damage value in brackets like "[12 dmg]"

Rate the rendering quality and readability of the enriched entry.`,
      schema: CombatEnhancementsSchema,
      setupHook: async (page) => {
        await page.waitForSelector('h1', { timeout: 10_000 });
        await page.waitForTimeout(300);
      },
    },
  ],
});
