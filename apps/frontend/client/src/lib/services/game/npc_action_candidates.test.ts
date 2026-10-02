// apps/frontend/client/src/lib/services/game/npc_action_candidates.test.ts
//
// Regression coverage for the enumerated candidate set (issue #381, lane C).
//
// These tests pin the claims the task makes. If any of them is wrong, the
// whole justification for routing a decision backend here is wrong.

import { describe, expect, it } from 'bun:test';
import {
  buildNpcActionCandidateInput,
  commandForActionId,
  enumerateNpcActionCandidates,
  NPC_ACTION_NONE_ID,
  type NpcActionCandidateInput,
  optionDescriptionsFor,
} from './npc_action_candidates.ts';

const base = (overrides: Partial<NpcActionCandidateInput> = {}): NpcActionCandidateInput => ({
  npcId: 'village_elder',
  npcName: 'Elder Thalia',
  allowedCommands: ['offerQuest', 'skillCheck', 'presentEvidence'],
  isVendor: false,
  isCompanion: false,
  hasCombatStats: false,
  vendorInventory: [],
  offerableQuests: [{ id: 'fading_ward', name: 'The Fading Ward' }],
  discoverableEvidence: [],
  ...overrides,
});

const ids = (input: NpcActionCandidateInput): string[] =>
  enumerateNpcActionCandidates(input).candidates.map((candidate) => candidate.id);

describe('npc action candidates — authorization', () => {
  it('always offers `none`, first, because most turns change nothing', () => {
    const set = enumerateNpcActionCandidates(base());
    expect(set.candidates[0]?.id).toBe(NPC_ACTION_NONE_ID);
    expect(set.candidates[0]?.command).toBeUndefined();
  });

  it('derives giveItem instances from the NPC inventory, with the real item id', () => {
    const result = ids(
      base({
        allowedCommands: ['giveItem'],
        isVendor: true,
        vendorInventory: ['ironSword', 'healthPotion'],
      }),
    );
    expect(result).toContain('giveItem:ironSword');
    expect(result).toContain('giveItem:healthPotion');
  });

  it('derives offerQuest instances from the quests THIS npc may offer', () => {
    const result = ids(base({ offerableQuests: [{ id: 'fading_ward', name: 'The Fading Ward' }] }));
    expect(result).toContain('offerQuest:fading_ward');
  });

  it('never offers an evidence item addressed to a different npc', () => {
    const result = ids(
      base({
        discoverableEvidence: [
          {
            id: 'the_ledger',
            label: "The Merchant's Repair Ledger",
            presentToNpcId: 'village_elder',
          },
          {
            id: 'tess_component',
            label: 'Intact Ward Component',
            presentToNpcId: 'shrine_keeper_nemi',
          },
        ],
      }),
    );
    expect(result).toContain('presentEvidence:the_ledger');
    // The whole point: an option the npc is not the recipient of is not offered.
    expect(result).not.toContain('presentEvidence:tess_component');
  });

  it('does not offer a zero-payload kind the npc is not entitled to', () => {
    // `trade` is in allowedCommands but the NPC is not a vendor.
    expect(ids(base({ allowedCommands: ['trade'] }))).not.toContain('trade');
    // `recruit` is in allowedCommands but the NPC is not recruitable.
    expect(ids(base({ allowedCommands: ['recruit'] }))).not.toContain('recruit');
    // `startCombat` is in allowedCommands but the NPC has no combat stats.
    expect(ids(base({ allowedCommands: ['startCombat'] }))).not.toContain('startCombat');
  });

  it('offers a zero-payload kind when the world state entitles the npc', () => {
    expect(ids(base({ allowedCommands: ['trade'], isVendor: true }))).toContain('trade');
    expect(ids(base({ allowedCommands: ['recruit'], isCompanion: true }))).toContain('recruit');
    expect(ids(base({ allowedCommands: ['startCombat'], hasCombatStats: true }))).toContain(
      'startCombat',
    );
  });

  it('carries a fully-formed command with real payload ids, not a bare kind', () => {
    const set = enumerateNpcActionCandidates(
      base({ offerableQuests: [{ id: 'fading_ward', name: 'The Fading Ward' }] }),
    );
    expect(commandForActionId(set, 'offerQuest:fading_ward')).toEqual({
      kind: 'offerQuest',
      questId: 'fading_ward',
    });
  });

  it('gives giveItem a quantity of 1 rather than inventing one', () => {
    const set = enumerateNpcActionCandidates(
      base({ allowedCommands: ['giveItem'], isVendor: true, vendorInventory: ['ironSword'] }),
    );
    expect(commandForActionId(set, 'giveItem:ironSword')).toEqual({
      kind: 'giveItem',
      itemId: 'ironSword',
      quantity: 1,
    });
  });
});

