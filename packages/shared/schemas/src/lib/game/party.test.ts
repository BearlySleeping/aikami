// packages/shared/schemas/src/lib/game/party.test.ts
//
// Tests for PartyRosterEntry / PartyState schema validation.
// Contract: C-340 Build Party and Companion Gameplay

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { EMPTY_PARTY_STATE, PartyRosterEntrySchema, PartyStateSchema } from './party.ts';

const validMember = {
  npcId: 'lydia',
  name: 'Lydia',
  classId: 'cleric',
  level: 3,
  approval: 20,
  recruitedAt: '2026-01-01T00:00:00.000Z',
  personalQuestActive: false,
  equipmentSlotIds: [],
} as const;

describe('PartyRosterEntrySchema', () => {
  test('validates a well-formed roster entry', () => {
    expect(Value.Check(PartyRosterEntrySchema, validMember)).toBe(true);
  });

  test('rejects approval outside [-100, 100]', () => {
    expect(Value.Check(PartyRosterEntrySchema, { ...validMember, approval: 101 })).toBe(false);
    expect(Value.Check(PartyRosterEntrySchema, { ...validMember, approval: -101 })).toBe(false);
  });

  test('rejects level below 1', () => {
    expect(Value.Check(PartyRosterEntrySchema, { ...validMember, level: 0 })).toBe(false);
  });

  test('rejects unknown properties', () => {
    expect(Value.Check(PartyRosterEntrySchema, { ...validMember, unknownField: 'nope' })).toBe(
      false,
    );
  });
});

describe('PartyStateSchema', () => {
  test('validates a party state with members', () => {
    const state = { members: [validMember], maxSize: 4, formation: 'line' as const };
    expect(Value.Check(PartyStateSchema, state)).toBe(true);
  });

  test('accepts every formation type', () => {
    for (const formation of ['line', 'column', 'spread'] as const) {
      expect(Value.Check(PartyStateSchema, { members: [], maxSize: 4, formation })).toBe(true);
    }
  });

  test('rejects an unknown formation type', () => {
    expect(Value.Check(PartyStateSchema, { members: [], maxSize: 4, formation: 'diamond' })).toBe(
      false,
    );
  });

  test('rejects maxSize outside [1, 6]', () => {
    expect(Value.Check(PartyStateSchema, { members: [], maxSize: 0, formation: 'line' })).toBe(
      false,
    );
    expect(Value.Check(PartyStateSchema, { members: [], maxSize: 7, formation: 'line' })).toBe(
      false,
    );
  });

  test('EMPTY_PARTY_STATE is a valid, empty PartyState (v0 save default)', () => {
    expect(Value.Check(PartyStateSchema, EMPTY_PARTY_STATE)).toBe(true);
    expect(EMPTY_PARTY_STATE.members).toHaveLength(0);
  });
});
