// apps/frontend/client/src/browser_tests/party_roster.browser.test.ts
//
// Real-runes coverage for the migrated party-roster ViewModel. The Bun suite
// uses plain fixtures; this lane runs the ViewModel in Chromium with the real
// Svelte compiler against a reactive member list.

import type { PartyRosterEntry } from '@aikami/types';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createPartyRosterViewModel } from '../lib/views/game/ui/overlays/party_roster/party_roster_view_model.svelte';
import {
  createPartyRosterEngine,
  createPartyRosterOverlay,
} from '../lib/views/game/ui/overlays/party_roster/testing/party_roster_fixtures.ts';
import { createReactivePartyRosterHarness } from '../lib/views/game/ui/overlays/party_roster/testing/party_roster_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

const member: PartyRosterEntry = {
  npcId: 'lydia',
  name: 'Lydia',
  classId: 'cleric',
  level: 3,
  approval: 20,
  recruitedAt: '2026-01-01T00:00:00.000Z',
  personalQuestActive: false,
  equipmentSlotIds: [],
};

describe('PartyRosterViewModel — reactive members (real runes)', () => {
  test('members and isEmpty follow the reactive roster', () => {
    const harness = createReactivePartyRosterHarness();
    const viewModel = createPartyRosterViewModel({
      className: 'PartyRosterViewModel',
      roster: harness.roster,
      engine: createPartyRosterEngine({
        getEntityIdForNpc: () => undefined,
        sendCommand: () => {},
      }),
      overlay: createPartyRosterOverlay({ closePartyRoster: () => {} }),
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.members).toEqual([]);
    expect(viewModel.isEmpty).toBe(true);

    harness.setMembers([member]);
    flushSync();

    expect(viewModel.members).toHaveLength(1);
    expect(viewModel.isEmpty).toBe(false);
  });
});
