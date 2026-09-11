// apps/frontend/client/src/lib/views/game/ui/overlays/party_roster/testing/party_roster_fixtures.ts
//
// Feature-owned test doubles for the party-roster ViewModel. Operations are not
// defaulted to success: an unconfigured call throws, so a test cannot pass by
// accident on a silent no-op.

import type {
  PartyRosterCapabilities,
  PartyRosterEngineCapabilities,
  PartyRosterOverlayCapabilities,
} from '../party_roster_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Roster capability with no members until overridden. */
export const createPartyRoster = (
  overrides: Partial<PartyRosterCapabilities> = {},
): PartyRosterCapabilities => ({
  members: [],
  maxSize: 4,
  isEmpty: () => true,
  dismiss: () => unconfigured('dismiss'),
  ...overrides,
});

/** Engine capability whose operations throw until overridden. */
export const createPartyRosterEngine = (
  overrides: Partial<PartyRosterEngineCapabilities> = {},
): PartyRosterEngineCapabilities => ({
  getEntityIdForNpc: () => unconfigured('getEntityIdForNpc'),
  sendCommand: () => unconfigured('sendCommand'),
  ...overrides,
});

/** Overlay capability whose operations throw until overridden. */
export const createPartyRosterOverlay = (
  overrides: Partial<PartyRosterOverlayCapabilities> = {},
): PartyRosterOverlayCapabilities => ({
  openTalkToParty: () => unconfigured('openTalkToParty'),
  openCharacterDashboard: () => unconfigured('openCharacterDashboard'),
  closePartyRoster: () => unconfigured('closePartyRoster'),
  ...overrides,
});
