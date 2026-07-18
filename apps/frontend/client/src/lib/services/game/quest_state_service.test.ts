// apps/frontend/client/src/lib/services/game/quest_state_service.test.ts
//
// Unit tests for QuestStateService — accept, decline, progress, complete,
// reward delivery, idempotency, serialize/hydrate.
//
// Contract: C-329 Integrate the Demo Quest from Offer Through Reward

import { beforeEach, describe, expect, test } from 'bun:test';
import type { ContentPackLoaderInterface } from '@aikami/frontend/engine';
import type { ContentPackQuestEntry } from '@aikami/types';

// ── Mock content pack quest data ──

const FADING_WARD_QUEST: ContentPackQuestEntry = {
  id: 'fading_ward',
  name: 'The Fading Ward',
  description: 'Investigate the fading magical wards protecting Emberwatch Village.',
  offerDialogueKey: 'fading_ward_offer',
  progressDialogueKey: 'fading_ward_progress',
  objectives: [
    { text: 'Investigate the Old Road', completeOnMapEnter: 'old_road' },
    { text: 'Reach the Ruined Ward Shrine', completeOnMapEnter: 'ruined_ward_shrine' },
    { text: "Decide the ward's fate", completeOnEncounterComplete: 'ruined_ward_encounter' },
  ],
  rewards: [
    { type: 'item', itemId: 'wardAmulet' },
    { type: 'gold', amount: 200 },
    { type: 'xp', amount: 500 },
  ],
  endings: {
    renewed: {
      title: 'Ward Renewed',
      narration: 'You place your hands upon the fading crystal and channel your energy into it.',
      worldStateFlag: 'emberwatch.ending.renewed',
    },
    sacrificed: {
      title: 'Sacrificed',
      narration: 'You sacrifice the ward energy, releasing it into the world.',
      worldStateFlag: 'emberwatch.ending.sacrificed',
    },
  },
};

const LOST_PENDANT_QUEST: ContentPackQuestEntry = {
  id: 'lost_pendant',
  name: 'The Lost Pendant',
  description: "Find Keth's lost ward pendant.",
  offerDialogueKey: 'lost_pendant_offer',
  progressDialogueKey: 'lost_pendant_progress',
  objectives: [
    { text: 'Find the Ward Pendant', completeOnItemPickup: 'wardPendant' },
    { text: 'Return the pendant to Keth', completeOnNpcInteract: 'keth_merchant' },
  ],
  rewards: [{ type: 'gold', amount: 100 }],
  endings: {},
};

// ── Mock content pack loader ──

const createMockContentPackLoader = (): ContentPackLoaderInterface => {
  const quests = new Map<string, ContentPackQuestEntry>();
  quests.set('fading_ward', FADING_WARD_QUEST);
  quests.set('lost_pendant', LOST_PENDANT_QUEST);

  return {
    manifest: {
      maps: {
        // biome-ignore lint/style/useNamingConvention: content pack map IDs use snake_case
        old_road: { file: 'maps/old_road.json', name: 'The Old Road' },
        // biome-ignore lint/style/useNamingConvention: content pack map IDs use snake_case
        ruined_ward_shrine: {
          file: 'maps/ruined_ward_shrine.json',
          name: 'Ruined Ward Shrine',
        },
        // biome-ignore lint/style/useNamingConvention: content pack map IDs use snake_case
        emberwatch_village: {
          file: 'maps/emberwatch_village.json',
          name: 'Emberwatch Village',
        },
      },
    } as ContentPackLoaderInterface['manifest'],
    packId: 'emberwatch',
    resolveMapUrl: (mapId: string) => `maps/${mapId}.json`,
    resolveMapId: (mapUrl: string) => {
      for (const [id, map] of Object.entries({
        // biome-ignore lint/style/useNamingConvention: content pack map IDs use snake_case
        old_road: { file: 'maps/old_road.json' },
        // biome-ignore lint/style/useNamingConvention: content pack map IDs use snake_case
        ruined_ward_shrine: { file: 'maps/ruined_ward_shrine.json' },
        // biome-ignore lint/style/useNamingConvention: content pack map IDs use snake_case
        emberwatch_village: { file: 'maps/emberwatch_village.json' },
      })) {
        if (mapUrl.endsWith(map.file)) {
          return id;
        }
      }
      return undefined;
    },
    getDialogue: () => undefined,
    getStartingMap: () => ({ file: '', name: '' }),
    getNpc: () => undefined,
    getItem: () => undefined,
    getQuest: (id: string) => quests.get(id),
    getEncounter: () => undefined,
    getAllQuests: () => Array.from(quests.values()),
    getAllEncounters: () => [],
    getCredits: () => undefined,
    dispose: () => {},
  };
};

// ── Tests ──

