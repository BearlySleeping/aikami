// apps/frontend/client/src/lib/views/game/ui/overlays/reputation/testing/reputation_reactive_fixtures.svelte.ts
//
// Reactive reputation double for the real-Svelte (Vitest Browser Mode) lane.
// The relationship snapshot is real `$state`, so a test can mutate standings
// and observe the ViewModel's derived getters update.

import type {
  RelationshipStateSnapshot,
  ReputationOverlayCapabilities,
  ReputationRelationshipCapabilities,
} from '../reputation_view_model.svelte';

export type ReactiveReputationHarness = {
  /** The relationship read capability to inject. */
  relationship: ReputationRelationshipCapabilities;
  /** Inert overlay capability. */
  overlay: ReputationOverlayCapabilities;
  /** Replace the reactive relationship snapshot. */
  setSnapshot(snapshot: RelationshipStateSnapshot): void;
};

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/**
 * Creates a reputation double whose relationship snapshot is real Svelte
 * `$state`.
 */
export const createReactiveReputationHarness = (): ReactiveReputationHarness => {
  let snapshot = $state<RelationshipStateSnapshot>({
    factionStandings: {},
    characterRelationships: {},
  });

  const relationship: ReputationRelationshipCapabilities = {
    serialize: () => snapshot,
  };
  const overlay: ReputationOverlayCapabilities = {
    closeReputation: () => unconfigured('closeReputation'),
  };

  return {
    relationship,
    overlay,
    setSnapshot: (next) => {
      snapshot = next;
    },
  };
};
