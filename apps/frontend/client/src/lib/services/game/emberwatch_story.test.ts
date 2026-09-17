// apps/frontend/client/src/lib/services/game/emberwatch_story.test.ts
//
// C-495 story correctness against the SHIPPED Emberwatch pack.
//
// Every other C-495 test builds a synthetic loader; this one drives the real
// `content/packs/emberwatch/manifest.json` through the real services so that
// "the three endings are reachable" and "the side quests complete" are proven
// on the content that actually ships, not on a fixture that can drift from it.
//
// Contract: C-495 AC-2, AC-3, AC-5, AC-6

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ContentPackLoaderInterface } from '@aikami/frontend/engine';
import { ContentPackManifestSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import shippedManifest from '../../../../../../../content/packs/emberwatch/manifest.json';

// QuestStateService reads the active campaign (id + sampled truth) from the
// campaign service. The object is mutated per test so both sampled truths can
// be exercised from one module instance.
type TestCampaign = { id: string; sampledTruthId: string | undefined };

const activeCampaign: TestCampaign = { id: 'emberwatch-test', sampledTruthId: undefined };

mock.module('../campaign/campaign_service.svelte.ts', () => ({
  campaignService: { activeCampaign },
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

import { inventoryService } from './inventory_service.svelte';
import { narrativeEventService } from './narrative_event_service.svelte.ts';
import { playerStateService } from './player_state_service.svelte';
import { questStateService } from './quest_state_service.svelte';

const TRUTH_LEDGER = 'rollo_owns_the_ledger';
const TRUTH_SEAL = 'thalia_owns_the_seal';

const RENEWED = 'emberwatch.ending.renewed';
const RECONCILED = 'emberwatch.ending.reconciled';
const DARKENED = 'emberwatch.ending.darkened';

const raw: unknown = shippedManifest;
if (!Value.Check(ContentPackManifestSchema, raw)) {
  throw new Error('shipped emberwatch manifest failed ContentPackManifestSchema');
}

/** The shipped pack, wired exactly as the client wires it at boot. */
const loader: ContentPackLoaderInterface = {
  manifest: raw,
  packId: 'emberwatch',
  resolveMapUrl: (mapId: string) => {
    const entry = raw.maps[mapId];
    return entry ? entry.file : '';
  },
  resolveMapId: (url: string) => {
    const match = Object.entries(raw.maps).find(([, entry]) => url.endsWith(entry.file));
    return match?.[0];
  },
  getDialogue: (key: string) => raw.dialogues[key],
  getStartingMap: () => {
    const entry = raw.maps[raw.startingMapId];
    return entry ?? { file: '', name: '' };
  },
  getNpc: (id: string) => raw.npcs?.[id],
  getItem: (id: string) => raw.items?.[id],
  getQuest: (id: string) => raw.quests?.[id],
  getEncounter: (id: string) => raw.encounters?.[id],
  getProp: (id: string) => raw.props?.[id],
  getAllQuests: () => Object.values(raw.quests ?? {}),
  getAllEncounters: () => Object.values(raw.encounters ?? {}),
  getCredits: () => raw.credits,
  getFaction: (id: string) => raw.factions?.[id],
  getAllFactions: () => Object.values(raw.factions ?? {}),
  dispose: () => {},
};

/** Enters a map the way the engine bridge does. */
const enterMap = (mapId: string): void => {
  questStateService.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: loader.resolveMapUrl(mapId) });
};

const talkTo = (npcId: string): void => {
  questStateService.evaluateTriggers({ type: 'NPC_INTERACTED', npcId });
};

const pickUp = (itemId: string): void => {
  questStateService.evaluateTriggers({ type: 'ITEM_PICKED_UP', itemId });
};

/**
 * Walks the Fading Ward through its authored objective chain up to (not
 * including) the final conversation, so each ending test starts from a quest
 * that is one trigger away from its resolution point.
 */
const advanceToFinalObjective = (options: { wandObtained: boolean }): void => {
  questStateService.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
  enterMap('inn');
  if (options.wandObtained) {
    pickUp('wardWand');
    enterMap('old_road');
    enterMap('ruined_shrine');
  }
};

/** The active Fading Ward projection, or undefined once it resolves. */
const fadingWard = ():
  | { status: string; awaitingEndingChoice?: boolean; chosenEndingId?: string }
  | undefined => questStateService.quests.find((quest) => quest.id === 'fading_ward');

/** Presents one evidence item end to end: discover at its authored location, then hand it over. */
const presentAuthoredEvidence = (options: {
  evidenceId: string;
  location: string;
  npcId: string;
}): boolean => {
  const discovered = questStateService.discoverEvidenceAt(options.location);
  expect(discovered).toContain(options.evidenceId);
  const event = questStateService.presentEvidence({
    evidenceId: options.evidenceId,
    campaignId: activeCampaign.id,
    npcId: options.npcId,
  });
  return Boolean(event);
};

const resolveFadingWard = (): void => {
  talkTo('village_elder');
};

beforeEach(() => {
  activeCampaign.id = 'emberwatch-test';
  activeCampaign.sampledTruthId = undefined;
  questStateService.reset();
  narrativeEventService.reset();
  inventoryService.reset();
  playerStateService.reset();
  questStateService.configure({ contentPackLoader: loader });
});

// ---------------------------------------------------------------------------
// Endings (AC-3)
// ---------------------------------------------------------------------------

describe('shipped Emberwatch — the three endings (C-495 AC-3)', () => {
  test('the pack declares exactly the three world-state-distinct endings', () => {
    const endings = raw.quests?.fading_ward?.endings ?? {};
    const flags = Object.values(endings).map((ending) => ending.worldStateFlag);
    expect(Object.keys(endings).sort()).toEqual([
      'ward_darkened',
      'ward_reconciled',
      'ward_renewed',
    ]);
    expect(new Set(flags).size).toBe(3);
    // Exactly one ending is unconditional.
    expect(Object.values(endings).filter((e) => !e.requiresWorldStateFlag)).toHaveLength(1);
  });

  test('accepting the quest does not expose an actionable final choice', () => {
    advanceToFinalObjective({ wandObtained: true });

    // The quest is still being played: nothing is resolution-ready and every
    // ending — including the unconditional one — is refused.
    expect(fadingWard()?.awaitingEndingChoice).toBe(false);
    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_renewed' }),
    ).toBe(false);
    expect(questStateService.worldStateFlags[RENEWED]).toBeUndefined();
    expect(questStateService.worldStateFlags[RECONCILED]).toBeUndefined();
    expect(questStateService.worldStateFlags[DARKENED]).toBeUndefined();
  });

  test('finishing the required objectives parks the quest instead of resolving it', () => {
    advanceToFinalObjective({ wandObtained: true });
    resolveFadingWard();

    // Resolution-ready, still active, and NO ending committed by evidence or
    // by the act of finishing the objectives.
    expect(fadingWard()?.status).toBe('active');
    expect(fadingWard()?.awaitingEndingChoice).toBe(true);
    expect(questStateService.worldStateFlags[RENEWED]).toBeUndefined();
    expect(questStateService.worldStateFlags[RECONCILED]).toBeUndefined();
    expect(questStateService.worldStateFlags[DARKENED]).toBeUndefined();
    expect(questStateService.journalEntries).toHaveLength(0);
  });

  test('no choice means no ending world-state flag is ever committed', () => {
    activeCampaign.sampledTruthId = TRUTH_LEDGER;
    advanceToFinalObjective({ wandObtained: true });
    presentAuthoredEvidence({
      evidenceId: 'the_ledger',
      location: 'merchant_shop:shop_counter_l',
      npcId: 'village_elder',
    });
    resolveFadingWard();

    // Evidence is presented and the quest is at its resolution point, but the
    // player has decided nothing.
    expect(questStateService.worldStateFlags['evidence.presented.the_ledger']).toBe(true);
    expect(questStateService.worldStateFlags[RENEWED]).toBeUndefined();
    expect(questStateService.worldStateFlags[RECONCILED]).toBeUndefined();
    expect(questStateService.worldStateFlags[DARKENED]).toBeUndefined();
    expect(questStateService.journalEntries).toHaveLength(0);
  });

  test('the unconditioned conclusion can be chosen explicitly at the resolution point', () => {
    advanceToFinalObjective({ wandObtained: true });
    resolveFadingWard();

    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_renewed' }),
    ).toBe(true);

    expect(questStateService.worldStateFlags[RENEWED]).toBe(true);
    expect(questStateService.worldStateFlags[RECONCILED]).toBeUndefined();
    expect(questStateService.worldStateFlags[DARKENED]).toBeUndefined();
    expect(fadingWard()?.status).toBe('completed');
    expect(fadingWard()?.awaitingEndingChoice).toBeFalsy();
  });

  test('evidence unlocks the ledger ending but never selects it', () => {
    activeCampaign.sampledTruthId = TRUTH_LEDGER;
    advanceToFinalObjective({ wandObtained: true });
    expect(
      presentAuthoredEvidence({
        evidenceId: 'the_ledger',
        location: 'merchant_shop:shop_counter_l',
        npcId: 'village_elder',
      }),
    ).toBe(true);

    const reconciled = questStateService
      .getEligibleEndings('fading_ward')
      .find((ending) => ending.id === 'ward_reconciled');
    expect(reconciled?.unlocked).toBe(true);

    resolveFadingWard();
    // Presenting the evidence set its flag, but nothing was selected.
    expect(questStateService.worldStateFlags[RECONCILED]).toBeUndefined();
    expect(questStateService.worldStateFlags[RENEWED]).toBeUndefined();
    expect(questStateService.worldStateFlags[DARKENED]).toBeUndefined();
  });

  test('an explicit choice of the ledger ending resolves it', () => {
    activeCampaign.sampledTruthId = TRUTH_LEDGER;
    advanceToFinalObjective({ wandObtained: true });
    presentAuthoredEvidence({
      evidenceId: 'the_ledger',
      location: 'merchant_shop:shop_counter_l',
      npcId: 'village_elder',
    });
    resolveFadingWard();
    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_reconciled' }),
    ).toBe(true);

    expect(questStateService.worldStateFlags[RECONCILED]).toBe(true);
    expect(questStateService.worldStateFlags[RENEWED]).toBeUndefined();
    expect(questStateService.worldStateFlags[DARKENED]).toBeUndefined();
  });

  test('the second conditioned ending resolves to distinct world state', () => {
    activeCampaign.sampledTruthId = TRUTH_SEAL;
    advanceToFinalObjective({ wandObtained: true });
    expect(
      presentAuthoredEvidence({
        evidenceId: 'elders_seal',
        location: 'village:village_well',
        npcId: 'rollo_grasper',
      }),
    ).toBe(true);
    resolveFadingWard();
    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_darkened' }),
    ).toBe(true);

    expect(questStateService.worldStateFlags[DARKENED]).toBe(true);
    expect(questStateService.worldStateFlags[RENEWED]).toBeUndefined();
    expect(questStateService.worldStateFlags[RECONCILED]).toBeUndefined();
  });

  test('a conditioned ending is refused while its evidence flag is unset', () => {
    advanceToFinalObjective({ wandObtained: true });
    resolveFadingWard();

    // At the resolution point, but the conditioned conclusions are locked.
    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_reconciled' }),
    ).toBe(false);
    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_darkened' }),
    ).toBe(false);
    expect(questStateService.worldStateFlags[RECONCILED]).toBeUndefined();
    expect(questStateService.worldStateFlags[DARKENED]).toBeUndefined();

    // The quest is still awaiting a decision, and the unlocked one still works.
    expect(fadingWard()?.awaitingEndingChoice).toBe(true);
    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_renewed' }),
    ).toBe(true);
    expect(questStateService.worldStateFlags[RENEWED]).toBe(true);
  });

  test('a choice made after the quest resolved is refused', () => {
    advanceToFinalObjective({ wandObtained: true });
    resolveFadingWard();
    questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_renewed' });

    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_renewed' }),
    ).toBe(false);
    expect(questStateService.worldStateFlags[RENEWED]).toBe(true);
    expect(
      questStateService.journalEntries.filter((e) => e.questId === 'fading_ward'),
    ).toHaveLength(1);
  });

  test('rewards, the QuestResolved event and the journal entry are emitted exactly once', () => {
    advanceToFinalObjective({ wandObtained: true });
    resolveFadingWard();

    const goldBefore = inventoryService.gold;
    const xpBefore = playerStateService.playerXp;
    const resolvedBefore = narrativeEventService.events.filter(
      (event) => event.kind === 'QuestResolved' && event.subjectId === 'fading_ward',
    ).length;

    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_renewed' }),
    ).toBe(true);

    expect(inventoryService.gold - goldBefore).toBe(150);
    expect(playerStateService.playerXp - xpBefore).toBe(300);
    expect(
      narrativeEventService.events.filter(
        (event) => event.kind === 'QuestResolved' && event.subjectId === 'fading_ward',
      ).length - resolvedBefore,
    ).toBe(1);
    expect(
      questStateService.journalEntries.filter((e) => e.questId === 'fading_ward'),
    ).toHaveLength(1);

    // A repeated selection/completion call changes nothing.
    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_renewed' }),
    ).toBe(false);
    expect(inventoryService.gold - goldBefore).toBe(150);
    expect(
      narrativeEventService.events.filter(
        (event) => event.kind === 'QuestResolved' && event.subjectId === 'fading_ward',
      ).length - resolvedBefore,
    ).toBe(1);
    expect(
      questStateService.journalEntries.filter((e) => e.questId === 'fading_ward'),
    ).toHaveLength(1);
  });

  test('a reload while the choice is pending preserves the waiting state', () => {
    activeCampaign.sampledTruthId = TRUTH_LEDGER;
    advanceToFinalObjective({ wandObtained: true });
    presentAuthoredEvidence({
      evidenceId: 'the_ledger',
      location: 'merchant_shop:shop_counter_l',
      npcId: 'village_elder',
    });
    resolveFadingWard();

    const saved = questStateService.serialize();
    questStateService.reset();
    questStateService.configure({ contentPackLoader: loader });
    questStateService.hydrate(saved);

    // Still resolution-ready, still unresolved, still no ending committed —
    // and the unlocked choice is still available.
    expect(fadingWard()?.status).toBe('active');
    expect(fadingWard()?.awaitingEndingChoice).toBe(true);
    expect(questStateService.worldStateFlags[RECONCILED]).toBeUndefined();
    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_reconciled' }),
    ).toBe(true);
    expect(questStateService.worldStateFlags[RECONCILED]).toBe(true);
  });

  test('a chosen ending survives a reload exactly once', () => {
    activeCampaign.sampledTruthId = TRUTH_LEDGER;
    advanceToFinalObjective({ wandObtained: true });
    presentAuthoredEvidence({
      evidenceId: 'the_ledger',
      location: 'merchant_shop:shop_counter_l',
      npcId: 'village_elder',
    });
    resolveFadingWard();
    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_reconciled' }),
    ).toBe(true);

    const saved = questStateService.serialize();
    questStateService.reset();
    questStateService.configure({ contentPackLoader: loader });
    questStateService.hydrate(saved);

    expect(questStateService.worldStateFlags[RECONCILED]).toBe(true);
    expect(questStateService.worldStateFlags[RENEWED]).toBeUndefined();
    expect(questStateService.worldStateFlags[DARKENED]).toBeUndefined();
    expect(
      questStateService.journalEntries.filter((e) => e.questId === 'fading_ward'),
    ).toHaveLength(1);
    expect(fadingWard()?.status).toBe('completed');
    expect(fadingWard()?.awaitingEndingChoice).toBeFalsy();
  });

  test('a failed persuasion check leaves the wand unheld, so no ending resolves', () => {
    // The inn encounter's non-combat check (persuasion DC 12) has a failure
    // branch that grants no loot; the wand only arrives on victory or success.
    advanceToFinalObjective({ wandObtained: false });
    resolveFadingWard();

    // Objective 4 ("Obtain the Ward Wand") is still open, so the quest never
    // reached the decide-the-fate step and no ending resolved.
    expect(questStateService.worldStateFlags[RENEWED]).toBeUndefined();
    expect(questStateService.worldStateFlags[RECONCILED]).toBeUndefined();
    expect(questStateService.worldStateFlags[DARKENED]).toBeUndefined();
    expect(questStateService.quests.some((quest) => quest.id === 'fading_ward')).toBe(true);
    expect(fadingWard()?.awaitingEndingChoice).toBeFalsy();
  });

  test('an optional side objective cannot end the main quest early', () => {
    // "Ask Sella how the wand came to the inn" is an optional, terminal branch.
    // Completing it must not skip the wand, the old road, the shrine and the
    // elder's final decision — the quest's authored resolution point.
    questStateService.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
    enterMap('inn');
    talkTo('innkeeper_sella');

    expect(fadingWard()?.status).toBe('active');
    expect(fadingWard()?.awaitingEndingChoice).toBeFalsy();
    expect(questStateService.worldStateFlags[RENEWED]).toBeUndefined();
    expect(questStateService.worldStateFlags[RECONCILED]).toBeUndefined();
    expect(questStateService.worldStateFlags[DARKENED]).toBeUndefined();

    // The required chain is still walkable from here.
    pickUp('wardWand');
    enterMap('old_road');
    enterMap('ruined_shrine');
    resolveFadingWard();
    expect(fadingWard()?.awaitingEndingChoice).toBe(true);
  });

  test('the darkened ending needs no recruited Bram', () => {
    // Its reaction line is Bram's, but the ending must not require him in the
    // party — a player who never recruited the guard still gets the ending.
    activeCampaign.sampledTruthId = TRUTH_SEAL;
    advanceToFinalObjective({ wandObtained: true });
    presentAuthoredEvidence({
      evidenceId: 'elders_seal',
      location: 'village:village_well',
      npcId: 'rollo_grasper',
    });
    resolveFadingWard();
    expect(
      questStateService.chooseEnding({ questId: 'fading_ward', endingId: 'ward_darkened' }),
    ).toBe(true);

    expect(questStateService.worldStateFlags[DARKENED]).toBe(true);
    expect(raw.dialogues.bram_ending_darkened).toBeDefined();
    const journal = questStateService.journalEntries.find(
      (entry) => entry.questId === 'fading_ward',
    );
    expect(journal?.endingId).toBe('ward_darkened');
  });
});

