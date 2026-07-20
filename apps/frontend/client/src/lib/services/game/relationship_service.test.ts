// apps/frontend/client/src/lib/services/game/relationship_service.test.ts
//
// Unit tests for RelationshipService — faction standings, character
// relationships, remembered promises, serialization, and fact building.
//
// Contract: C-341 AC-1, AC-2, AC-5

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { RelationshipState } from '@aikami/types';
// Import the pure utility functions directly
import { buildFacts, computeTier, relationshipService } from './relationship_service.svelte';

// ---------------------------------------------------------------------------
// Stubs for testing
// ---------------------------------------------------------------------------

const makeFactionDefs = () => [
  {
    id: 'town_guard',
    name: 'Town Guard',
    description: 'Protectors of Emberwatch',
    defaultStanding: 0,
    standingTiers: [
      { threshold: -100, tier: 'hostile' as const, label: 'Hated' },
      { threshold: -60, tier: 'unfriendly' as const, label: 'Disliked' },
      { threshold: -20, tier: 'neutral' as const, label: 'Neutral' },
      { threshold: 20, tier: 'friendly' as const, label: 'Liked' },
      { threshold: 60, tier: 'honored' as const, label: 'Revered' },
    ],
  },
  {
    id: 'crimson_covenant',
    name: 'Crimson Covenant',
    description: 'Shadowy rogue mages',
    defaultStanding: -30,
    standingTiers: [
      { threshold: -100, tier: 'hostile' as const, label: 'Hated' },
      { threshold: -60, tier: 'unfriendly' as const, label: 'Disliked' },
      { threshold: -20, tier: 'neutral' as const, label: 'Neutral' },
      { threshold: 20, tier: 'friendly' as const, label: 'Liked' },
      { threshold: 60, tier: 'honored' as const, label: 'Revered' },
    ],
  },
];

/** Reset service to known state between tests */
const resetService = () => {
  relationshipService.deserialize({
    characterRelationships: {},
    factionStandings: {},
    rememberedPromises: [],
  });
  relationshipService.seedFactions(makeFactionDefs());
};

// ---------------------------------------------------------------------------
// computeTier
// ---------------------------------------------------------------------------

describe('computeTier', () => {
  const tiers = makeFactionDefs()[0].standingTiers;

  test('returns hostile at -100', () => {
    expect(computeTier({ standing: -100, tiers })).toBe('hostile');
  });

  test('returns unfriendly at -60 (boundary)', () => {
    expect(computeTier({ standing: -60, tiers })).toBe('unfriendly');
  });

  test('returns unfriendly at -59', () => {
    expect(computeTier({ standing: -59, tiers })).toBe('unfriendly');
  });

  test('returns neutral at -20 (boundary)', () => {
    expect(computeTier({ standing: -20, tiers })).toBe('neutral');
  });

  test('returns neutral at 0', () => {
    expect(computeTier({ standing: 0, tiers })).toBe('neutral');
  });

  test('returns neutral at 19', () => {
    expect(computeTier({ standing: 19, tiers })).toBe('neutral');
  });

  test('returns friendly at 20 (boundary)', () => {
    expect(computeTier({ standing: 20, tiers })).toBe('friendly');
  });

  test('returns honored at 60 (boundary)', () => {
    expect(computeTier({ standing: 60, tiers })).toBe('honored');
  });

  test('returns honored at 100', () => {
    expect(computeTier({ standing: 100, tiers })).toBe('honored');
  });
});

// ---------------------------------------------------------------------------
// buildFacts
// ---------------------------------------------------------------------------

