// apps/frontend/client/src/lib/services/game/quest_dramatic_structure.test.ts
//
// C-495 — dramatic structure against a synthetic three-ending quest: the
// evidence lifecycle (discovery, presentation, truth consistency) and the
// explicit ending choice it unlocks.
//
// Split out of `quest_state_service.test.ts` when that file reached its
// grandfathered size ceiling: these tests exercise the C-495 evidence/ending
// surface, not the C-339 completion pipeline the parent file owns.
//
// Contract: C-495 Emberwatch dramatic structure

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ContentPackLoaderInterface, ContentPackQuestEntry } from '@aikami/types';

mock.module('../campaign/campaign_service.svelte.ts', () => ({
  campaignService: { activeCampaign: { id: 'default-emberwatch' } },
}));

import { narrativeEventService } from './narrative_event_service.svelte.ts';

// ── C-495: Dramatic structure — evidence presentation + ending selection ──
describe('C-495 dramatic structure', () => {
  let service: import('./quest_state_service.svelte').QuestStateServiceInterface;

  const DramaticQuest: ContentPackQuestEntry = {
    id: 'dramatic_ward',
    name: 'The Dramatic Ward',
    description: 'A ward with three world-state-distinct endings.',
    offerDialogueKey: 'dramatic_offer',
    progressDialogueKey: 'dramatic_progress',
    objectives: [{ text: 'Resolve the ward', completeOnMapEnter: 'village' }],
    rewards: [{ type: 'gold', amount: 10 }],
    endings: {
      renewed: {
        title: 'Renewed',
        narration:
          'The ward blazes bright once more and Emberwatch is safe for another century of peace under the warm sun.',
        reactionDialogueKey: 'elder_ending_renewed',
        worldStateFlag: 'emberwatch.ending.renewed',
      },
      reconciled: {
        title: 'Reconciled',
        narration:
          'The ledger reveals the truth and the village does not turn against Rollo, but an uneasy truce settles over Emberwatch for good.',
        reactionDialogueKey: 'elder_ending_reconciled',
        requiresWorldStateFlag: 'evidence.presented.the_ledger',
        worldStateFlag: 'emberwatch.ending.reconciled',
      },
      darkened: {
        title: 'Darkened',
        narration:
          'The ward fails and the corruption creeps toward Emberwatch as every face in the square carries the weight of what was lost.',
        reactionDialogueKey: 'bram_ending_darkened',
        requiresWorldStateFlag: 'evidence.presented.elders_seal',
        worldStateFlag: 'emberwatch.ending.darkened',
      },
    },
  };

  const dramaticLoader: ContentPackLoaderInterface = {
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
    getQuest: (id: string) => (id === 'dramatic_ward' ? DramaticQuest : undefined),
    getEncounter: () => undefined,
    getAllQuests: () => [DramaticQuest],
    getAllEncounters: () => [],
    getCredits: () => undefined,
    dispose: () => {},
  };

  beforeEach(async () => {
    const mod = await import('./quest_state_service.svelte');
    service = mod.questStateService;
    service.reset();
    service.configure({ contentPackLoader: dramaticLoader });
    // narrativeEventService is a module singleton — reset so evidence events
    // don't leak between tests in this describe block.
    narrativeEventService.reset();
  });

  test('AC-2: presenting discoverable evidence records exactly one EvidencePresented event', () => {
    service.discoverEvidenceAt('merchant_shop');
    const event = service.presentEvidence({
      evidenceId: 'the_ledger',
      campaignId: 'camp-1',
      npcId: 'village_elder',
    });
    expect(event).toBeDefined();
    expect(event?.kind).toBe('EvidencePresented');
    const presented = narrativeEventService.events.filter(
      (e) => e.kind === 'EvidencePresented' && e.subjectId === 'the_ledger',
    );
    expect(presented).toHaveLength(1);
  });

  test('AC-2: presenting the same evidence twice does not record twice (idempotent)', () => {
    service.discoverEvidenceAt('merchant_shop');
    service.presentEvidence({
      evidenceId: 'the_ledger',
      campaignId: 'camp-1',
      npcId: 'village_elder',
    });
    const second = service.presentEvidence({
      evidenceId: 'the_ledger',
      campaignId: 'camp-1',
      npcId: 'village_elder',
    });
    expect(second).toBeUndefined();
    const presented = narrativeEventService.events.filter(
      (e) => e.kind === 'EvidencePresented' && e.subjectId === 'the_ledger',
    );
    expect(presented).toHaveLength(1);
  });

  test('AC-2: evidence inconsistent with the sampled truth is not presentable', () => {
    service.discoverEvidenceAt('merchant_shop');
    const event = service.presentEvidence({
      evidenceId: 'the_ledger',
      campaignId: 'camp-2',
      npcId: 'village_elder',
    });
    // With no sampled truth, the default (first) variant is rollo_owns_the_ledger,
    // so the_ledger IS consistent. elders_seal is NOT (it supports thalia's).
    const sealEvent = service.presentEvidence({
      evidenceId: 'elders_seal',
      campaignId: 'camp-2',
      npcId: 'rollo_grasper',
    });
    expect(event).toBeDefined();
    expect(sealEvent).toBeUndefined();
  });

  test('AC-2: undiscovered evidence cannot emit an event or set the ending flag', () => {
    const event = service.presentEvidence({
      evidenceId: 'the_ledger',
      campaignId: 'camp-2',
      npcId: 'village_elder',
    });
    expect(event).toBeUndefined();
    expect(narrativeEventService.events).toHaveLength(0);
    expect(service.worldStateFlags['evidence.presented.the_ledger']).toBeUndefined();
  });

  test('AC-2: evidence cannot be presented to an NPC other than its authored recipient', () => {
    service.discoverEvidenceAt('merchant_shop');
    const event = service.presentEvidence({
      evidenceId: 'the_ledger',
      campaignId: 'camp-2',
      npcId: 'rollo_grasper',
    });
    expect(event).toBeUndefined();
    expect(narrativeEventService.events).toHaveLength(0);
    expect(service.worldStateFlags['evidence.presented.the_ledger']).toBeUndefined();
  });

  test('AC-3: evidence unlocks a conditioned ending and an explicit choice resolves it', () => {
    service.acceptQuest({ questId: 'dramatic_ward', npcId: 'village_elder' });
    // Presenting the ledger UNLOCKS reconciled — it must not auto-select it.
    service.discoverEvidenceAt('merchant_shop');
    service.presentEvidence({
      evidenceId: 'the_ledger',
      campaignId: 'camp-3',
      npcId: 'village_elder',
    });
    expect(
      service.getEligibleEndings('dramatic_ward').find((e) => e.id === 'reconciled')?.unlocked,
    ).toBe(true);
    // Completing the objective parks the quest at its resolution point — the
    // unlock is not a selection.
    service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/village.json' });
    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBeUndefined();
    expect(service.worldStateFlags['emberwatch.ending.renewed']).toBeUndefined();
    expect(service.quests.find((q) => q.id === 'dramatic_ward')?.awaitingEndingChoice).toBe(true);

    // The explicit choice is what resolves it.
    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'reconciled' })).toBe(true);
    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBe(true);
    expect(service.worldStateFlags['emberwatch.ending.renewed']).toBeUndefined();
  });

  test('AC-3: the player may still choose the unconditioned ending explicitly', () => {
    service.acceptQuest({ questId: 'dramatic_ward', npcId: 'village_elder' });
    service.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: 'maps/village.json' });
    expect(service.chooseEnding({ questId: 'dramatic_ward', endingId: 'renewed' })).toBe(true);
    expect(service.worldStateFlags['emberwatch.ending.renewed']).toBe(true);
    expect(service.worldStateFlags['emberwatch.ending.reconciled']).toBeUndefined();
  });

  test('AC-5: getDiscoverableEvidence reflects the single sampled truth', () => {
    expect(service.getDiscoverableEvidence()).toHaveLength(0);
    service.discoverEvidenceAt('merchant_shop');
    const evidence = service.getDiscoverableEvidence();
    const ids = evidence.map((e) => e.id);
    expect(ids).toContain('the_ledger');
  });

  test('AC-2: discovered evidence persists through quest-state serialization', () => {
    service.discoverEvidenceAt('merchant_shop');
    const saved = service.serialize();

    service.reset();
    service.configure({ contentPackLoader: dramaticLoader });
    service.hydrate(saved);

    expect(service.getDiscoverableEvidence().map((e) => e.id)).toContain('the_ledger');
  });
});
