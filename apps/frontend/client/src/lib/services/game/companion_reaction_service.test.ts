// apps/frontend/client/src/lib/services/game/companion_reaction_service.test.ts
//
// C-494 AC-4 (boundary crossing → state change) + AC-5 (unprompted action fires
// exactly once). Tests the companion reaction authority and the authored
// `reaction|trigger` convention.
//
// Contract: C-494 One companion who reacts

import { beforeEach, describe, expect, test } from 'bun:test';
import type { CommittedNarrativeEvent, ContentPackNpcEntry } from '@aikami/types';
import {
  applyCompanionReaction,
  detectBoundaryCrossing,
  parseBoundaryReactions,
  parseCompanionReaction,
} from './companion_reaction';
import { companionReactionService } from './companion_reaction_service.svelte';
import { partyRosterService } from './party_roster_service.svelte';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GUARD: ContentPackNpcEntry = {
  name: 'Bram the Guard',
  isCompanion: true,
  companionClassId: 'fighter',
  initialApproval: 10,
  boundaries: ['refuse|Threaten an innocent villager', 'object|Give the Ward Wand to Rollo'],
};

const makeEvent = (overrides: Partial<CommittedNarrativeEvent> = {}): CommittedNarrativeEvent => ({
  id: 'evt-1',
  campaignId: 'demo',
  sequence: 1,
  kind: 'ThreatWitnessed',
  informationKind: 'character_belief',
  summary: `${GUARD.name} witnessed a threat`,
  witnesses: ['village_guard'],
  claimantId: 'village_guard',
  recordedAt: new Date().toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Pure convention parsing
// ---------------------------------------------------------------------------

describe('parseCompanionReaction', () => {
  test('parses a refuse|trigger binding', () => {
    expect(parseCompanionReaction('refuse|Threaten an innocent villager')).toEqual({
      reaction: 'refuse',
      trigger: 'Threaten an innocent villager',
    });
  });

  test('parses object and leave bindings', () => {
    expect(parseCompanionReaction('object|Give the Ward Wand to Rollo')?.reaction).toBe('object');
    expect(parseCompanionReaction('leave|Abandon the village')?.reaction).toBe('leave');
  });

  test('returns undefined for ordinary prose boundaries (no |)', () => {
    expect(parseCompanionReaction('She will not risk Emberwatch on a stranger')).toBeUndefined();
  });

  test('returns undefined for unknown reaction tokens', () => {
    expect(parseCompanionReaction('flee|Threaten a villager')).toBeUndefined();
  });

  test('parseBoundaryReactions extracts only convention-bound entries', () => {
    const parsed = parseBoundaryReactions(['refuse|A', 'plain prose', 'leave|B']);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.reaction)).toEqual(['refuse', 'leave']);
  });
});

