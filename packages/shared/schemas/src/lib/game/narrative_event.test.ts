// packages/shared/schemas/src/lib/game/narrative_event.test.ts
//
// Tests for the committed narrative event record schemas — closed event-kind
// set, information categories (world fact / character belief / dialogue claim),
// witness requirements, and record round-trip.
// Contract: C-491 Committed narrative event record (AC-3)

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  CommittedNarrativeEventSchema,
  NarrativeEventKindSchema,
  NarrativeEventRecordSchema,
  NarrativeInformationKindSchema,
} from './narrative_event.ts';

const baseEvent = {
  id: 'evt-1',
  campaignId: 'camp-1',
  sequence: 1,
  kind: 'ItemTransferred',
  informationKind: 'world_fact',
  summary: 'Keth transferred the wand.',
  witnesses: ['npc_keth'],
  recordedAt: '2026-09-08T00:00:00.000Z',
} as const;

describe('NarrativeEventKindSchema', () => {
  test('accepts every closed kind', () => {
    for (const kind of [
      'PromiseMade',
      'EvidencePresented',
      'ItemTransferred',
      'ThreatWitnessed',
      'QuestResolved',
      'RelationshipChanged',
      'WorldFlagChanged',
    ] as const) {
      expect(Value.Check(NarrativeEventKindSchema, kind)).toBe(true);
    }
  });

  test('rejects a free-form kind string', () => {
    expect(Value.Check(NarrativeEventKindSchema, 'SomethingMadeUp')).toBe(false);
  });
});

describe('NarrativeInformationKindSchema', () => {
  test('accepts the three information categories', () => {
    for (const infoKind of ['world_fact', 'character_belief', 'dialogue_claim'] as const) {
      expect(Value.Check(NarrativeInformationKindSchema, infoKind)).toBe(true);
    }
  });

  test('rejects an unknown information kind', () => {
    expect(Value.Check(NarrativeInformationKindSchema, 'rumor')).toBe(false);
  });
});

describe('CommittedNarrativeEventSchema (AC-3)', () => {
  test('round-trips a world_fact event', () => {
    expect(Value.Check(CommittedNarrativeEventSchema, baseEvent)).toBe(true);
  });

  test('round-trips a character_belief event with a claimant', () => {
    const event = {
      ...baseEvent,
      kind: 'ThreatWitnessed',
      informationKind: 'character_belief',
      claimantId: 'npc_thalia',
    };
    expect(Value.Check(CommittedNarrativeEventSchema, event)).toBe(true);
  });

  test('round-trips a dialogue_claim event with a claimant', () => {
    const event = {
      ...baseEvent,
      kind: 'EvidencePresented',
      informationKind: 'dialogue_claim',
      claimantId: 'npc_rollo',
      subjectId: 'npc_rollo',
    };
    expect(Value.Check(CommittedNarrativeEventSchema, event)).toBe(true);
  });

  test('rejects a character_belief event without a claimant', () => {
    const event = {
      ...baseEvent,
      kind: 'ThreatWitnessed',
      informationKind: 'character_belief',
    };
    expect(Value.Check(CommittedNarrativeEventSchema, event)).toBe(false);
  });

  test('rejects a dialogue_claim event without a claimant', () => {
    const event = {
      ...baseEvent,
      kind: 'EvidencePresented',
      informationKind: 'dialogue_claim',
    };
    expect(Value.Check(CommittedNarrativeEventSchema, event)).toBe(false);
  });

  test('rejects an empty witnesses array', () => {
    expect(Value.Check(CommittedNarrativeEventSchema, { ...baseEvent, witnesses: [] })).toBe(false);
  });

  test('rejects an empty campaignId', () => {
    expect(Value.Check(CommittedNarrativeEventSchema, { ...baseEvent, campaignId: '' })).toBe(
      false,
    );
  });

  test('rejects unknown properties', () => {
    expect(Value.Check(CommittedNarrativeEventSchema, { ...baseEvent, bogus: true })).toBe(false);
  });

  test('validates a non-empty deltasApplied batch', () => {
    const event = {
      ...baseEvent,
      deltasApplied: [
        { kind: 'inventory_grant', target: 'wand', value: 1 },
        { kind: 'trust_change', target: 'npc_thalia', value: 2 },
      ],
    };
    expect(Value.Check(CommittedNarrativeEventSchema, event)).toBe(true);
  });
});

describe('NarrativeEventRecordSchema', () => {
  test('validates an empty record', () => {
    expect(
      Value.Check(NarrativeEventRecordSchema, { schemaVersion: 1, events: [], nextSequence: 1 }),
    ).toBe(true);
  });

  test('validates a record with events', () => {
    expect(
      Value.Check(NarrativeEventRecordSchema, {
        schemaVersion: 1,
        events: [baseEvent],
        nextSequence: 2,
      }),
    ).toBe(true);
  });
});
