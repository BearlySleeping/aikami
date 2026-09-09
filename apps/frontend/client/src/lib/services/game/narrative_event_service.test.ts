// apps/frontend/client/src/lib/services/game/narrative_event_service.test.ts
//
// Unit tests for the committed narrative event record service — witness
// capture (AC-2), information categories (AC-3), and save/load round-trip with
// old-save compatibility (AC-4).
//
// Contract: C-491 Committed narrative event record

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { NarrativeEventRecord } from '@aikami/types';
import { narrativeEventService } from './narrative_event_service.svelte.ts';

const recordBase = {
  campaignId: 'camp-1',
  summary: 'Something happened.',
};

const resetService = (): void => {
  narrativeEventService.reset();
};

describe('NarrativeEventService (C-491)', () => {
  beforeEach(() => {
    resetService();
  });

  afterEach(() => {
    resetService();
  });

  // ── AC-2: witnesses ────────────────────────────────────────────────
  describe('AC-2: witnesses', () => {
    test('dedupes the actor and scene cast, preserving first occurrence', () => {
      const event = narrativeEventService.record({
        ...recordBase,
        kind: 'ItemTransferred',
        informationKind: 'world_fact',
        actorId: 'npcB',
        witnesses: ['npcA', 'npcB'],
      });
      expect(event.witnesses).toEqual(['npcB', 'npcA']);
    });

    test('keeps the actor present even when the scene cast is empty', () => {
      const event = narrativeEventService.record({
        ...recordBase,
        kind: 'WorldFlagChanged',
        informationKind: 'world_fact',
        actorId: 'npcB',
        witnesses: [],
      });
      expect(event.witnesses).toEqual(['npcB']);
    });

    test('rejects when neither actorId nor witnesses is provided', () => {
      expect(() =>
        narrativeEventService.record({
          ...recordBase,
          kind: 'WorldFlagChanged',
          informationKind: 'world_fact',
        }),
      ).toThrow(/at least one witness/);
    });

    test('witnessedBy returns only events the NPC witnessed, oldest first', () => {
      narrativeEventService.record({
        ...recordBase,
        kind: 'ItemTransferred',
        informationKind: 'world_fact',
        actorId: 'npcA',
        witnesses: ['npcB'],
      });
      narrativeEventService.record({
        ...recordBase,
        kind: 'WorldFlagChanged',
        informationKind: 'world_fact',
        actorId: 'npcB',
      });
      const seenByA = narrativeEventService.witnessedBy('npcA');
      const seenByB = narrativeEventService.witnessedBy('npcB');
      expect(seenByA).toHaveLength(1);
      expect(seenByA[0]?.kind).toBe('ItemTransferred');
      // B witnesses the first (as scene cast) and acts in the second.
      expect(seenByB.map((e) => e.kind)).toEqual(['ItemTransferred', 'WorldFlagChanged']);
    });
  });

  // ── AC-3: facts, beliefs and claims are distinguishable ────────────
  describe('AC-3: information categories', () => {
    test('rejects character_belief without a claimantId', () => {
      expect(() =>
        narrativeEventService.record({
          ...recordBase,
          kind: 'ThreatWitnessed',
          informationKind: 'character_belief',
          actorId: 'npcA',
        }),
      ).toThrow(/claimantId/);
    });

    test('rejects dialogue_claim without a claimantId', () => {
      expect(() =>
        narrativeEventService.record({
          ...recordBase,
          kind: 'EvidencePresented',
          informationKind: 'dialogue_claim',
          actorId: 'npcA',
        }),
      ).toThrow(/claimantId/);
    });

    test('accepts world_fact with an optional claimantId', () => {
      const event = narrativeEventService.record({
        ...recordBase,
        kind: 'ItemTransferred',
        informationKind: 'world_fact',
        actorId: 'npcA',
        claimantId: 'npcB',
      });
      expect(event.informationKind).toBe('world_fact');
      expect(event.claimantId).toBe('npcB');
    });

    test('stores all three information kinds with distinct values', () => {
      const belief = narrativeEventService.record({
        ...recordBase,
        kind: 'ThreatWitnessed',
        informationKind: 'character_belief',
        actorId: 'npcA',
        claimantId: 'npcA',
      });
      const claim = narrativeEventService.record({
        ...recordBase,
        kind: 'EvidencePresented',
        informationKind: 'dialogue_claim',
        actorId: 'npcB',
        claimantId: 'npcB',
      });
      const fact = narrativeEventService.record({
        ...recordBase,
        kind: 'QuestResolved',
        informationKind: 'world_fact',
        actorId: 'npcA',
      });
      expect(belief.informationKind).toBe('character_belief');
      expect(claim.informationKind).toBe('dialogue_claim');
      expect(fact.informationKind).toBe('world_fact');
      // Distinct kinds round-trip.
      expect(new Set([belief.kind, claim.kind, fact.kind]).size).toBe(3);
    });

    test('rejects an empty campaignId', () => {
      expect(() =>
        narrativeEventService.record({
          campaignId: '',
          kind: 'WorldFlagChanged',
          informationKind: 'world_fact',
          actorId: 'npcA',
          summary: 'x',
        }),
      ).toThrow(/campaignId/);
    });
  });

  // ── AC-4: save/load round-trip ─────────────────────────────────────
  describe('AC-4: round-trip and old-save compatibility', () => {
    test('assigns monotonic sequences in append order', () => {
      const a = narrativeEventService.record({
        ...recordBase,
        kind: 'ItemTransferred',
        informationKind: 'world_fact',
        actorId: 'npcA',
      });
      const b = narrativeEventService.record({
        ...recordBase,
        kind: 'WorldFlagChanged',
        informationKind: 'world_fact',
        actorId: 'npcB',
      });
      expect(a.sequence).toBe(1);
      expect(b.sequence).toBe(2);
      expect(narrativeEventService.events).toHaveLength(2);
    });

    test('serialize → hydrate preserves events, order, witnesses, and nextSequence', () => {
      const witnesses = ['npcA', 'npcB'];
      narrativeEventService.record({
        ...recordBase,
        kind: 'QuestResolved',
        informationKind: 'world_fact',
        actorId: 'npcA',
        witnesses,
        subjectId: 'fading_ward',
      });
      narrativeEventService.record({
        ...recordBase,
        kind: 'RelationshipChanged',
        informationKind: 'world_fact',
        actorId: 'npcB',
      });

      const snapshot = narrativeEventService.serialize();
      expect(snapshot.nextSequence).toBe(3);

      // Simulate a fresh service hydrating from the snapshot.
      const fresh = narrativeEventService;
      fresh.reset();
      fresh.hydrate(JSON.parse(JSON.stringify(snapshot)) as NarrativeEventRecord);

      expect(fresh.events).toHaveLength(2);
      expect(fresh.events[0]?.kind).toBe('QuestResolved');
      expect(fresh.events[0]?.sequence).toBe(1);
      expect(fresh.events[0]?.witnesses).toEqual(witnesses);
      expect(fresh.events[1]?.sequence).toBe(2);
      // The next recorded event continues from the hydrated counter.
      const next = fresh.record({
        ...recordBase,
        kind: 'WorldFlagChanged',
        informationKind: 'world_fact',
        actorId: 'npcC',
      });
      expect(next.sequence).toBe(3);
    });

    test('reset() yields an empty record (old-save fallback)', () => {
      narrativeEventService.record({
        ...recordBase,
        kind: 'ItemTransferred',
        informationKind: 'world_fact',
        actorId: 'npcA',
      });
      expect(narrativeEventService.events).toHaveLength(1);
      narrativeEventService.reset();
      expect(narrativeEventService.events).toHaveLength(0);
      expect(narrativeEventService.serialize().nextSequence).toBe(1);
    });
  });
});