describe('detectBoundaryCrossing', () => {
  test('detects a crossing when the action matches a trigger', () => {
    const crossing = detectBoundaryCrossing({
      boundaries: GUARD.boundaries,
      actionDescription: 'The player moved to threaten an innocent villager at the gate.',
    });
    expect(crossing?.reaction).toBe('refuse');
  });

  test('returns undefined when nothing matches', () => {
    const crossing = detectBoundaryCrossing({
      boundaries: GUARD.boundaries,
      actionDescription: 'The player paid for supplies.',
    });
    expect(crossing).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// State-change application (AC-4)
// ---------------------------------------------------------------------------

describe('applyCompanionReaction', () => {
  beforeEach(() => {
    partyRosterService.reset();
  });

  test('refuse drops approval by 20', () => {
    partyRosterService.recruit({
      npcId: 'village_guard',
      name: 'Bram',
      classId: 'fighter',
      initialApproval: 10,
    });
    const outcome = applyCompanionReaction({
      npcId: 'village_guard',
      reaction: 'refuse',
      roster: partyRosterService,
    });
    expect(outcome.approvalDelta).toBe(-20);
    expect(partyRosterService.getApproval('village_guard')).toBe(-10);
  });

  test('object changes no approval but keeps the member', () => {
    partyRosterService.recruit({
      npcId: 'village_guard',
      name: 'Bram',
      classId: 'fighter',
      initialApproval: 10,
    });
    const outcome = applyCompanionReaction({
      npcId: 'village_guard',
      reaction: 'object',
      roster: partyRosterService,
    });
    expect(outcome.approvalDelta).toBe(0);
    expect(partyRosterService.hasMember('village_guard')).toBe(true);
    expect(partyRosterService.getApproval('village_guard')).toBe(10);
  });

  test('leave dismisses the companion from the party', () => {
    partyRosterService.recruit({
      npcId: 'village_guard',
      name: 'Bram',
      classId: 'fighter',
    });
    const outcome = applyCompanionReaction({
      npcId: 'village_guard',
      reaction: 'leave',
      roster: partyRosterService,
    });
    expect(outcome.dismissed).toBe(true);
    expect(partyRosterService.hasMember('village_guard')).toBe(false);
  });

  test('is a no-op for a companion not in the roster', () => {
    const outcome = applyCompanionReaction({
      npcId: 'village_guard',
      reaction: 'refuse',
      roster: partyRosterService,
    });
    expect(outcome.approvalDelta).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Service authority (AC-4 idempotency, AC-5 unprompted)
// ---------------------------------------------------------------------------

describe('CompanionReactionService', () => {
  beforeEach(() => {
    partyRosterService.reset();
    companionReactionService.reset();
  });

  test('does not react for a non-companion NPC', () => {
    const result = companionReactionService.evaluateEvent({
      npcId: 'village_elder',
      npc: { name: 'Elder Thalia' },
      event: makeEvent(),
    });
    expect(result).toBeUndefined();
  });

  test('does not react when the companion is not recruited', () => {
    const result = companionReactionService.evaluateEvent({
      npcId: 'village_guard',
      npc: GUARD,
      event: makeEvent(),
    });
    expect(result).toBeUndefined();
  });

  test('AC-4: a boundary-crossing event applies refuse and drops approval once', () => {
    partyRosterService.recruit({
      npcId: 'village_guard',
      name: 'Bram',
      classId: 'fighter',
      initialApproval: 10,
    });
    const event = makeEvent({ summary: 'Bram witnessed the player threaten an innocent villager' });
    const first = companionReactionService.evaluateEvent({
      npcId: 'village_guard',
      npc: GUARD,
      event,
    });
    expect(first?.reaction).toBe('refuse');
    expect(partyRosterService.getApproval('village_guard')).toBe(-10);

    // Idempotency — re-evaluating the same event must not double-drop.
    const second = companionReactionService.evaluateEvent({
      npcId: 'village_guard',
      npc: GUARD,
      event,
    });
    expect(second).toBeUndefined();
    expect(partyRosterService.getApproval('village_guard')).toBe(-10);
  });

  test('AC-4: a leave crossing dismisses the companion', () => {
    partyRosterService.recruit({ npcId: 'village_guard', name: 'Bram', classId: 'fighter' });
    const event = makeEvent({
      id: 'evt-leave',
      summary: 'Bram witnessed the player abandon the village to the Covenant',
    });
    const crossing = detectBoundaryCrossing({
      boundaries: ['leave|abandon the village'],
      actionDescription: event.summary,
    });
    expect(crossing?.reaction).toBe('leave');
  });

  test('AC-5: fireUnpromptedTurn fires exactly once per event', () => {
    partyRosterService.recruit({ npcId: 'village_guard', name: 'Bram', classId: 'fighter' });
    const event = makeEvent();
    expect(
      companionReactionService.fireUnpromptedTurn({ npcId: 'village_guard', npc: GUARD, event }),
    ).toBe(true);
    expect(
      companionReactionService.fireUnpromptedTurn({ npcId: 'village_guard', npc: GUARD, event }),
    ).toBe(false);
    expect(companionReactionService.hasFired(event.id)).toBe(true);
  });

  test('AC-5: does not fire for a non-recruited or non-companion NPC', () => {
    const event = makeEvent();
    expect(
      companionReactionService.fireUnpromptedTurn({
        npcId: 'village_elder',
        npc: { name: 'X' },
        event,
      }),
    ).toBe(false);
    expect(
      companionReactionService.fireUnpromptedTurn({ npcId: 'village_guard', npc: GUARD, event }),
    ).toBe(false);
  });
});
