// apps/frontend/client/src/lib/services/game/relationship_service.svelte.ts
//
// Relationship service — owns faction standings, character relationships,
// and remembered promises. Feeds into dialogue context projection so AI NPCs
// react to player history, and provides the state model for the reputation UI.
//
// Contract: C-341 Add Relationships, Factions, Reputation, and Persistent Consequences

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type {
  CharacterRelationship,
  FactionDefinition,
  FactionStanding,
  FactionStandingTier,
  FactionStandingTierDefinition,
  RelationshipState,
  RememberedPromise,
} from '@aikami/types';
import { registerSerializable } from './serializable_service';

// ---------------------------------------------------------------------------
// Tier computation — exported for test use
// ---------------------------------------------------------------------------

/**
 * Computes the tier label for a given standing score + tier definitions.
 * Uses >= threshold comparison: the first tier whose threshold is ≤ current
 * standing wins. Returns 'neutral' if no tier matches (should not happen
 * with valid definitions).
 */
export const computeTier = (options: {
  standing: number;
  tiers: FactionStandingTierDefinition[];
}): FactionStandingTier => {
  // Tiers are sorted by threshold ascending — find the highest threshold ≤ standing
  let best: FactionStandingTier = 'neutral';
  for (const tier of options.tiers) {
    if (options.standing >= tier.threshold) {
      best = tier.tier;
    } else {
      break; // Remaining tiers have higher thresholds
    }
  }
  return best;
};

// ---------------------------------------------------------------------------
// Fact builders — transform state into compact prompt strings
// ---------------------------------------------------------------------------

const MAX_FACTS = 5;