describe('npc action candidates — the authorization gap this closes', () => {
  it("cannot offer another npc's quest, because the enumeration never contained it", () => {
    // The shipping precondition only checks the quest EXISTS in the pack, so
    // `tools_for_tomorrow` is reachable for the elder today. It is not an option
    // here, so it cannot be selected, and no validator has to catch it.
    const set = enumerateNpcActionCandidates(
      base({
        npcId: 'village_elder',
        offerableQuests: [{ id: 'fading_ward', name: 'The Fading Ward' }],
      }),
    );
    expect(commandForActionId(set, 'offerQuest:tools_for_tomorrow')).toBeUndefined();
  });
});

describe('npc action candidates — nothing is truncated silently', () => {
  it('reports skillCheck as non-enumerable rather than dropping it', () => {
    const set = enumerateNpcActionCandidates(
      base({ allowedCommands: ['skillCheck', 'offerQuest'] }),
    );
    expect(set.candidates.some((candidate) => candidate.kind === 'skillCheck')).toBe(false);
    const omission = set.omissions.find((entry) => entry.kind === 'skillCheck');
    expect(omission?.reason).toBe('not-enumerable-from-world-state');
  });

  it('clears `complete` and records the bound when the candidate set is too wide', () => {
    const inventory = Array.from({ length: 40 }, (_, index) => `item_${index}`);
    const set = enumerateNpcActionCandidates(
      base({
        allowedCommands: ['giveItem'],
        isVendor: true,
        vendorInventory: inventory,
        maxCandidates: 8,
      }),
    );
    expect(set.complete).toBe(false);
    expect(set.candidates.length).toBe(8);
    expect(set.omissions.some((entry) => entry.reason === 'bound-exceeded')).toBe(true);
  });

  it('keeps `none` when the bound bites — dropping it would be the worst outcome', () => {
    const inventory = Array.from({ length: 40 }, (_, index) => `item_${index}`);
    const result = ids(
      base({
        allowedCommands: ['giveItem'],
        isVendor: true,
        vendorInventory: inventory,
        maxCandidates: 4,
      }),
    );
    expect(result).toContain(NPC_ACTION_NONE_ID);
  });

  it('is complete for a realistic npc within the default bound', () => {
    const set = enumerateNpcActionCandidates(
      base({
        npcId: 'merchant',
        npcName: 'Mara the Merchant',
        allowedCommands: ['trade', 'offerQuest', 'skillCheck', 'giveItem'],
        isVendor: true,
        vendorInventory: [
          'ironSword',
          'steelSword',
          'healthPotion',
          'manaPotion',
          'ironArmor',
          'woodenShield',
        ],
        offerableQuests: [{ id: 'fading_ward', name: 'The Fading Ward' }],
        discoverableEvidence: [
          { id: 'the_ledger', label: 'Ledger', presentToNpcId: 'merchant' },
          { id: 'sella_receipt', label: 'Receipt', presentToNpcId: 'merchant' },
          { id: 'tess_component', label: 'Component', presentToNpcId: 'merchant' },
        ],
      }),
    );
    // none + trade + 1 quest + 6 items + 3 evidence = 11, inside the default 16.
    expect(set.candidates.length).toBe(11);
    expect(set.complete).toBe(true);
  });
});

describe('npc action candidates — mapping back', () => {
  it('resolves `none` to no command at all', () => {
    const set = enumerateNpcActionCandidates(base());
    expect(commandForActionId(set, NPC_ACTION_NONE_ID)).toBeUndefined();
  });

  it('resolves a literal this turn never offered to nothing, not to a guess', () => {
    const set = enumerateNpcActionCandidates(base());
    expect(commandForActionId(set, 'giveItem:ironSword')).toBeUndefined();
    expect(commandForActionId(set, 'offerQuest:some_other_pack_quest')).toBeUndefined();
  });

  it('describes every option it offers, keyed by literal value', () => {
    const set = enumerateNpcActionCandidates(base());
    const descriptions = optionDescriptionsFor(set);
    for (const candidate of set.candidates) {
      expect(descriptions[candidate.id]).toBeTruthy();
    }
  });
});

describe('vendor inventory parsing', () => {
  /** Reads the inventory back out through its only production caller. */
  const inventoryOf = (raw: string | undefined): readonly string[] =>
    buildNpcActionCandidateInput({ ...base(), npcEntry: { vendorInventory: raw } }).vendorInventory;

  it("reads the pack's comma-joined string into ids", () => {
    // The content pack stores vendorInventory as ONE string, not an array.
    expect(inventoryOf('ironSword,steelSword')).toEqual(['ironSword', 'steelSword']);
    expect(inventoryOf(' ironSword , steelSword ')).toEqual(['ironSword', 'steelSword']);
  });

  it('treats a missing or empty inventory as no items, not as one blank id', () => {
    expect(inventoryOf(undefined)).toEqual([]);
    expect(inventoryOf('')).toEqual([]);
    expect(inventoryOf(' , , ')).toEqual([]);
  });
});
