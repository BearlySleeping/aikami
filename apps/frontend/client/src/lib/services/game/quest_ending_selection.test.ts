// apps/frontend/client/src/lib/services/game/quest_ending_selection.test.ts
//
// C-495 — pure ending-selection helpers and the explicit end-of-quest choice.
//
// Evidence unlocks an ending; it must never choose one. These tests lock that
// contract at both the pure-helper and service level, including save/reload and
// idempotency.
//
// Contract: C-495 Emberwatch dramatic structure

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ContentPackLoaderInterface, ContentPackQuestEntry } from '@aikami/types';

// QuestStateService reads the active campaign id directly from the campaign
// service and refuses to progress a quest without one.
mock.module('../campaign/campaign_service.svelte.ts', () => ({
  campaignService: { activeCampaign: { id: 'default-emberwatch' } },
}));

mock.module('$logger', () => ({
  logger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    log: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    spam: mock(() => {}),
    write: mock(() => {}),
    setLogLevel: mock(() => {}),
  },
}));

import { narrativeEventService } from './narrative_event_service.svelte.ts';
import { listEligibleEndings, selectDefaultEnding } from './quest_ending_selection';

describe('quest_ending_selection helpers (C-495)', () => {
  const unconditional = { title: 'Default', narration: 'x'.repeat(60), worldStateFlag: 'a.b' };
  const conditioned = {
    title: 'Conditioned',
    narration: 'y'.repeat(60),
    worldStateFlag: 'a.c',
    requiresWorldStateFlag: 'evidence.presented.ledger',
  };

  test('listEligibleEndings reports lock state in authored order', () => {
    const locked = listEligibleEndings({
      endings: { a: unconditional, b: conditioned },
      worldStateFlags: {},
    });
    expect(locked.map((e) => e.id)).toEqual(['a', 'b']);
    expect(locked[0].unlocked).toBe(true);
    expect(locked[1].unlocked).toBe(false);
    expect(locked[1].requiresWorldStateFlag).toBe('evidence.presented.ledger');

    const unlocked = listEligibleEndings({
      endings: { a: unconditional, b: conditioned },
      worldStateFlags: { 'evidence.presented.ledger': true },
    });
    expect(unlocked[1].unlocked).toBe(true);
  });

  test('selectDefaultEnding always resolves the unconditional ending', () => {
    expect(selectDefaultEnding({ endings: { a: unconditional, b: conditioned } })).toBe('a');
    expect(selectDefaultEnding({ endings: { b: conditioned, a: unconditional } })).toBe('a');
  });

  test('selectDefaultEnding refuses a locked outcome when all endings are conditioned', () => {
    expect(selectDefaultEnding({ endings: { b: conditioned, c: conditioned } })).toBeUndefined();
    expect(selectDefaultEnding({ endings: {} })).toBeUndefined();
  });
});

