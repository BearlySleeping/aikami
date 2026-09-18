// apps/e2e/tests/client/combat_enhancements.spec.ts
// C-234 Combat Enhancement: Dice & Initiative — E2E functional tests
//
// REPOINTED (combat debug workspace consolidation): the standalone
// `/dev/combat-enhancements` sandbox was DELETED and replaced by a 307 redirect
// to `/dev/combat?mode=fixtures`. Fixtures mode renders the SAME production
// components (TurnTrackerHeader, InitiativeTracker, EnrichedLogEntry,
// DiceQuickMenu) from typed fixture projections, with a persistent
// "Presentation fixture — no live simulation" banner.
//
// The dice QUEUE INTERACTION (queueing / removing / rolling / custom notation)
// belonged to the deleted sandbox's local state — the fixture projection is
// read-only (`Queued dice (read-only fixture projection)`), so those assertions
// are now PRESENTATION-ONLY and are tracked under the C-234 visual suite
// (`combat_enhancements.visual.ts`). What remains here is what the production
// components actually render.

import { expect, test } from '@playwright/test';
import { CombatDebugPage } from '$pom';

test.describe('Combat Enhancements — C-234 (fixtures mode)', () => {
  let debug: CombatDebugPage;

  test.beforeEach(async ({ page }) => {
    debug = new CombatDebugPage(page);
    await debug.gotoFixtures();
  });

  test.describe('Fixtures mode shell', () => {
    test('renders the persistent no-live-simulation notice', async () => {
      await debug.expectFixtureNotice();
    });

    test('renders the production turn tracker, initiative tracker and enriched log', async () => {
      await debug.expectFixtureDeck();
      await expect(debug.fixtureLogHeading).toBeVisible();
      await expect(debug.fixtureDiceHeading).toBeVisible();
    });

    test('does not boot an engine session in fixtures mode', async () => {
      await debug.expectNoLiveCanvas();
    });

    test('switches fixture presets via the workspace selector', async () => {
      await debug.expectFixturePreset('initial');
      await debug.setFixturePreset('dice-queue');
      await debug.expectFixturePreset('dice-queue');
      // The projection follows the selector: dice-queue authors five rolls.
      await expect(debug.fixtureDiceBadges).toHaveCount(5);
    });
  });

  // ── 1. Dice Quick Menu (fixture projection) ──

  test.describe('Dice Quick Menu', () => {
    test('renders the read-only queued-dice projection', async () => {
      await debug.setFixturePreset('dice-queue');
      await expect(debug.fixtureDiceHeading).toBeVisible();
      const badges = debug.fixtureDiceBadges;
      await expect(badges).toHaveCount(5);
      await expect(badges.first()).toContainText(/d\d+|d100/);
    });

    test('queued dice carry their notation label and action label', async () => {
      await debug.setFixturePreset('dice-queue');
      await expect(debug.fixtureDiceBadges.first()).toContainText('Attack');
    });
  });

  // ── 2. Initiative Tracker (fixture projection) ──

  test.describe('Initiative Tracker', () => {
    test('renders the production initiative tracker', async () => {
      await expect(debug.fixtureInitiativeTracker).toBeVisible();
    });

    test('shows combatant names and initiative values', async () => {
      await expect(debug.fixtureInitiativeTracker).toContainText('Initiative');
      await expect(debug.fixtureInitiativeTracker).toContainText('Player');
      await expect(debug.fixtureInitiativeTracker).toContainText('(Init:');
    });

    test('highlights the current-turn combatant', async () => {
      const currentEntry = debug.fixtureInitiativeTracker.locator('.bg-primary\\/10');
      await expect(currentEntry.first()).toBeVisible();
    });

    test('shows HP bars for alive combatants', async () => {
      const hpBars = debug.fixtureInitiativeTracker.locator('progress');
      await expect(hpBars.first()).toBeVisible();
    });

    test('shows the defeated state for defeated combatants', async () => {
      await debug.setFixturePreset('victory');
      await expect(debug.fixtureInitiativeTracker).toContainText('Defeated');
    });

    test('exposes a collapsible header', async () => {
      const header = debug.fixtureInitiativeTracker.locator('button').first();
      await expect(header).toBeVisible();
      await expect(header).toBeEnabled();
    });
  });

  // ── 3. Turn Tracker Header (fixture projection) ──

  test.describe('Turn Tracker Header', () => {
    test('renders the production turn-tracker header', async () => {
      await expect(debug.fixtureTurnTracker).toBeVisible();
    });

    test('shows "Your Turn" or "Enemy Turn" banner', async () => {
      await expect(debug.fixtureTurnTracker).toContainText(/Your Turn|Enemy Turn/);
    });

    test('shows the action economy dots', async () => {
      await expect(debug.fixtureTurnTracker).toContainText('Move');
      await expect(debug.fixtureTurnTracker).toContainText('Action');
      await expect(debug.fixtureTurnTracker).toContainText('Quick');
      await expect(debug.fixtureTurnTracker).toContainText('Reaction');
    });

    test('shows the turn number', async () => {
      await expect(debug.fixtureTurnTracker).toContainText(/Turn \d+/);
    });

    test('renders no End Turn control in the read-only fixture', async () => {
      const endTurn = debug.fixtureTurnTracker.getByRole('button', { name: 'End Turn' });
      await expect(endTurn).toBeDisabled();
    });
  });

  // ── 4. Enriched Combat Log (fixture projection) ──

  test.describe('Enriched Combat Log', () => {
    test('renders enriched log entries from the production component', async () => {
      await debug.setFixturePreset('log-filled');
      await expect(debug.fixtureEnrichedLogEntries.first()).toBeVisible();
    });

    test('bolds dice values in log entries', async () => {
      await debug.setFixturePreset('log-filled');
      const boldDice = debug.page.locator('.enriched-log-entry .font-bold.font-mono');
      await expect(boldDice.first()).toBeVisible();
    });

    test('colour-codes the damage type and shows the damage value', async () => {
      await debug.setFixturePreset('log-filled');
      const entries = debug.fixtureEnrichedLogEntries;
      await expect(entries.first()).toContainText(/slashing|piercing|fire/);
      await expect(entries.first()).toContainText(/\[\d+ dmg\]/);
    });
  });

  // ── 5. Replacement route (redirect) ──

  test.describe('Retired route redirect', () => {
    test('the legacy enhancements URL lands on fixtures mode', async () => {
      await debug.page.goto('/dev/combat-enhancements');
      await expect(debug.workspace).toBeVisible();
      await expect(debug.fixtureNotice).toBeVisible();
      await debug.expectUrlQuery({ mode: 'fixtures' });
    });
  });
});
