// apps/frontend/client/src/lib/views/game/ui/overlays/party_roster/testing/party_roster_reactive_fixtures.svelte.ts
//
// Reactive party-roster double for the real-Svelte (Vitest Browser Mode) lane.
// The member list is real `$state`, so a test can mutate it and observe the
// ViewModel's getters update.

import type { PartyRosterEntry } from '@aikami/types';
import type { PartyRosterCapabilities } from '../party_roster_view_model.svelte';

export type ReactivePartyRosterHarness = {
  /** The capability object to inject into the ViewModel. */
  roster: PartyRosterCapabilities;
  /** Replace the reactive member list. */
  setMembers(members: PartyRosterEntry[]): void;
};

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/**
 * Creates a party-roster double whose member list is real Svelte `$state`.
 */
export const createReactivePartyRosterHarness = (): ReactivePartyRosterHarness => {
  let members = $state<PartyRosterEntry[]>([]);

  const roster: PartyRosterCapabilities = {
    get members() {
      return members;
    },
    maxSize: 4,
    isEmpty: () => members.length === 0,
    dismiss: () => unconfigured('dismiss'),
  };

  return {
    roster,
    setMembers: (next) => {
      members = next;
    },
  };
};
