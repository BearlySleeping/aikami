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
  readonly id: string;
  readonly name: string;
  readonly standing: number;
  readonly standingProgressValue: number;
  readonly standingLabel: string;
  readonly progressColor: string;
  readonly tier: string;
  readonly tierLabel: string;
  readonly tierColor: string;
};

/** Display entry for an NPC relationship row. */
export type ReputationNpcEntry = {
  readonly npcId: string;
  readonly trust: number;
  readonly trustProgressValue: number;
  readonly trustLabel: string;
  readonly trustProgressColor: string;
  readonly affinity: number;
  readonly affinityProgressValue: number;
  readonly affinityLabel: string;
  readonly affinityProgressColor: string;
  readonly relationshipType: string;
};

export type ReputationViewModelOptions = BaseViewModelOptions & {
  /** Relationship read capability. */
  relationship: ReputationRelationshipCapabilities;
  /** Overlay close capability. */
  overlay: ReputationOverlayCapabilities;
  presentation?: 'standalone' | 'management';
};

export type ReputationViewModelInterface = BaseViewModelInterface & {
  readonly factions: readonly ReputationFactionEntry[];
  readonly relationships: readonly ReputationNpcEntry[];
  readonly isEmpty: boolean;
  readonly overlayClass: string;
  readonly isStandalonePresentation: boolean;

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
  private readonly _presentation: 'standalone' | 'management';

  constructor(options: ReputationViewModelOptions) {
    super(options);
    this._relationship = options.relationship;
    this._overlay = options.overlay;
    this._presentation = options.presentation ?? 'standalone';
  }

  get overlayClass(): string {
    return 'pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm';
  }

  get isStandalonePresentation(): boolean {
    return this._presentation === 'standalone';
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
    if (this._presentation === 'standalone' && event.target === event.currentTarget) {
      this.close();
    }
  }

  /** Closes the overlay when Escape is pressed. */
  handleKeyDown(event: KeyboardEvent): void {
    if (this._presentation === 'standalone' && event.key === 'Escape') {
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
        standingProgressValue: standing.standing + 100,
        standingLabel: this._signedLabel(standing.standing),
        progressColor: this._progressColor(standing.standing),
        tier: standing.tier,
        tierLabel: TIER_LABELS[standing.tier] ?? standing.tier,
        tierColor: this._tierColor(standing.tier),
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
        trustProgressValue: rel.trust + 100,
        trustLabel: this._signedLabel(rel.trust),
        trustProgressColor: this._progressColor(rel.trust),
        affinity: rel.affinity,
        affinityProgressValue: rel.affinity + 100,
        affinityLabel: this._signedLabel(rel.affinity),
        affinityProgressColor: this._progressColor(rel.affinity),
        relationshipType: RELATIONSHIP_LABELS[rel.relationshipType] ?? rel.relationshipType,
      });
    }

    return entries.sort((a, b) => b.trust - a.trust);
  }

  private _tierColor(tier: string): string {
    const colors: Record<string, string> = {
      hostile: 'text-error',
      unfriendly: 'text-warning',
      neutral: 'text-base-content/60',
      friendly: 'text-success',
      honored: 'text-info',
    };
    return colors[tier] ?? '';
  }

  private _progressColor(value: number): string {
    if (value >= 60) {
      return 'progress-info';
    }
    if (value >= 20) {
      return 'progress-success';
    }
    if (value >= -20) {
      return 'progress-neutral';
    }
    if (value >= -60) {
      return 'progress-warning';
    }
    return 'progress-error';
  }

  private _signedLabel(value: number): string {
    return value > 0 ? `+${value}` : String(value);
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
