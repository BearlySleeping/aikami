// apps/frontend/client/src/lib/views/game/ui/overlays/reputation/reputation_view_model.svelte.ts
//
// Reputation overlay ViewModel — displays faction standings and NPC
// relationships as a read-only status panel. No interactive controls
// (sliders, inputs, buttons to change standing) — purely informational.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/reputation_fixtures.ts).
// Production wiring lives in ./reputation_composition.ts.
//
// Contract: C-341 AC-4

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';

// ── Capability contracts ────────────────────────────────────────────────

/** The relationship state snapshot the panel renders. */
export type RelationshipStateSnapshot = {
  readonly factionStandings: Record<string, { readonly standing: number; readonly tier: string }>;
  readonly characterRelationships: Record<
    string,
    {
      readonly trust: number;
      readonly affinity: number;
      readonly relationshipType: string;
    }
  >;
};

/** The relationship read capability. */
export type ReputationRelationshipCapabilities = {
  serialize(): RelationshipStateSnapshot;
};

/** The overlay close capability. */
export type ReputationOverlayCapabilities = {
  closeReputation(): void;
};

// ── Types ───────────────────────────────────────────────────────────────

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

export type ReputationViewModelOptions = BaseViewModelOptions & {
  /** Relationship read capability. */
  relationship: ReputationRelationshipCapabilities;
  /** Overlay close capability. */
  overlay: ReputationOverlayCapabilities;
};

export type ReputationViewModelInterface = BaseViewModelInterface & {
  readonly factions: readonly ReputationFactionEntry[];
  readonly relationships: readonly ReputationNpcEntry[];
  readonly isEmpty: boolean;

  /** Close the overlay. */
  handleBackdropClick(event: MouseEvent): void;
  handleKeyDown(event: KeyboardEvent): void;
  close(): void;
};

// ── Helpers ─────────────────────────────────────────────────────────────

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

// ── Implementation ──────────────────────────────────────────────────────

class ReputationViewModel
  extends BaseViewModel<ReputationViewModelOptions>
  implements ReputationViewModelInterface
{
  private readonly _relationship: ReputationRelationshipCapabilities;
  private readonly _overlay: ReputationOverlayCapabilities;

  constructor(options: ReputationViewModelOptions) {
    super(options);
    this._relationship = options.relationship;
    this._overlay = options.overlay;
  }

  get factions(): readonly ReputationFactionEntry[] {
    return this._buildFactionEntries();
  }

  get relationships(): readonly ReputationNpcEntry[] {
    return this._buildNpcEntries();
  }

  get isEmpty(): boolean {
    return this.factions.length === 0 && this.relationships.length === 0;
  }

  /** Closes the overlay when the backdrop itself is clicked. */
  handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  /** Closes the overlay when Escape is pressed. */
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
    }
  }

  /** @inheritdoc */
  close(): void {
    this._overlay.closeReputation();
  }

  // ── Private helpers ────────────────────────────────────────────────

  /** Summarises faction standings for display. */
  private _buildFactionEntries(): ReputationFactionEntry[] {
    const state = this._relationship.serialize();
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
  }

  /** Summarises NPC relationships for display. */
  private _buildNpcEntries(): ReputationNpcEntry[] {
    const state = this._relationship.serialize();
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
  }
}

/**
 * Builds a reputation ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getReputationViewModel` in ./reputation_composition.ts.
 */
export const createReputationViewModel = (
  options: ReputationViewModelOptions,
): ReputationViewModelInterface => ReputationViewModel.create(options);