/** Builds compact fact strings for dialogue context injection. */
export const buildFacts = (options: {
  standings: ReadonlyMap<string, FactionStanding>;
  relationships: ReadonlyMap<string, CharacterRelationship>;
  npcId: string;
  npcFactionId?: string;
}): string[] => {
  const facts: string[] = [];

  // Character relationship takes priority
  const rel = options.relationships.get(options.npcId);
  if (rel) {
    facts.push(
      `Your relationship with ${
        options.npcId
      }: Trust ${rel.trust}, Affinity ${rel.affinity} (${rel.relationshipType})`,
    );
  }

  // Faction standings (only meaningful ones — not neutral-at-0)
  for (const [factionId, standing] of options.standings) {
    if (factionId === options.npcFactionId || standing.standing !== 0) {
      if (facts.length >= MAX_FACTS) {
        break;
      }
      facts.push(`${factionId} standing: ${standing.tier} (${standing.standing})`);
    }
  }

  return facts.slice(0, MAX_FACTS);
};

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type RelationshipServiceInterface = BaseFrontendClassInterface & {
  /** Get current faction standing, initializing from content pack default if unseen. */
  getStanding(factionId: string): FactionStanding | undefined;
  /** Get current character relationship, initializing neutral if unseen. */
  getRelationship(characterId: string): CharacterRelationship | undefined;
  /** Apply a relationship delta command through the rules kernel. Returns the after-state. */
  applyDelta(options: {
    characterId: string;
    trustDelta: number;
    affinityDelta: number;
    eventDescription: string;
  }): { trustAfter: number; affinityAfter: number };
  /** Adjust faction standing directly. */
  adjustFactionStanding(options: {
    factionId: string;
    delta: number;
    reason: string;
  }): FactionStanding;
  /** Record a promise made to an NPC or faction. */
  recordPromise(options: { targetId: string; description: string }): RememberedPromise;
  /** Get all promises for a target. */
  getPromises(targetId: string): RememberedPromise[];
  /** Fulfill or break a promise. */
  resolvePromise(options: { promiseId: string; fulfilled: boolean }): void;
  /** Get compact fact strings for dialogue context injection. */
  getFacts(options: { npcId: string; npcFactionId?: string }): string[];
  /** Seed faction standings from content pack faction definitions. */
  seedFactions(factions: FactionDefinition[]): void;
  /** Serialize full state for save. */
  serialize(): RelationshipState;
  /** Deserialize full state on load. */
  deserialize(state: RelationshipState): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class RelationshipService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements RelationshipServiceInterface
{
  /** Faction standings keyed by faction ID. */
  private _factionStandings = $state<Map<string, FactionStanding>>(new Map());

  /** Character relationships keyed by character ID. */
  private _characterRelationships = $state<Map<string, CharacterRelationship>>(new Map());

  /** Active and resolved promises. */
  private _promises = $state<RememberedPromise[]>([]);

  /** Cached faction definitions for tier computation (initialized via seedFactions). */
  private _factionDefinitions: FactionDefinition[] = [];

  // ── Public API: faction standings ──────────────────────────────────────

  /** @inheritdoc */
  getStanding(factionId: string): FactionStanding | undefined {
    return this._factionStandings.get(factionId);
  }

  /** @inheritdoc */
  adjustFactionStanding(options: {
    factionId: string;
    delta: number;
    reason: string;
  }): FactionStanding {
    const existing = this._factionStandings.get(options.factionId);
    if (!existing) {
      // Initialize from faction definition defaults
      const def = this._factionDefinitions.find((f) => f.id === options.factionId);
      if (!def) {
        this.warn('adjustFactionStanding:unknown-faction', { factionId: options.factionId });
        // Create a neutral entry
        const standing: FactionStanding = {
          factionId: options.factionId,
          standing: 0,
          tier: 'neutral',
          lastChangedAt: new Date().toISOString(),
        };
        this._factionStandings.set(options.factionId, standing);
        return standing;
      }
    }

    const current = existing ?? {
      factionId: options.factionId,
      standing:
        this._factionDefinitions.find((f) => f.id === options.factionId)?.defaultStanding ?? 0,
      tier: 'neutral',
      lastChangedAt: new Date().toISOString(),
    };

    const newStanding = Math.max(-100, Math.min(100, current.standing + options.delta));
    const def = this._factionDefinitions.find((f) => f.id === options.factionId);
    const tier = def ? computeTier({ standing: newStanding, tiers: def.standingTiers }) : 'neutral';

    const updated: FactionStanding = {
      factionId: options.factionId,
      standing: newStanding,
      tier,
      lastChangedAt: new Date().toISOString(),
    };

    this._factionStandings.set(options.factionId, updated);
    this.debug('adjustFactionStanding', {
      factionId: options.factionId,
      delta: options.delta,
      before: current.standing,
      after: newStanding,
      tier,
      reason: options.reason,
    });

    return updated;
  }

  /** @inheritdoc */
  seedFactions(factions: FactionDefinition[]): void {
    this._factionDefinitions = factions;

    for (const def of factions) {
      // Only seed if not already initialized
      if (!this._factionStandings.has(def.id)) {
        const tier = computeTier({ standing: def.defaultStanding, tiers: def.standingTiers });
        this._factionStandings.set(def.id, {
          factionId: def.id,
          standing: def.defaultStanding,
          tier,
          lastChangedAt: new Date().toISOString(),
        });
      }
    }
    this.debug('seedFactions', { count: factions.length });
  }

  // ── Public API: character relationships ─────────────────────────────

  /** @inheritdoc */
  getRelationship(characterId: string): CharacterRelationship | undefined {
    return this._characterRelationships.get(characterId);
  }

  /** @inheritdoc */
  applyDelta(options: {
    characterId: string;
    trustDelta: number;
    affinityDelta: number;
    eventDescription: string;
  }): { trustAfter: number; affinityAfter: number } {
    const existing = this._characterRelationships.get(options.characterId);
    const currentTrust = existing?.trust ?? 0;
    const currentAffinity = existing?.affinity ?? 0;

    const trustAfter = Math.max(-100, Math.min(100, currentTrust + options.trustDelta));
    const affinityAfter = Math.max(-100, Math.min(100, currentAffinity + options.affinityDelta));

    const now = new Date().toISOString();

    const relationship: CharacterRelationship = {
      id: existing?.id ?? `rel_${options.characterId}_${Date.now()}`,
      uid: existing?.uid ?? '',
      characterId: options.characterId,
      relationshipType: existing?.relationshipType ?? 'neutral',
      trust: trustAfter,
      affinity: affinityAfter,
      history: [
        ...(existing?.history ?? []),
        {
          type: options.trustDelta >= 0 ? 'positive' : 'negative',
          description: options.eventDescription,
          timestamp: now,
        },
      ],
      notes: existing?.notes ?? '',
      updatedAt: now,
    };

    this._characterRelationships.set(options.characterId, relationship);
    this.debug('applyDelta', {
      characterId: options.characterId,
      trustBefore: currentTrust,
      trustAfter,
      affinityBefore: currentAffinity,
      affinityAfter,
      eventDescription: options.eventDescription,
    });

    return { trustAfter, affinityAfter };
  }

  // ── Public API: promises ────────────────────────────────────────────

  /** @inheritdoc */
  recordPromise(options: { targetId: string; description: string }): RememberedPromise {
    const promise: RememberedPromise = {
      id: `promise_${crypto.randomUUID()}`,
      targetId: options.targetId,
      description: options.description,
      madeAt: new Date().toISOString(),
      broken: false,
    };
    this._promises = [...this._promises, promise];
    this.debug('recordPromise', { targetId: options.targetId });
    return promise;
  }

  /** @inheritdoc */
  getPromises(targetId: string): RememberedPromise[] {
    return this._promises.filter((p) => p.targetId === targetId);
  }

  /** @inheritdoc */
  resolvePromise(options: { promiseId: string; fulfilled: boolean }): void {
    const idx = this._promises.findIndex((p) => p.id === options.promiseId);
    if (idx === -1) {
      this.warn('resolvePromise:not-found', { promiseId: options.promiseId });
      return;
    }

    const updated = { ...this._promises[idx] };
    if (options.fulfilled) {
      updated.fulfilledAt = new Date().toISOString();
      updated.broken = false;
    } else {
      updated.broken = true;
    }
    this._promises = [...this._promises.slice(0, idx), updated, ...this._promises.slice(idx + 1)];
    this.debug('resolvePromise', {
      promiseId: options.promiseId,
      fulfilled: options.fulfilled,
    });
  }

  // ── Public API: facts ───────────────────────────────────────────────

  /** @inheritdoc */
  getFacts(options: { npcId: string; npcFactionId?: string }): string[] {
    return buildFacts({
      standings: this._factionStandings,
      relationships: this._characterRelationships,
      npcId: options.npcId,
      npcFactionId: options.npcFactionId,
    });
  }

  // ── Public API: serialization ───────────────────────────────────────

  /** @inheritdoc */
  serialize(): RelationshipState {
    return {
      characterRelationships: Object.fromEntries(this._characterRelationships),
      factionStandings: Object.fromEntries(this._factionStandings),
      rememberedPromises: this._promises,
    };
  }

  /** @inheritdoc */
  deserialize(state: RelationshipState): void {
    if (!state) {
      this._characterRelationships = new Map();
      this._factionStandings = new Map();
      this._promises = [];
      return;
    }

    this._characterRelationships = new Map(Object.entries(state.characterRelationships ?? {}));
    this._factionStandings = new Map(Object.entries(state.factionStandings ?? {}));
    this._promises = state.rememberedPromises ?? [];
    this.debug('deserialize', {
      relationshipCount: this._characterRelationships.size,
      factionCount: this._factionStandings.size,
      promiseCount: this._promises.length,
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const relationshipService: RelationshipServiceInterface = RelationshipService.create({
  className: 'RelationshipService',
});

// Register for save/load persistence
registerSerializable(
  'relationship',
  relationshipService as unknown as import('./serializable_service').SerializableService<unknown>,
);
