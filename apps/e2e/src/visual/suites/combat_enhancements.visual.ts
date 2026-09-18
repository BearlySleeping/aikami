// apps/e2e/src/visual/suites/combat_enhancements.visual.ts
// C-234 Combat Enhancements — AI visual test suite
//
// REPOINTED (combat debug workspace consolidation): the deleted
// `/dev/combat-enhancements` sandbox is now the FIXTURES mode of the
// consolidated workspace. Fixture presets are UI-selected, so each case's
// `setupHook` drives `#combat-debug-fixture` and waits on the production
// components the deck renders.
//
// Visual coverage retained: dice queue badges, initiative tracker, turn
// tracker header, enriched log entry, and the full fixture layout.

import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const CombatEnhancementsSchema = Type.Object({
  score: Type.Number({ description: '0–100 match score' }),
  fixtureNoticeVisible: Type.Boolean({
    description: 'Whether the "Presentation fixture — no live simulation" notice is visible',
  }),
  elementsVisible: Type.Boolean({ description: 'Whether key UI elements are visible' }),
  issues: Type.Array(Type.String(), { description: 'Visual issues found' }),
});

/** Selects a fixture preset and waits for the fixture deck to settle. */
const selectPreset = (preset: string) => async (page: import('playwright').Page) => {
  await page.waitForSelector('[data-testid="combat-debug-fixture-notice"]', {
    state: 'visible',
    timeout: 30_000,
  });
  await page.selectOption('#combat-debug-fixture', preset);
  await page.waitForTimeout(500);
  await page.waitForSelector('.initiative-tracker', { state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
};

export default defineConfig({
  id: 'combat-enhancements',
  route: '/dev/combat',
  waitCondition: 'game_ready',
  requiresAuth: false,
  cases: [
    {
      name: 'Full Fixture Deck Layout',
      searchParams: { mode: 'fixtures' },
      prompt: `Evaluate the combat debug workspace's FIXTURES mode. It renders the
production combat-enhancement components from typed fixture projections — there
is NO live simulation, and a persistent banner says
"Presentation fixture — no live simulation".

It should show:
1. The workspace shell with the mode/scenario/seed/fault/fixture-preset toolbar
2. A prominent fixture notice banner
3. Section "Turn tracker" — the production TurnTrackerHeader with action-economy dots
4. Section "Initiative tracker (read-only fixture projection)" listing combatants with HP values
5. Section "Enriched combat log"
6. Section "Queued dice (read-only fixture projection)"
7. Section "Status effects"

Rate the overall layout, spacing, and readability. Check that the Aikami UI dark
theme is applied correctly (bg-base-100 backgrounds, proper text contrast) and
that the fixture notice is unmissable.`,
      schema: CombatEnhancementsSchema,
      setupHook: selectPreset('log-filled'),
    },
    {
      name: 'Dice Queue Detail View',
      searchParams: { mode: 'fixtures' },
      prompt: `Focus on the "Queued dice (read-only fixture projection)" section of the
fixtures deck. The dice-queue preset should show FIVE queued roll badges
spanning d4–d100 (Attack, Sneak Attack, Perception, Magic Missile, Wild Magic
Surge), each rendering its notation label and action label in a mono badge.

Rate layout, badge sizing, wrapping and spacing. Note that this is a READ-ONLY
projection — there must be no queue/remove/Roll-All controls.`,
      schema: CombatEnhancementsSchema,
      setupHook: selectPreset('dice-queue'),
    },
    {
      name: 'Initiative Tracker Detail',
      searchParams: { mode: 'fixtures' },
      prompt: `Focus on the "Initiative tracker (read-only fixture projection)" section.
It should show:
1. A header "⚔️ Initiative (N)"
2. A list of combatants sorted by initiative
3. Each row: name, initiative value in parentheses, and an HP bar
4. The current-turn combatant highlighted with a bg-primary/10 background and a "current" badge
5. Defeated combatants marked "Defeated" with reduced opacity

Rate layout clarity, visual hierarchy, and readability of the HP bars.`,
      schema: CombatEnhancementsSchema,
      setupHook: selectPreset('initial'),
    },
    {
      name: 'Enriched Log Entry Detail',
      searchParams: { mode: 'fixtures' },
      prompt: `Focus on the "Enriched combat log" section with the log-filled preset.
Each entry is a production EnrichedLogEntry and should render:
- Bolded font-mono dice value
- Colour-coded damage type label (e.g. "slashing" / "piercing" / "fire")
- Damage value in brackets like "[12 dmg]"
- Italicised target name
- Critical hits marked with a 🎯 badge

Rate the rendering quality, colour contrast, and readability of the enriched
entries.`,
      schema: CombatEnhancementsSchema,
      setupHook: selectPreset('log-filled'),
    },
    {
      name: 'Long Labels Stress',
      searchParams: { mode: 'fixtures' },
      prompt: `Focus on the fixture deck with the long-labels preset: overlong actor names
(60+ characters), verbose status-effect names, and long damage descriptions.
Nothing may overflow its container, overlap a neighbour, or be silently clipped
mid-word; wrapping and truncation must keep the layout readable.

Score below 90 if any text overflows its card or collides with another element.`,
      schema: CombatEnhancementsSchema,
      setupHook: selectPreset('long-labels'),
    },
  ],
});
