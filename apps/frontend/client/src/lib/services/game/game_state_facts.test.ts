// apps/frontend/client/src/lib/services/game/game_state_facts.test.ts
//
// Unit tests for buildGameStateFacts — the quest + difficulty guidance
// facts injected into every GM/NPC dialogue prompt.
//
// Verifies: active-quest facts surface the next objective, easy mode adds
// an explicit item hint, medium/hard do not, and the difficulty guidance
// line reflects the selected mode.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { QuestData } from '@aikami/frontend/engine';
import { buildGameStateFacts } from './game_state_facts';
import { questStateService } from './quest_state_service.svelte';

const STORAGE_KEY = 'aikami_gameplay_settings';

const ACTIVE_QUEST: QuestData = {
  id: 'fading_ward',
  title: 'The Fading Ward',
  description: 'Elder Thalia needs the Ward Wand to renew the ward protecting Emberwatch.',
  status: 'active',
  objectives: [
    { label: 'Ask Elder Thalia about the failing ward', current: 1, max: 1 },
    { label: "Find the Ward Wand's keeper at the inn", current: 0, max: 1 },
    { label: 'Obtain the Ward Wand from its keeper', current: 0, max: 1 },
    { label: 'Return the Ward Wand to Elder Thalia', current: 0, max: 1 },
  ],
};

const setDifficulty = (difficulty: string): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ difficulty }));
};

describe('buildGameStateFacts — quest guidance', () => {
  beforeEach(() => {
    localStorage.clear();
    (questStateService.quests as QuestData[]).length = 0;
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('includes the active quest and its next objective', () => {
    (questStateService.quests as QuestData[]).push(ACTIVE_QUEST);
    const facts = buildGameStateFacts({ npcId: 'village_elder' });

    const questFact = facts.find((f) => f.includes('Active quest'));
    expect(questFact).toContain('The Fading Ward');
    // First objective is complete → next objective is the inn step.
    expect(questFact).toContain("Find the Ward Wand's keeper at the inn");
  });

  test('easy difficulty adds an explicit item hint naming the Ward Wand', () => {
    setDifficulty('easy');
    (questStateService.quests as QuestData[]).push(ACTIVE_QUEST);
    const facts = buildGameStateFacts({ npcId: 'village_elder' });

    const hint = facts.find((f) => f.includes('Hint (easy mode only)'));
    expect(hint).toBeDefined();
    // Extraction must yield exactly the consecutive capitalized phrase, not
    // the full objective sentence.
    expect(hint).toBe('Hint (easy mode only): the player needs "Ward Wand".');
  });

  test('medium and hard difficulties do not add explicit item hints', () => {
    (questStateService.quests as QuestData[]).push(ACTIVE_QUEST);

    setDifficulty('medium');
    expect(
      buildGameStateFacts({ npcId: 'rollo_grasper' }).some((f) =>
        f.includes('Hint (easy mode only)'),
      ),
    ).toBe(false);

    setDifficulty('hard');
    expect(
      buildGameStateFacts({ npcId: 'rollo_grasper' }).some((f) =>
        f.includes('Hint (easy mode only)'),
      ),
    ).toBe(false);
  });

  test('difficulty guidance line reflects the selected mode', () => {
    setDifficulty('hard');
    const facts = buildGameStateFacts({ npcId: 'village_elder' });

    const guidance = facts.find((f) => f.includes('Game difficulty'));
    expect(guidance).toContain('hard');
    expect(guidance).toContain('realistic');
    expect(guidance).not.toContain('easy');
  });

  test('emits no quest facts when no quest is active', () => {
    const facts = buildGameStateFacts({ npcId: 'village_elder' });
    expect(facts.some((f) => f.includes('Active quest'))).toBe(false);
  });

  test('default difficulty guidance (no stored setting) is medium', () => {
    const facts = buildGameStateFacts({ npcId: 'village_elder' });
    const guidance = facts.find((f) => f.includes('Game difficulty'));
    expect(guidance).toContain('medium');
  });

  test('quest facts are capped at MAX_QUEST_FACTS when many quests are active', () => {
    (questStateService.quests as QuestData[]).push(
      { ...ACTIVE_QUEST, id: 'quest_a', title: 'Quest A' },
      { ...ACTIVE_QUEST, id: 'quest_b', title: 'Quest B' },
      { ...ACTIVE_QUEST, id: 'quest_c', title: 'Quest C' },
    );
    const facts = buildGameStateFacts({ npcId: 'village_elder' });

    const questFacts = facts.filter((f) => f.includes('Active quest'));
    expect(questFacts.length).toBe(2);
    expect(questFacts.some((f) => f.includes('Quest C'))).toBe(false);
  });

  test('uses the "Complete the quest" fallback when every objective is complete', () => {
    (questStateService.quests as QuestData[]).push({
      ...ACTIVE_QUEST,
      id: 'all_done',
      title: 'All Done',
      objectives: ACTIVE_QUEST.objectives.map((o) => ({ ...o, current: o.max })),
    });
    const facts = buildGameStateFacts({ npcId: 'village_elder' });

    const questFact = facts.find((f) => f.includes('Active quest'));
    expect(questFact).toBeDefined();
    expect(questFact).toContain('Complete the quest');
  });
});
