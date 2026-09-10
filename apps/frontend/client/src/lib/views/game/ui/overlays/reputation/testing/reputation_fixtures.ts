// apps/frontend/client/src/lib/views/game/ui/overlays/reputation/testing/reputation_fixtures.ts
//
// Feature-owned test doubles for the reputation ViewModel. Operations are not
// defaulted to success: an unconfigured call throws, so a test cannot pass by
// accident on a silent no-op.

import type {
  RelationshipStateSnapshot,
  ReputationOverlayCapabilities,
  ReputationRelationshipCapabilities,
} from '../reputation_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** An empty relationship snapshot until overridden. */
export const createRelationshipSnapshot = (
  overrides: Partial<RelationshipStateSnapshot> = {},
): RelationshipStateSnapshot => ({
  factionStandings: {},
  characterRelationships: {},
  ...overrides,
});

/** Relationship read capability returning a fixed snapshot. */
export const createReputationRelationship = (
  snapshot: RelationshipStateSnapshot = createRelationshipSnapshot(),
): ReputationRelationshipCapabilities => ({
  serialize: () => snapshot,
});

/** Overlay capability whose close throws until overridden. */
export const createReputationOverlay = (
  overrides: Partial<ReputationOverlayCapabilities> = {},
): ReputationOverlayCapabilities => ({
  closeReputation: () => unconfigured('closeReputation'),
  ...overrides,
});