describe('explicit ending choice (C-495)', () => {
  let service: import('./quest_state_service.svelte').QuestStateServiceInterface;

  const quest: ContentPackQuestEntry = {
    id: 'dramatic_ward',
    name: 'The Dramatic Ward',
    description: 'A ward with three world-state-distinct endings.',
    offerDialogueKey: 'offer',
    progressDialogueKey: 'progress',
    objectives: [{ text: 'Resolve the ward', completeOnMapEnter: 'village' }],
    rewards: [{ type: 'gold', amount: 10 }],
    endings: {
      renewed: {
        title: 'Renewed',
        narration: 'The ward blazes bright once more and Emberwatch is safe again for a century.',
        reactionDialogueKey: 'elder_renewed',
        worldStateFlag: 'emberwatch.ending.renewed',
      },
      reconciled: {
        title: 'Reconciled',
        narration: 'The ledger reveals the truth and an uneasy truce settles over Emberwatch.',
        reactionDialogueKey: 'elder_reconciled',
        requiresWorldStateFlag: 'evidence.presented.the_ledger',
        worldStateFlag: 'emberwatch.ending.reconciled',
      },
      darkened: {
        title: 'Darkened',
        narration: 'The ward fails and the corruption creeps toward Emberwatch in the dark.',
        reactionDialogueKey: 'bram_darkened',
        requiresWorldStateFlag: 'evidence.presented.elders_seal',
        worldStateFlag: 'emberwatch.ending.darkened',
      },
    },
  };

  const loader: ContentPackLoaderInterface = {
    manifest: {
      maps: { village: { file: 'maps/village.json', name: 'Village' } },
      truthVariants: [
        { id: 'rollo_owns_the_ledger', label: 'Rollo', startingConditions: [] },
        { id: 'thalia_owns_the_seal', label: 'Thalia', startingConditions: [] },
      ],
      evidence: [
        {
          id: 'the_ledger',
          label: 'The Ledger',
          discoverableAt: 'merchant_shop',
          presentToNpcId: 'village_elder',
          supportsTruthId: 'rollo_owns_the_ledger',
        },
        {
          id: 'elders_seal',
          label: "The Elder's Seal",
          discoverableAt: 'village',
          presentToNpcId: 'rollo_grasper',
          supportsTruthId: 'thalia_owns_the_seal',
        },
      ],
    } as ContentPackLoaderInterface['manifest'],
    packId: 'emberwatch',
    resolveMapUrl: (m: string) => `maps/${m}.json`,
    resolveMapId: (u: string) => {
      const normalized = u.startsWith('/') ? u : `/${u}`;
      return normalized.endsWith('/maps/village.json') ? 'village' : undefined;
    },
    getDialogue: () => undefined,
    getStartingMap: () => ({ file: '', name: '' }),
    getNpc: () => undefined,
    getItem: () => undefined,
    getQuest: (id: string) => (id === 'dramatic_ward' ? quest : undefined),
    getEncounter: () => undefined,
    getAllQuests: () => [quest],
    getAllEncounters: () => [],
    getCredits: () => undefined,
    dispose: () => {},
  };

  beforeEach(async () => {
    const mod = await import('./quest_state_service.svelte');
    service = mod.questStateService;
    service.reset();
    service.configure({ contentPackLoader: loader });
    narrativeEventService.reset();
  });

  const presentLedger = (): void => {
    service.discoverEvidenceAt('merchant_shop');
    service.presentEvidence({
      evidenceId: 'the_ledger',
      campaignId: 'camp-choice',
      npcId: 'village_elder',
    });
  };

  /** Finishes the quest's only objective, which parks it at its resolution point. */
  const reachResolutionPoint = (): void => {
    service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/village.json' });
  };

  test('evidence unlocks but does not select a conditioned ending', () => {
    service.acceptQuest({ questId: 'dramatic_ward', npcId: 'village_elder' });
    presentLedger();
    expect(
      service.getEligibleEndings('dramatic_ward').find((e) => e.id === 'reconciled')?.unlocked,
    ).toBe(true);
    reachResolutionPoint();
    // Unlocked — and still uncommitted: nothing chose it.
    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBeUndefined();
    expect(service.worldStateFlags['emberwatch.ending.renewed']).toBeUndefined();
    expect(service.quests.find((q) => q.id === 'dramatic_ward')?.awaitingEndingChoice).toBe(true);
  });

  test('accepting the quest does not expose an actionable final choice', () => {
    service.acceptQuest({ questId: 'dramatic_ward', npcId: 'village_elder' });
    // Every ending is refused while the quest is still being played, even the
    // unconditional one — the conclusion belongs to the resolution point.
    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'renewed' })).toBe(false);
    presentLedger();
    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'reconciled' })).toBe(false);
    expect(service.quests.find((q) => q.id === 'dramatic_ward')?.awaitingEndingChoice).toBe(false);
    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBeUndefined();
  });

  test('a locked conditioned ending cannot be chosen even at the resolution point', () => {
    service.acceptQuest({ questId: 'dramatic_ward', npcId: 'village_elder' });
    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'darkened' })).toBe(false);
    reachResolutionPoint();
    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'darkened' })).toBe(false);
    expect(service.worldStateFlags['emberwatch.ending.darkened']).toBeUndefined();
  });

  test('an explicit choice is refused on a non-active or unknown quest', () => {
    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'renewed' })).toBe(false);
    expect(service.chooseEnding({ questId: 'nope', endingId: 'renewed' })).toBe(false);
    service.acceptQuest({ questId: 'dramatic_ward', npcId: 'village_elder' });
    reachResolutionPoint();
    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'not_an_ending' })).toBe(
      false,
    );
  });

  test('a committed choice resolves the quest and survives save/reload', () => {
    service.acceptQuest({ questId: 'dramatic_ward', npcId: 'village_elder' });
    presentLedger();
    reachResolutionPoint();

    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'reconciled' })).toBe(true);
    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBe(true);
    expect(service.quests.find((q) => q.id === 'dramatic_ward')?.status).toBe('completed');

    const saved = service.serialize();
    service.reset();
    service.configure({ contentPackLoader: loader });
    service.hydrate(saved);

    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBe(true);
    expect(service.journalEntries.filter((j) => j.questId === 'dramatic_ward')).toHaveLength(1);
    // Re-evaluating the same trigger must not grant a second ending or entry.
    service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/village.json' });
    expect(service.worldStateFlags['emberwatch.ending.renewed']).toBeUndefined();
    expect(service.journalEntries.filter((j) => j.questId === 'dramatic_ward')).toHaveLength(1);
  });

  test('a repeated selection after resolution is refused (idempotent)', () => {
    service.acceptQuest({ questId: 'dramatic_ward', npcId: 'village_elder' });
    reachResolutionPoint();
    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'renewed' })).toBe(true);
    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'renewed' })).toBe(false);
    expect(service.journalEntries.filter((j) => j.questId === 'dramatic_ward')).toHaveLength(1);
    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBeUndefined();
  });

  test('reload while the choice is pending preserves the waiting state', () => {
    service.acceptQuest({ questId: 'dramatic_ward', npcId: 'village_elder' });
    presentLedger();
    reachResolutionPoint();
    expect(service.quests.find((q) => q.id === 'dramatic_ward')?.awaitingEndingChoice).toBe(true);

    const saved = service.serialize();
    service.reset();
    service.configure({ contentPackLoader: loader });
    service.hydrate(saved);

    // Still waiting, still unresolved, still no ending flag committed.
    expect(service.quests.find((q) => q.id === 'dramatic_ward')?.awaitingEndingChoice).toBe(true);
    expect(service.quests.find((q) => q.id === 'dramatic_ward')?.status).toBe('active');
    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBeUndefined();
    // And the choice can still be made after the reload.
    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'reconciled' })).toBe(true);
    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBe(true);
  });

  test('two distinct conditioned endings resolve to distinct world state', () => {
    // The seal's evidence supports the OTHER sampled truth, so its flag is set
    // directly here; the truth-consistent path for the ledger is covered above.
    service.acceptQuest({ questId: 'dramatic_ward', npcId: 'village_elder' });
    service.setWorldStateFlag('evidence.presented.elders_seal');
    reachResolutionPoint();
    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'darkened' })).toBe(true);
    expect(service.worldStateFlags['emberwatch.ending.darkened']).toBe(true);
    expect(service.worldStateFlags['emberwatch.ending.renewed']).toBeUndefined();
    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBeUndefined();
  });

  test('completion without a choice never grants an all-conditioned outcome', () => {
    const reconciled = quest.endings?.reconciled;
    if (!reconciled) {
      throw new Error('conditioned ending fixture is required');
    }
    const conditionedOnlyQuest: ContentPackQuestEntry = {
      ...quest,
      id: 'conditioned_only',
      endings: { reconciled },
    };
    service.configure({
      contentPackLoader: {
        ...loader,
        getQuest: (id: string) =>
          id === conditionedOnlyQuest.id ? conditionedOnlyQuest : undefined,
        getAllQuests: () => [conditionedOnlyQuest],
      },
    });

    service.acceptQuest({ questId: conditionedOnlyQuest.id, npcId: 'village_elder' });
    service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/village.json' });

    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBeUndefined();
    expect(service.journalEntries.at(-1)?.endingId).toBeUndefined();
  });

  test('a quest whose conclusions are ALL locked never silently resolves one', () => {
    const { reconciled, darkened } = quest.endings ?? {};
    if (!reconciled || !darkened) {
      throw new Error('conditioned ending fixtures are required');
    }
    // Two authored conclusions, both gated on evidence that is never presented:
    // there is no valid choice to offer, so the quest must not be parked in a
    // state the player cannot leave, and must never fall back to a locked
    // ending. It resolves through the ordinary no-choice path instead.
    const lockedOnlyQuest: ContentPackQuestEntry = {
      ...quest,
      id: 'locked_only',
      endings: { reconciled, darkened },
    };
    service.configure({
      contentPackLoader: {
        ...loader,
        getQuest: (id: string) => (id === lockedOnlyQuest.id ? lockedOnlyQuest : undefined),
        getAllQuests: () => [lockedOnlyQuest],
      },
    });

    service.acceptQuest({ questId: lockedOnlyQuest.id, npcId: 'village_elder' });
    service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/village.json' });

    const questData = service.quests.find((q) => q.id === lockedOnlyQuest.id);
    expect(questData?.awaitingEndingChoice).toBeFalsy();
    expect(questData?.status).toBe('completed');
    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBeUndefined();
    expect(service.worldStateFlags['emberwatch.ending.darkened']).toBeUndefined();
    expect(service.journalEntries.at(-1)?.endingId).toBeUndefined();
  });
});
