// apps/frontend/client/src/lib/views/game/ui/overlays/reputation/reputation_view_model.test.ts
//
// Unit tests for ReputationViewModel — faction/relationship derivation and
// close behavior. Exercises the ViewModel through feature-owned fixtures — no
// global `$services` barrel mock.
//
// Contract: C-341 AC-4

// biome-ignore-all lint/style/useNamingConvention: faction/relationship ids are snake_case domain identifiers

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  createReputationViewModel,
  type ReputationOverlayCapabilities,
} from './reputation_view_model.svelte';
import {
  createRelationshipSnapshot,
  createReputationOverlay,
  createReputationRelationship,
  type RelationshipStateSnapshot,
} from './testing/reputation_fixtures.ts';

const createViewModel = (
  snapshot: RelationshipStateSnapshot = createRelationshipSnapshot(),
  overlay: ReputationOverlayCapabilities = createReputationOverlay(),
) =>
  createReputationViewModel({
    className: 'ReputationViewModelTest',
    relationship: createReputationRelationship(snapshot),
    overlay,
  });

describe('ReputationViewModel — derivation', () => {
  test('is empty with no standings or relationships', () => {
    const viewModel = createViewModel();

    expect(viewModel.factions).toEqual([]);
    expect(viewModel.relationships).toEqual([]);
    expect(viewModel.isEmpty).toBe(true);
  });

  test('summarises faction standings, humanised and sorted by standing', () => {
    const viewModel = createViewModel(
      createRelationshipSnapshot({
        factionStandings: {
          iron_guild: { standing: 20, tier: 'friendly' },
          shadow_court: { standing: -40, tier: 'hostile' },
          emberwatch: { standing: 60, tier: 'honored' },
        },
      }),
    );

    expect(viewModel.factions.map((entry) => entry.id)).toEqual([
      'emberwatch',
      'iron_guild',
      'shadow_court',
    ]);
    expect(viewModel.factions[0]).toMatchObject({
      id: 'emberwatch',
      name: 'Emberwatch',
      tierLabel: 'Honored',
    });
    expect(viewModel.factions[2].tierLabel).toBe('Hostile');
    expect(viewModel.isEmpty).toBe(false);
  });

  test('falls back to the raw tier when unknown', () => {
    const viewModel = createViewModel(
      createRelationshipSnapshot({
        factionStandings: { mystery: { standing: 1, tier: 'unknowable' } },
      }),
    );

    expect(viewModel.factions[0].tierLabel).toBe('unknowable');
  });

  test('summarises relationships, labelled and sorted by trust', () => {
    const viewModel = createViewModel(
      createRelationshipSnapshot({
        characterRelationships: {
          npcA: { trust: 10, affinity: 5, relationshipType: 'friend' },
          npcB: { trust: 50, affinity: 1, relationshipType: 'ally' },
        },
      }),
    );

    expect(viewModel.relationships.map((entry) => entry.npcId)).toEqual(['npcB', 'npcA']);
    expect(viewModel.relationships[0].relationshipType).toBe('Ally');
    expect(viewModel.relationships[1].relationshipType).toBe('Friend');
  });
});

describe('ReputationViewModel — close behavior', () => {
  test('close delegates to the overlay capability', () => {
    const closeReputation = mock(() => {});
    const viewModel = createViewModel(
      createRelationshipSnapshot(),
      createReputationOverlay({ closeReputation }),
    );

    viewModel.close();

    expect(closeReputation).toHaveBeenCalledTimes(1);
  });

  test('backdrop click closes only when the backdrop itself is the target', () => {
    const closeReputation = mock(() => {});
    const viewModel = createViewModel(
      createRelationshipSnapshot(),
      createReputationOverlay({ closeReputation }),
    );
    const backdrop = {} as EventTarget;

    viewModel.handleBackdropClick({ target: backdrop, currentTarget: backdrop } as MouseEvent);
    expect(closeReputation).toHaveBeenCalledTimes(1);

    viewModel.handleBackdropClick({ target: {}, currentTarget: {} } as MouseEvent);
    expect(closeReputation).toHaveBeenCalledTimes(1);
  });

  test('Escape closes, other keys do not', () => {
    const closeReputation = mock(() => {});
    const viewModel = createViewModel(
      createRelationshipSnapshot(),
      createReputationOverlay({ closeReputation }),
    );

    viewModel.handleKeyDown({ key: 'Enter' } as KeyboardEvent);
    expect(closeReputation).not.toHaveBeenCalled();

    viewModel.handleKeyDown({ key: 'Escape' } as KeyboardEvent);
    expect(closeReputation).toHaveBeenCalledTimes(1);
  });
});

describe('ReputationViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