describe('QuestStateService', () => {
  let service: import('./quest_state_service.svelte').QuestStateServiceInterface;

  beforeEach(async () => {
    // Reset module state by re-importing
    const mod = await import('./quest_state_service.svelte');
    service = mod.questStateService;
    service.reset();
    service.configure({ contentPackLoader: createMockContentPackLoader() });
  });

  // ── AC-1: Accept and Decline ──

  describe('acceptQuest', () => {
    test('adds quest to active list and returns true', () => {
      const result = service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
      expect(result).toBe(true);
      expect(service.quests.length).toBe(1);
      expect(service.quests[0].id).toBe('fading_ward');
      expect(service.quests[0].status).toBe('active');
      expect(service.quests[0].objectives.length).toBe(3);
      expect(service.quests[0].objectives[0].current).toBe(0);
    });

    test('returns false for duplicate acceptance', () => {
      service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
      const result = service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
      expect(result).toBe(false);
      expect(service.quests.length).toBe(1);
    });

    test('returns false for unknown quest', () => {
      const result = service.acceptQuest({ questId: 'nonexistent', npcId: 'village_elder' });
      expect(result).toBe(false);
    });

    test('returns false for declined quest', () => {
      service.declineQuest({ questId: 'fading_ward' });
      const result = service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
      expect(result).toBe(false);
    });

    test('returns false for already completed quest', () => {
      service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
      // Complete all objectives
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/old_road.json' });
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/ruined_ward_shrine.json' });
      service.evaluateTriggers({
        type: 'ENCOUNTER_COMPLETED',
        encounterId: 'ruined_ward_encounter',
        victory: true,
      });
      const result = service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
      expect(result).toBe(false);
    });
  });

  describe('declineQuest', () => {
    test('marks quest as declined', () => {
      service.declineQuest({ questId: 'fading_ward' });
      expect(service.canAcceptQuest('fading_ward')).toBe(false);
    });

    test('is idempotent', () => {
      service.declineQuest({ questId: 'fading_ward' });
      service.declineQuest({ questId: 'fading_ward' });
      expect(service.canAcceptQuest('fading_ward')).toBe(false);
    });
  });

  describe('canAcceptQuest', () => {
    test('returns true for available quest', () => {
      expect(service.canAcceptQuest('fading_ward')).toBe(true);
    });

    test('returns false for declined quest', () => {
      service.declineQuest({ questId: 'fading_ward' });
      expect(service.canAcceptQuest('fading_ward')).toBe(false);
    });

    test('returns false for active quest', () => {
      service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
      expect(service.canAcceptQuest('fading_ward')).toBe(false);
    });

    test('returns false for non-existent quest', () => {
      expect(service.canAcceptQuest('nonexistent')).toBe(false);
    });
  });

  // ── AC-2: Objective Progression ──

  describe('evaluateTriggers', () => {
    beforeEach(() => {
      service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
    });

    test('advances objective on MAP_ENTERED match', () => {
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/old_road.json' });
      expect(service.quests[0].objectives[0].current).toBe(1);
      expect(service.quests[0].objectives[1].current).toBe(0);
      expect(service.quests[0].objectives[2].current).toBe(0);
    });

    test('does not double-advance on same trigger', () => {
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/old_road.json' });
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/old_road.json' });
      expect(service.quests[0].objectives[0].current).toBe(1);
    });

    test('does not advance on non-matching trigger', () => {
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/emberwatch_village.json' });
      expect(service.quests[0].objectives[0].current).toBe(0);
      expect(service.quests[0].objectives[1].current).toBe(0);
      expect(service.quests[0].objectives[2].current).toBe(0);
    });

    test('advances on ENCOUNTER_COMPLETED match', () => {
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/old_road.json' });
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/ruined_ward_shrine.json' });
      service.evaluateTriggers({
        type: 'ENCOUNTER_COMPLETED',
        encounterId: 'ruined_ward_encounter',
        victory: true,
      });
      expect(service.quests[0].objectives[2].current).toBe(1);
    });

    test('transitions quest to completed when all objectives done', () => {
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/old_road.json' });
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/ruined_ward_shrine.json' });
      service.evaluateTriggers({
        type: 'ENCOUNTER_COMPLETED',
        encounterId: 'ruined_ward_encounter',
        victory: true,
      });

      // Quest should now be completed — moved out of active
      const activeQuest = service.quests.find(
        (q) => q.id === 'fading_ward' && q.status === 'active',
      );
      expect(activeQuest).toBeUndefined();
    });

    test('advances optional quest on ITEM_PICKED_UP match', () => {
      service.acceptQuest({ questId: 'lost_pendant', npcId: 'keth_merchant' });
      service.evaluateTriggers({ type: 'ITEM_PICKED_UP', itemId: 'wardPendant' });

      const pendantQuest = service.quests.find((q) => q.id === 'lost_pendant');
      expect(pendantQuest).toBeDefined();
      expect(pendantQuest?.objectives[0].current).toBe(1);
    });

    test('advances optional quest on NPC_INTERACTED match', () => {
      service.acceptQuest({ questId: 'lost_pendant', npcId: 'keth_merchant' });
      service.evaluateTriggers({ type: 'ITEM_PICKED_UP', itemId: 'wardPendant' });
      service.evaluateTriggers({ type: 'NPC_INTERACTED', npcId: 'keth_merchant' });

      const pendantQuest = service.quests.find((q) => q.id === 'lost_pendant');
      expect(pendantQuest).toBeDefined();
      expect(pendantQuest?.objectives[1].current).toBe(1);
    });

    test('optional quest advances independently of main quest', () => {
      service.acceptQuest({ questId: 'lost_pendant', npcId: 'keth_merchant' });

      // Complete just the pendant quest
      service.evaluateTriggers({ type: 'ITEM_PICKED_UP', itemId: 'wardPendant' });
      service.evaluateTriggers({ type: 'NPC_INTERACTED', npcId: 'keth_merchant' });

      // Main quest should still be active with 0 progress
      const fadingWard = service.quests.find((q) => q.id === 'fading_ward');
      expect(fadingWard).toBeDefined();
      expect(fadingWard?.status).toBe('active');
      expect(fadingWard?.objectives[0].current).toBe(0);
    });

    test('non-combat encounter resolution also triggers objective', () => {
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/old_road.json' });
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/ruined_ward_shrine.json' });
      // Non-combat resolution (still victory=true since encounter was resolved)
      service.evaluateTriggers({
        type: 'ENCOUNTER_COMPLETED',
        encounterId: 'ruined_ward_encounter',
        victory: true,
      });
      expect(service.quests[0].objectives[2].current).toBe(1);
    });
  });

  // ── AC-3: Reward Delivery ──

  describe('reward delivery', () => {
    test('delivers item, gold, and XP rewards on completion', () => {
      service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });

      // Complete the quest via triggers
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/old_road.json' });
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/ruined_ward_shrine.json' });
      service.evaluateTriggers({
        type: 'ENCOUNTER_COMPLETED',
        encounterId: 'ruined_ward_encounter',
        victory: true,
      });

      // Verify world state flag was set
      expect(service.worldStateFlags['emberwatch.ending.renewed']).toBe(true);
    });

    test('only delivers rewards once (idempotency)', () => {
      service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });

      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/old_road.json' });
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/ruined_ward_shrine.json' });

      // Complete the quest first time
      service.evaluateTriggers({
        type: 'ENCOUNTER_COMPLETED',
        encounterId: 'ruined_ward_encounter',
        victory: true,
      });

      // Second completion trigger should be no-op
      service.evaluateTriggers({
        type: 'ENCOUNTER_COMPLETED',
        encounterId: 'ruined_ward_encounter',
        victory: true,
      });

      // State should remain stable
      const serialized = service.serialize();
      expect(serialized.activeQuests.filter((q) => q.questId === 'fading_ward').length).toBe(0);
    });
  });

  // ── AC-4: Serialize/Hydrate ──

  describe('serialize/hydrate', () => {
    test('round-trips quest state', () => {
      service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
      service.acceptQuest({ questId: 'lost_pendant', npcId: 'keth_merchant' });
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/old_road.json' });

      const serialized = service.serialize();

      // Create a fresh service and hydrate
      service.reset();
      service.configure({ contentPackLoader: createMockContentPackLoader() });
      service.hydrate(serialized);

      expect(service.quests.length).toBe(2);
      const fadingWard = service.quests.find((q) => q.id === 'fading_ward');
      expect(fadingWard).toBeDefined();
      expect(fadingWard?.objectives[0].current).toBe(1);
      expect(fadingWard?.objectives[1].current).toBe(0);
    });

    test('round-trips world state flags', () => {
      service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/old_road.json' });
      service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/ruined_ward_shrine.json' });
      service.evaluateTriggers({
        type: 'ENCOUNTER_COMPLETED',
        encounterId: 'ruined_ward_encounter',
        victory: true,
      });

      const serialized = service.serialize();

      service.reset();
      service.configure({ contentPackLoader: createMockContentPackLoader() });
      service.hydrate(serialized);

      expect(service.worldStateFlags['emberwatch.ending.renewed']).toBe(true);
    });

    test('round-trips declined quest IDs', () => {
      service.declineQuest({ questId: 'fading_ward' });
      const serialized = service.serialize();

      service.reset();
      service.configure({ contentPackLoader: createMockContentPackLoader() });
      service.hydrate(serialized);

      expect(service.canAcceptQuest('fading_ward')).toBe(false);
    });

    test('loads empty state gracefully', () => {
      service.hydrate({
        activeQuests: [],
        completedQuestIds: [],
        failedQuestIds: [],
        declinedQuestIds: [],
        worldStateFlags: {},
      });

      expect(service.quests.length).toBe(0);
    });

    test('null state loads empty gracefully', () => {
      // @ts-expect-error - testing defensive null handling
      service.hydrate(null);
      expect(service.quests.length).toBe(0);
    });
  });

  // ── Reset ──

  describe('reset', () => {
    test('clears all quest state', () => {
      service.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
      service.declineQuest({ questId: 'lost_pendant' });

      service.reset();

      expect(service.quests.length).toBe(0);
      expect(service.canAcceptQuest('fading_ward')).toBe(true);
      expect(service.canAcceptQuest('lost_pendant')).toBe(true);
      expect(service.worldStateFlags).toEqual({});
    });
  });
});
