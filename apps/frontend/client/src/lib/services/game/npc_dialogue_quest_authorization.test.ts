// apps/frontend/client/src/lib/services/game/npc_dialogue_quest_authorization.test.ts
//
// C-568: quest OWNERSHIP is enforced in the dispatch gate, not only in the
// candidate enumeration.
//
// ---------------------------------------------------------------------------
// What was wrong
// ---------------------------------------------------------------------------
//
// `_deriveAllowedCommands` pushes `offerQuest` for EVERY npc, with the comment
// "gated by per-quest precondition in dispatch". The precondition only checked
// that `contentProvider.getQuest(questId)` returned a quest — and
// `game_composition_root` omitted `offeredByNpcId` from that projection, so the
// precondition had no way to check WHO owns the quest.
//
// On the real Emberwatch pack every quest names its offerer, so any npc could be
// driven to offer any other npc's quest, and the dispatch succeeded.
//
// The first lane C fix narrowed the CANDIDATE set so a decision backend could
// not select another NPC's quest. That was necessary and it was not sufficient:
// with the decision path off (the default) or after an abstention, the command
// still comes from the LLM and still went through the unfixed precondition.
// These tests pin the gate itself.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  makeContentProvider,
  makeExecutors,
  makeStreamingTextGenerator,
  resetDialogueServiceFixture,
} from './__tests__/npc_dialogue_fixtures.ts';
import { npcDialogueService } from './npc_dialogue_service.svelte';
import { questStateService } from './quest_state_service.svelte';

/**
 * The real Emberwatch loader.
 *
 * Required, not optional: `getOfferableQuests` returns an EMPTY list when the
 * quest service has no pack loader, so without this every `offerQuest` would be
 * refused — and the negative tests would pass for the wrong reason, proving
 * nothing about ownership.
 */
const QUESTS = [
  {
    id: 'fading_ward',
    name: 'The Fading Ward',
    offerDialogueKey: 'elder_ward',
    offeredByNpcId: 'village_elder',
  },
  {
    id: 'tools_for_tomorrow',
    name: 'Tools for Tomorrow',
    offerDialogueKey: 'orra_tools',
    offeredByNpcId: 'smith_orra',
  },
  {
    id: 'a_room_kept_warm',
    name: 'A Room Kept Warm',
    offerDialogueKey: 'sella_room',
    offeredByNpcId: 'innkeeper_sella',
  },
  {
    id: 'mark_the_safe_trail',
    name: 'Mark the Safe Trail',
    offerDialogueKey: 'ada_trail',
    offeredByNpcId: 'woodcutter_ada',
  },
];

const packLoader = {
  manifest: {} as never,
  packId: 'emberwatch',
  getAllQuests: () => QUESTS,
  getQuest: (id: string) => QUESTS.find((quest) => quest.id === id),
} as unknown as Parameters<typeof questStateService.configure>[0]['contentPackLoader'];

beforeEach(() => {
  resetDialogueServiceFixture();
  questStateService.configure({ contentPackLoader: packLoader });
});
afterEach(() => {
  resetDialogueServiceFixture();
});

/** Call 1 streams a narrative; call 2 returns the given command verbatim. */
const generatorReturning = (command: Record<string, unknown>) =>
  makeStreamingTextGenerator({
    chunks: ['Something was said.'],
    structured: { command },
  });

const generateWith = async (command: Record<string, unknown>) => {
  npcDialogueService.configure({
    contentProvider: makeContentProvider(),
    textGenerator: generatorReturning(command),
    executors: makeExecutors(),
  });
  return npcDialogueService.generateTurn({
    npcId: 'village_elder',
    npcName: 'Elder Thalia',
    messages: [],
    signal: new AbortController().signal,
  });
};

describe('C-568: quest ownership is checked in the precondition, not only the candidates', () => {
  test('refuses a quest another npc owns, on the default decision path', async () => {
    // `tools_for_tomorrow` is authored as smith_orra's quest. The elder may not
    // offer it. The decision path is OFF here — this is the plain LLM path.
    const turn = await generateWith({ kind: 'offerQuest', questId: 'tools_for_tomorrow' });

    expect(turn.command).toBeUndefined();
    // The narrative survives: the command is dropped, the turn is not discarded.
    expect(turn.source).toBe('ai');
    expect(turn.narrative.length).toBeGreaterThan(0);
  });

  test('allows the quest the npc actually owns', async () => {
    // `fading_ward` is the elder's quest in the pack.
    const turn = await generateWith({ kind: 'offerQuest', questId: 'fading_ward' });

    expect(turn.command?.kind).toBe('offerQuest');
  });

  test('refuses at mutation dispatch too, not only before attach', async () => {
    // `executeCommand` re-derives the whitelist and re-validates. That second
    // gate must be the same one, or a command that reached the turn by some
    // other route would slip through at the mutation boundary.
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator: generatorReturning({ kind: 'none' }),
      executors: makeExecutors(),
    });

    const executed = npcDialogueService.executeCommand({
      kind: 'offerQuest',
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      command: { kind: 'offerQuest', questId: 'tools_for_tomorrow' },
    });

    expect(executed).toBe(false);
  });

  test('a quest id that exists in the pack but belongs to someone else is still refused', async () => {
    // The existence check alone is not authorization. This is the precise
    // failure the old precondition could not express.
    const turn = await generateWith({ kind: 'offerQuest', questId: 'a_room_kept_warm' });
    // `a_room_kept_warm` is innkeeper_sella's.
    expect(turn.command).toBeUndefined();
  });

  test('refuses a quest that exists but is not currently offerable', async () => {
    // `mark_the_safe_trail` belongs to woodcutter_ada.
    const turn = await generateWith({ kind: 'offerQuest', questId: 'mark_the_safe_trail' });
    expect(turn.command).toBeUndefined();
  });
});
