// apps/frontend/client/src/lib/services/npc/npc_awareness_service.test.ts
//
// Unit tests for NpcAwarenessService — nearby NPC resolution,
// party member dedup, and graceful degradation.
//
// Contract: C-456 Group Chat & Systemic NPC Interactions (AC-2)

import { mock, setSystemTime } from 'bun:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

mock.module('../game/world_state_service.svelte.ts', () => ({
  worldStateService: {
    currentLocation: {
      id: 'town_square',
      name: 'Town Square',
      description: 'A bustling town square',
      connections: [],
      npcIds: ['npc_merchant', 'npc_guard', 'npc_party_member'],
    },
  },
}));

mock.module('./npc_service.svelte.ts', () => ({
  npcService: {
    get: mock((options: { npcId: string }) => {
      const npcs: Record<string, unknown> = {
        npc_merchant: {
          id: 'npc_merchant',
          name: 'Merchant',
          personality: 'Friendly and cunning',
          notes: 'A traveling merchant',
          faction: 'Merchants Guild',
          occupation: 'Selling wares',
        },
        npc_guard: {
          id: 'npc_guard',
          name: 'Guard',
          personality: 'Stoic and dutiful',
          notes: 'City watch guard',
          faction: 'City Watch',
          occupation: 'Standing guard',
        },
        npc_party_member: {
          id: 'npc_party_member',
          name: 'Party Member',
          personality: 'Brave and loyal',
          notes: 'A companion',
          faction: 'Party',
          occupation: 'Adventuring',
        },
      };
      return Promise.resolve(npcs[options.npcId] ?? undefined);
    }),
  },
}));

mock.module('../game/party_roster_service.svelte.ts', () => ({
  partyRosterService: {
    members: [
      {
        npcId: 'npc_party_member',
        name: 'Party Member',
        classId: 'fighter',
        level: 3,
        approval: 50,
        recruitedAt: '2026-09-01T00:00:00Z',
        personalQuestActive: false,
        equipmentSlotIds: [],
      },
    ],
  },
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe('NpcAwarenessService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setSystemTime(new Date('2026-09-02T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should expose nearbyNpcIds from current location', async () => {
    const { npcAwarenessService } = await import('./npc_awareness_service.svelte.ts');

    expect(npcAwarenessService.nearbyNpcIds).toEqual([
      'npc_merchant',
      'npc_guard',
      'npc_party_member',
    ]);
  });

  it('should return nearby NPC context excluding party members', async () => {
    const { npcAwarenessService } = await import('./npc_awareness_service.svelte.ts');

    const context = await npcAwarenessService.getNearbyNpcContext();

    // Should exclude the party member (npc_party_member)
    expect(context.length).toBe(2);

    const merchant = context.find((npc: { id: string }) => npc.id === 'npc_merchant');
    expect(merchant).toBeDefined();
    expect(merchant?.name).toBe('Merchant');
    expect(merchant?.persona).toBe('Friendly and cunning');
    expect(merchant?.relationship).toBe('Merchants Guild');
    expect(merchant?.currentActivity).toBe('Selling wares');

    const guard = context.find((npc: { id: string }) => npc.id === 'npc_guard');
    expect(guard).toBeDefined();
    expect(guard?.name).toBe('Guard');

    const partyMember = context.find((npc: { id: string }) => npc.id === 'npc_party_member');
    expect(partyMember).toBeUndefined();
  });

  it('should get NPC personality', async () => {
    const { npcAwarenessService } = await import('./npc_awareness_service.svelte.ts');

    const personality = await npcAwarenessService.getNpcPersonality('npc_merchant');
    expect(personality).toBe('Friendly and cunning');
  });

  it('should get NPC name', async () => {
    const { npcAwarenessService } = await import('./npc_awareness_service.svelte.ts');

    const name = await npcAwarenessService.getNpcName('npc_merchant');
    expect(name).toBe('Merchant');
  });

  it('should handle missing NPC gracefully', async () => {
    const { npcAwarenessService } = await import('./npc_awareness_service.svelte.ts');

    const personality = await npcAwarenessService.getNpcPersonality('nonexistent_npc');
    expect(personality).toBe('Unknown');
  });

  it('should return empty context when location has no NPCs', async () => {
    // Re-mock worldStateService with no npcIds
    const mod = await import('../game/world_state_service.svelte.ts');
    // @ts-expect-error: mock mutation
    mod.worldStateService.currentLocation = { npcIds: [] };

    const { npcAwarenessService } = await import('./npc_awareness_service.svelte.ts');

    const context = await npcAwarenessService.getNearbyNpcContext();
    expect(context).toEqual([]);
  });
});