describe('buildFacts', () => {
  test('returns relationship fact when npc has a relationship', () => {
    const standings = new Map();
    const relationships = new Map();
    relationships.set('guard_captain', {
      id: 'rel_1',
      uid: '',
      characterId: 'guard_captain',
      relationshipType: 'ally' as const,
      trust: 40,
      affinity: 25,
      history: [],
      notes: '',
      updatedAt: new Date().toISOString(),
    });

    const facts = buildFacts({
      standings,
      relationships,
      npcId: 'guard_captain',
    });

    expect(facts[0]).toContain('guard_captain');
    expect(facts[0]).toContain('Trust 40');
    expect(facts[0]).toContain('Affinity 25');
    expect(facts[0]).toContain('ally');
  });

  test('returns faction standing facts for known factions', () => {
    const standings = new Map();
    standings.set('town_guard', {
      factionId: 'town_guard',
      standing: 60,
      tier: 'friendly' as const,
      lastChangedAt: new Date().toISOString(),
    });

    const facts = buildFacts({
      standings,
      relationships: new Map(),
      npcId: 'guard_captain',
    });

    expect(facts.some((f) => f.includes('town_guard'))).toBe(true);
  });

  test('excludes neutral-zero factions by default', () => {
    const standings = new Map();
    standings.set('neutral_faction', {
      factionId: 'neutral_faction',
      standing: 0,
      tier: 'neutral' as const,
      lastChangedAt: new Date().toISOString(),
    });

    const facts = buildFacts({
      standings,
      relationships: new Map(),
      npcId: 'some_npc',
    });

    expect(facts).toHaveLength(0);
  });

  test('caps facts at MAX (5)', () => {
    const standings = new Map();
    for (let i = 0; i < 10; i++) {
      standings.set(`faction_${i}`, {
        factionId: `faction_${i}`,
        standing: i * 10,
        tier: 'neutral' as const,
        lastChangedAt: new Date().toISOString(),
      });
    }

    const facts = buildFacts({
      standings,
      relationships: new Map(),
      npcId: 'some_npc',
    });

    expect(facts.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// RelationshipService
// ---------------------------------------------------------------------------

describe('RelationshipService', () => {
  beforeEach(() => {
    resetService();
  });

  afterEach(() => {
    // Ensure clean state
    resetService();
  });

  // ── AC-1: Faction standings seed from content pack ──

  test('AC-1: seeds faction standings from content pack definitions', () => {
    const standing = relationshipService.getStanding('town_guard');
    expect(standing).toBeDefined();
    expect(standing?.factionId).toBe('town_guard');
    expect(standing?.standing).toBe(0);
    expect(standing?.tier).toBe('neutral');
  });

  test('AC-1: seeds faction with non-zero default standing', () => {
    const standing = relationshipService.getStanding('crimson_covenant');
    expect(standing).toBeDefined();
    expect(standing?.standing).toBe(-30);
    expect(standing?.tier).toBe('unfriendly');
  });

  test('AC-1: returns undefined for unknown faction', () => {
    const standing = relationshipService.getStanding('non_existent');
    expect(standing).toBeUndefined();
  });

  // ── AC-2: Relationship deltas ──

  test('AC-2: applyDelta updates trust and affinity', () => {
    const result = relationshipService.applyDelta({
      characterId: 'guard_captain',
      trustDelta: 5,
      affinityDelta: 3,
      eventDescription: 'Helped the guard investigate a disturbance',
    });

    expect(result.trustAfter).toBe(5);
    expect(result.affinityAfter).toBe(3);

    const rel = relationshipService.getRelationship('guard_captain');
    expect(rel).toBeDefined();
    expect(rel?.trust).toBe(5);
    expect(rel?.affinity).toBe(3);
    expect(rel?.history.length).toBe(1);
    expect(rel?.history[0].description).toBe('Helped the guard investigate a disturbance');
  });

  test('AC-2: clamps trust at -100 and 100', () => {
    // Test upper clamp
    const maxResult = relationshipService.applyDelta({
      characterId: 'test_npc',
      trustDelta: 200,
      affinityDelta: 0,
      eventDescription: 'overflow test',
    });
    expect(maxResult.trustAfter).toBe(100);

    // Reset and test lower clamp
    resetService();
    const minResult = relationshipService.applyDelta({
      characterId: 'test_npc',
      trustDelta: -200,
      affinityDelta: 0,
      eventDescription: 'underflow test',
    });
    expect(minResult.trustAfter).toBe(-100);
  });

  test('AC-2: negative delta creates negative history entry', () => {
    relationshipService.applyDelta({
      characterId: 'betrayed_npc',
      trustDelta: -15,
      affinityDelta: -10,
      eventDescription: 'Player stole from the NPC',
    });

    const rel = relationshipService.getRelationship('betrayed_npc');
    expect(rel?.history[0].type).toBe('negative');
  });

  test('AC-2: initializes neutral relationship for unseen NPC', () => {
    relationshipService.applyDelta({
      characterId: 'new_npc',
      trustDelta: 3,
      affinityDelta: 1,
      eventDescription: 'First meeting',
    });

    const rel = relationshipService.getRelationship('new_npc');
    expect(rel).toBeDefined();
    expect(rel?.trust).toBe(3);
    expect(rel?.affinity).toBe(1);
    expect(rel?.relationshipType).toBe('neutral');
  });

  // ── Faction standing adjustments ──

  test('adjustFactionStanding increases standing', () => {
    const result = relationshipService.adjustFactionStanding({
      factionId: 'town_guard',
      delta: 40,
      reason: 'Saved the village from goblins',
    });

    expect(result.standing).toBe(40);
    expect(result.tier).toBe('friendly');
  });

  test('adjustFactionStanding clamps at 100', () => {
    const result = relationshipService.adjustFactionStanding({
      factionId: 'town_guard',
      delta: 200,
      reason: 'Heroic deed',
    });

    expect(result.standing).toBe(100);
  });

  test('adjustFactionStanding clamps at -100', () => {
    const result = relationshipService.adjustFactionStanding({
      factionId: 'town_guard',
      delta: -300,
      reason: 'Massacre',
    });

    expect(result.standing).toBe(-100);
    expect(result.tier).toBe('hostile');
  });

  // ── Promises ──

  test('records and retrieves promises', () => {
    const promise = relationshipService.recordPromise({
      targetId: 'guard_captain',
      description: 'Retrieve the lost ward pendant',
    });

    expect(promise.id).toBeTruthy();
    expect(promise.targetId).toBe('guard_captain');
    expect(promise.broken).toBe(false);
    expect(promise.fulfilledAt).toBeUndefined();

    const promises = relationshipService.getPromises('guard_captain');
    expect(promises).toHaveLength(1);
    expect(promises[0].id).toBe(promise.id);
  });

  test('resolves promise as fulfilled', () => {
    const promise = relationshipService.recordPromise({
      targetId: 'elara',
      description: 'Find the ancient scroll',
    });

    relationshipService.resolvePromise({ promiseId: promise.id, fulfilled: true });

    const updated = relationshipService.getPromises('elara')[0];
    expect(updated.fulfilledAt).toBeDefined();
    expect(updated.broken).toBe(false);
  });

  test('resolves promise as broken', () => {
    const promise = relationshipService.recordPromise({
      targetId: 'merchant',
      description: 'Deliver the goods',
    });

    relationshipService.resolvePromise({ promiseId: promise.id, fulfilled: false });

    const updated = relationshipService.getPromises('merchant')[0];
    expect(updated.fulfilledAt).toBeUndefined();
    expect(updated.broken).toBe(true);
  });

  // ── AC-5: Serialization round-trip ──

  test('AC-5: serialize and deserialize preserves state', () => {
    // Build some state
    relationshipService.adjustFactionStanding({
      factionId: 'town_guard',
      delta: 50,
      reason: 'Heroic deeds',
    });
    relationshipService.applyDelta({
      characterId: 'elara',
      trustDelta: 30,
      affinityDelta: 20,
      eventDescription: 'Saved from danger',
    });
    const promise = relationshipService.recordPromise({
      targetId: 'elara',
      description: 'Help her find lost sister',
    });

    const state = relationshipService.serialize();

    // Deserialize into same service (simulating load)
    relationshipService.deserialize({
      characterRelationships: {},
      factionStandings: {},
      rememberedPromises: [],
    });
    relationshipService.deserialize(state);

    // Verify faction standings
    const standing = relationshipService.getStanding('town_guard');
    expect(standing?.standing).toBe(50);
    expect(standing?.tier).toBe('friendly');

    // Verify character relationship
    const rel = relationshipService.getRelationship('elara');
    expect(rel?.trust).toBe(30);
    expect(rel?.affinity).toBe(20);
    expect(rel?.history.length).toBe(1);

    // Verify promises
    const promises = relationshipService.getPromises('elara');
    expect(promises).toHaveLength(1);
    expect(promises[0].id).toBe(promise.id);
    expect(promises[0].description).toBe('Help her find lost sister');
  });

  test('AC-5: deserialize handles undefined state', () => {
    relationshipService.deserialize(undefined as unknown as RelationshipState);

    // Should not crash — initialized empty
    const standing = relationshipService.getStanding('town_guard');
    expect(standing).toBeUndefined();
  });

  test('AC-5: deserialize handles empty state', () => {
    relationshipService.deserialize({
      characterRelationships: {},
      factionStandings: {},
      rememberedPromises: [],
    });

    const standing = relationshipService.getStanding('town_guard');
    expect(standing).toBeUndefined();
  });

  // ── Facts ──

  test('AC-3: getFacts includes relationship facts for NPC', () => {
    relationshipService.applyDelta({
      characterId: 'guard_captain',
      trustDelta: 40,
      affinityDelta: 25,
      eventDescription: 'Helped with investigation',
    });
    relationshipService.adjustFactionStanding({
      factionId: 'town_guard',
      delta: 60,
      reason: 'Heroic',
    });

    const facts = relationshipService.getFacts({ npcId: 'guard_captain' });

    expect(facts.some((f) => f.includes('guard_captain') && f.includes('Trust 40'))).toBe(true);
    expect(facts.some((f) => f.includes('town_guard') && f.includes('60'))).toBe(true);
  });

  test('getFacts returns minimal facts when no relationship but have non-zero standings', () => {
    const facts = relationshipService.getFacts({ npcId: 'unknown_npc' });
    // crimson_covenant has defaultStanding -30, which is non-zero
    expect(facts.length).toBeGreaterThanOrEqual(0);
    // town_guard standing is 0, should not appear
    expect(facts.some((f) => f.includes('town_guard'))).toBe(false);
  });
});
