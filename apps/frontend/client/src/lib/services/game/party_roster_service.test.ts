// apps/frontend/client/src/lib/services/game/party_roster_service.test.ts
//
// Unit tests for PartyRosterService — recruit/dismiss idempotency,
// approval clamping, and serialize/hydrate roundtrip.
//
// Contract C-340 AC-1, AC-5.

import { beforeEach, describe, expect, test } from 'bun:test';
import { partyRosterService } from './party_roster_service.svelte';

describe('PartyRosterService', () => {
  beforeEach(() => {
    partyRosterService.reset();
  });

  // ── Recruit (AC-1) ────────────────────────────────────────────────

  test('recruit adds a new companion to the roster', () => {
    const member = partyRosterService.recruit({
      npcId: 'lydia',
      name: 'Lydia',
      classId: 'cleric',
    });

    expect(member).toBeDefined();
    expect(partyRosterService.activeCount).toBe(1);
    expect(partyRosterService.hasMember('lydia')).toBe(true);
    expect(partyRosterService.getMember('lydia')?.classId).toBe('cleric');
  });

  test('recruit is idempotent — recruiting twice returns the existing entry', () => {
    partyRosterService.recruit({ npcId: 'lydia', name: 'Lydia', classId: 'cleric' });
    const second = partyRosterService.recruit({ npcId: 'lydia', name: 'Lydia', classId: 'cleric' });

    expect(partyRosterService.activeCount).toBe(1);
    expect(second?.npcId).toBe('lydia');
  });

  test('recruit rejects when the party is full', () => {
    partyRosterService.recruit({ npcId: 'a', name: 'A', classId: 'fighter' });
    partyRosterService.recruit({ npcId: 'b', name: 'B', classId: 'fighter' });
    partyRosterService.recruit({ npcId: 'c', name: 'C', classId: 'fighter' });
    partyRosterService.recruit({ npcId: 'd', name: 'D', classId: 'fighter' });

    expect(partyRosterService.isFull).toBe(true);

    const rejected = partyRosterService.recruit({ npcId: 'e', name: 'E', classId: 'fighter' });
    expect(rejected).toBeUndefined();
    expect(partyRosterService.activeCount).toBe(4);
  });

  // ── Dismiss (AC-1) ───────────────────────────────────────────────

  test('dismiss removes a companion from the roster', () => {
    partyRosterService.recruit({ npcId: 'lydia', name: 'Lydia', classId: 'cleric' });
    const dismissed = partyRosterService.dismiss('lydia');

    expect(dismissed).toBe(true);
    expect(partyRosterService.hasMember('lydia')).toBe(false);
    expect(partyRosterService.isEmpty()).toBe(true);
  });

  test('dismiss is idempotent — dismissing an absent companion is a no-op', () => {
    const result = partyRosterService.dismiss('nobody');
    expect(result).toBe(false);
  });

  // ── Approval ─────────────────────────────────────────────────────

  test('adjustApproval clamps to [-100, 100]', () => {
    partyRosterService.recruit({ npcId: 'lydia', name: 'Lydia', classId: 'cleric' });

    partyRosterService.adjustApproval({ npcId: 'lydia', delta: 500 });
    expect(partyRosterService.getApproval('lydia')).toBe(100);

    partyRosterService.adjustApproval({ npcId: 'lydia', delta: -500 });
    expect(partyRosterService.getApproval('lydia')).toBe(-100);
  });

  test('getApproval returns 0 for a companion not in the roster', () => {
    expect(partyRosterService.getApproval('nobody')).toBe(0);
  });

  // ── Personal quest ───────────────────────────────────────────────

  test('activate/deactivatePersonalQuest toggles the roster entry flag', () => {
    partyRosterService.recruit({ npcId: 'lydia', name: 'Lydia', classId: 'cleric' });

    partyRosterService.activatePersonalQuest('lydia');
    expect(partyRosterService.getMember('lydia')?.personalQuestActive).toBe(true);

    partyRosterService.deactivatePersonalQuest('lydia');
    expect(partyRosterService.getMember('lydia')?.personalQuestActive).toBe(false);
  });

  // ── Persistence (AC-5) ───────────────────────────────────────────

  test('serialize/hydrate roundtrips roster, maxSize, and formation', () => {
    partyRosterService.recruit({
      npcId: 'lydia',
      name: 'Lydia',
      classId: 'cleric',
      initialApproval: 20,
    });
    partyRosterService.formation = 'spread';

    const snapshot = partyRosterService.serialize();
    partyRosterService.reset();
    expect(partyRosterService.isEmpty()).toBe(true);

    partyRosterService.hydrate(snapshot);

    expect(partyRosterService.members).toHaveLength(1);
    expect(partyRosterService.getMember('lydia')?.approval).toBe(20);
    expect(partyRosterService.formation).toBe('spread');
  });

  test('hydrate on a v0 save (no partyState) defaults to an empty roster', () => {
    partyRosterService.hydrate({ members: [], maxSize: 4, formation: 'line' });

    expect(partyRosterService.isEmpty()).toBe(true);
    expect(partyRosterService.maxSize).toBe(4);
    expect(partyRosterService.formation).toBe('line');
  });
});
