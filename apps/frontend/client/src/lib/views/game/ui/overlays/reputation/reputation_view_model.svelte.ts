// apps/frontend/client/src/lib/views/game/ui/overlays/reputation/reputation_view_model.svelte.ts
//
// Reputation overlay ViewModel — displays faction standings and NPC
// relationships as a read-only status panel. No interactive controls
// (sliders, inputs, buttons to change standing) — purely informational.
//
// Contract: C-341 AC-4

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { gameOverlayService, relationshipService } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Display entry for a faction standing row. */
export type ReputationFactionEntry = {
  id: string;
  name: string;
  standing: number;
  tier: string;
  tierLabel: string;
};

/** Display entry for an NPC relationship row. */
export type ReputationNpcEntry = {
  npcId: string;
  trust: number;
  affinity: number;
  relationshipType: string;
};

export type ReputationViewModelOptions = BaseViewModelOptions;

export type ReputationViewModelInterface = BaseViewModelInterface & {
  readonly factions: readonly ReputationFactionEntry[];
  readonly relationships: readonly ReputationNpcEntry[];
  readonly isEmpty: boolean;

  /** Close the overlay. */
  close(): void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIER_LABELS: Record<string, string> = {
  hostile: 'Hostile',
  unfriendly: 'Unfriendly',
  neutral: 'Neutral',
  friendly: 'Friendly',
  honored: 'Honored',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  ally: 'Ally',
  enemy: 'Enemy',
  friend: 'Friend',
  romantic: 'Romantic',
  neutral: 'Neutral',
  rival: 'Rival',
};

/** Summarises faction standings for display. */
const buildFactionEntries = (): ReputationFactionEntry[] => {
  // We read via serialize() to avoid direct Map access
  const state = relationshipService.serialize();
  const entries: ReputationFactionEntry[] = [];

  for (const [id, standing] of Object.entries(state.factionStandings)) {
    entries.push({
      id,
      name: id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      standing: standing.standing,
      tier: standing.tier,
      tierLabel: TIER_LABELS[standing.tier] ?? standing.tier,
    });
  }

  return entries.sort((a, b) => b.standing - a.standing);
};

/** Summarises NPC relationships for display. */
const buildNpcEntries = (): ReputationNpcEntry[] => {
  const state = relationshipService.serialize();
  const entries: ReputationNpcEntry[] = [];

  for (const [npcId, rel] of Object.entries(state.characterRelationships)) {
    entries.push({
      npcId,
      trust: rel.trust,
      affinity: rel.affinity,
      relationshipType: RELATIONSHIP_LABELS[rel.relationshipType] ?? rel.relationshipType,
    });
  }

  return entries.sort((a, b) => b.trust - a.trust);
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class ReputationViewModel
  extends BaseViewModel<ReputationViewModelOptions>
  implements ReputationViewModelInterface
{
  get factions(): readonly ReputationFactionEntry[] {
    return buildFactionEntries();
  }

  get relationships(): readonly ReputationNpcEntry[] {
    return buildNpcEntries();
  }

  get isEmpty(): boolean {
    return this.factions.length === 0 && this.relationships.length === 0;
  }

  /** @inheritdoc */
  close(): void {
    gameOverlayService.closeReputation();
  }
}

export const getReputationViewModel = (
  options: ReputationViewModelOptions,
): ReputationViewModelInterface => ReputationViewModel.create(options);