// ---------------------------------------------------------------------------
// Evidence (AC-2, AC-5)
// ---------------------------------------------------------------------------

describe('shipped Emberwatch — evidence (C-495 AC-2/AC-5)', () => {
  test('the ledger truth exposes the ledger pair and hides the seal pair', () => {
    activeCampaign.sampledTruthId = TRUTH_LEDGER;
    expect(questStateService.discoverEvidenceAt('merchant_shop:shop_counter_l')).toEqual([
      'the_ledger',
    ]);
    expect(questStateService.discoverEvidenceAt('inn:sella_receipt')).toEqual(['sella_receipt']);
    expect(questStateService.discoverEvidenceAt('village:village_well')).toEqual([]);
    expect(questStateService.discoverEvidenceAt('old_road:tess_component')).toEqual([]);
  });

  test('the seal truth exposes the seal pair and hides the ledger pair', () => {
    activeCampaign.sampledTruthId = TRUTH_SEAL;
    expect(questStateService.discoverEvidenceAt('village:village_well')).toEqual(['elders_seal']);
    expect(questStateService.discoverEvidenceAt('old_road:tess_component')).toEqual([
      'tess_component',
    ]);
    expect(questStateService.discoverEvidenceAt('merchant_shop:shop_counter_l')).toEqual([]);
  });

  test('a stale campaign resolves no evidence before truth fallback', () => {
    activeCampaign.sampledTruthId = TRUTH_LEDGER;
    questStateService.discoverEvidenceAt('merchant_shop:shop_counter_l');

    expect(questStateService.getDiscoverableEvidence('stale-campaign')).toEqual([]);
    expect(questStateService.getDiscoverableEvidence(activeCampaign.id).map((e) => e.id)).toContain(
      'the_ledger',
    );
  });

  test('repeated presentation records exactly one EvidencePresented event', () => {
    activeCampaign.sampledTruthId = TRUTH_LEDGER;
    expect(
      presentAuthoredEvidence({
        evidenceId: 'the_ledger',
        location: 'merchant_shop:shop_counter_l',
        npcId: 'village_elder',
      }),
    ).toBe(true);
    const second = questStateService.presentEvidence({
      evidenceId: 'the_ledger',
      campaignId: activeCampaign.id,
      npcId: 'village_elder',
    });
    expect(second).toBeUndefined();
    expect(
      narrativeEventService.events.filter(
        (event) => event.kind === 'EvidencePresented' && event.subjectId === 'the_ledger',
      ),
    ).toHaveLength(1);
  });

  test('evidence supporting the other sampled truth cannot be presented', () => {
    activeCampaign.sampledTruthId = TRUTH_LEDGER;
    questStateService.discoverEvidenceAt('merchant_shop:shop_counter_l');
    const seal = questStateService.presentEvidence({
      evidenceId: 'elders_seal',
      campaignId: activeCampaign.id,
      npcId: 'rollo_grasper',
    });
    expect(seal).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Side quests
// ---------------------------------------------------------------------------

describe('shipped Emberwatch — side quests complete on their authored triggers', () => {
  test('every objective in every shipped quest declares a supported completion hook', () => {
    const hooks = [
      'completeOnMapEnter',
      'completeOnNpcInteract',
      'completeOnEncounterComplete',
      'completeOnItemPickup',
    ];
    const unsupported: string[] = [];
    for (const quest of Object.values(raw.quests ?? {})) {
      quest.objectives.forEach((objective, index) => {
        if (!hooks.some((hook) => objective[hook as keyof typeof objective] !== undefined)) {
          unsupported.push(`${quest.id}#${index} "${objective.text}"`);
        }
      });
    }
    expect(unsupported).toEqual([]);
  });

  test('every authored completion target resolves to a real map, NPC, encounter or item', () => {
    const missing: string[] = [];
    for (const quest of Object.values(raw.quests ?? {})) {
      for (const objective of quest.objectives) {
        if (objective.completeOnMapEnter && !raw.maps[objective.completeOnMapEnter]) {
          missing.push(`map ${objective.completeOnMapEnter}`);
        }
        if (objective.completeOnNpcInteract && !raw.npcs?.[objective.completeOnNpcInteract]) {
          missing.push(`npc ${objective.completeOnNpcInteract}`);
        }
        if (
          objective.completeOnEncounterComplete &&
          !raw.encounters?.[objective.completeOnEncounterComplete]
        ) {
          missing.push(`encounter ${objective.completeOnEncounterComplete}`);
        }
        if (objective.completeOnItemPickup && !raw.items?.[objective.completeOnItemPickup]) {
          missing.push(`item ${objective.completeOnItemPickup}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('tools_for_tomorrow completes through Orra → the old road → Orra', () => {
    expect(
      questStateService.acceptQuest({ questId: 'tools_for_tomorrow', npcId: 'smith_orra' }),
    ).toBe(true);
    // The offering conversation satisfies objective 0 (auto-completed on accept).
    enterMap('old_road');
    talkTo('smith_orra');

    expect(questStateService.worldStateFlags['emberwatch.side.tools_for_tomorrow']).toBe(true);
  });

  test('a_room_kept_warm completes through Sella → Tess → Sella', () => {
    expect(
      questStateService.acceptQuest({ questId: 'a_room_kept_warm', npcId: 'innkeeper_sella' }),
    ).toBe(true);
    enterMap('old_road');
    talkTo('apprentice_tess');
    enterMap('inn');
    talkTo('innkeeper_sella');

    expect(questStateService.worldStateFlags['emberwatch.side.a_room_kept_warm']).toBe(true);
  });

  test('mark_the_safe_trail completes without leaving and re-entering the old road', () => {
    // Ada offers the quest while standing ON the old road, and her objective 1
    // is a map entry — acceptQuest's retroactive pass must satisfy it, so the
    // player is never asked to walk out and back in.
    enterMap('old_road');
    expect(
      questStateService.acceptQuest({ questId: 'mark_the_safe_trail', npcId: 'woodcutter_ada' }),
    ).toBe(true);
    enterMap('village');
    talkTo('cartographer_ivo');

    expect(questStateService.worldStateFlags['emberwatch.side.mark_the_safe_trail']).toBe(true);
  });

  test('each side quest grants its authored reward once', () => {
    const goldBefore = inventoryService.gold;
    questStateService.acceptQuest({ questId: 'tools_for_tomorrow', npcId: 'smith_orra' });
    enterMap('old_road');
    talkTo('smith_orra');
    const goldAfter = inventoryService.gold;
    expect(goldAfter - goldBefore).toBe(75);

    // A second resolve attempt must not pay out again.
    talkTo('smith_orra');
    expect(inventoryService.gold).toBe(goldAfter);
  });
});
