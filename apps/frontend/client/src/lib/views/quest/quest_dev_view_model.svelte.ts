// apps/frontend/client/src/lib/views/quest/quest_dev_view_model.svelte.ts
//
// Dev sandbox override — injects mock quest data via GameStateService.
// NEVER import this file from production code or non-(dev) routes.
//
// Contract: C-143 Quest Log Sync

import type { QuestData } from '@aikami/frontend/engine';
import { gameStateService } from '$services';
import {
  QuestViewModel,
  type QuestViewModelInterface,
  type QuestViewModelOptions,
} from './quest_view_model.svelte.ts';

// ── Mock data ──────────────────────────────────────────────────────────

const MOCK_QUESTS: QuestData[] = [
  {
    id: 'q-slimes',
    title: 'Slime Extermination',
    description: 'Clear the eastern road of slimes to ensure safe passage for merchant caravans.',
    status: 'active',
    objectives: [
      { label: 'Defeat Blue Slimes', current: 2, max: 5 },
      { label: 'Defeat Red Slimes', current: 1, max: 3 },
      { label: 'Report to Guard Captain', current: 0, max: 1 },
    ],
  },
  {
    id: 'q-herbs',
    title: 'Gather Moonpetal Herbs',
    description: 'Collect rare Moonpetal herbs from the Silverwood Grove for the apothecary.',
    status: 'active',
    objectives: [
      { label: 'Find Moonpetal Herbs', current: 4, max: 6 },
      { label: 'Deliver herbs to Apothecary Mira', current: 0, max: 1 },
    ],
  },
  {
    id: 'q-cave',
    title: 'Explore the Crystal Caverns',
    description:
      'Map the depths of the Crystal Caverns and discover the source of the strange glow.',
    status: 'active',
    objectives: [
      { label: 'Descend to level 2', current: 0, max: 1 },
      { label: 'Find the glowing source', current: 0, max: 1 },
      { label: 'Collect Crystal Shards (0/5)', current: 0, max: 5 },
    ],
  },
  {
    id: 'q-artifact',
    title: 'The Lost Artifact of Valdris',
    description: 'Recover the ancient artifact from the ruins beneath the Howling Mountains.',
    status: 'completed',
    objectives: [
      { label: 'Find the entrance to the ruins', current: 1, max: 1 },
      { label: 'Solve the Guardian puzzle', current: 1, max: 1 },
      { label: 'Retrieve the Artifact', current: 1, max: 1 },
      { label: 'Return to Sage Theron', current: 1, max: 1 },
    ],
  },
  {
    id: 'q-bandits',
    title: 'Bandit Camp Investigation',
    description: 'Scout the bandit camp near the Old Mill and report their numbers and armaments.',
    status: 'failed',
    objectives: [
      { label: 'Scout without being detected', current: 0, max: 1 },
      { label: 'Count enemy numbers', current: 0, max: 1 },
      { label: 'Report to Commander Voss', current: 0, max: 1 },
    ],
  },
  {
    id: 'q-festival',
    title: 'Prepare for the Harvest Festival',
    description: 'Help the villagers of Oakvale prepare for the annual Harvest Festival.',
    status: 'completed',
    objectives: [
      { label: 'Collect festival decorations', current: 10, max: 10 },
      { label: 'Deliver festival feast ingredients', current: 8, max: 8 },
      { label: 'Set up the main stage', current: 1, max: 1 },
    ],
  },
];

// ── Implementation ─────────────────────────────────────────────────────

export class QuestDevViewModel extends QuestViewModel implements QuestViewModelInterface {
  override async initialize(): Promise<void> {
    this.injectMockQuests();
    return super.initialize();
  }

  // ── Dev-only methods ─────────────────────────────────────────────────

  /**
   * Populates the GameStateService quests with mock data.
   * Safe to call multiple times — overwrites existing data.
   */
  injectMockQuests(): void {
    this.debug('injectMockQuests');

    // Deep-clone objectives so mutations during dev testing are isolated
    const clones: QuestData[] = MOCK_QUESTS.map((q) => ({
      ...q,
      objectives: q.objectives.map((o) => ({ ...o })),
    }));

    // quests is $state so mutations trigger reactivity. The interface
    // marks it readonly, but at runtime it's a mutable $state array.
    (gameStateService.quests as QuestData[]).length = 0;
    for (const clone of clones) {
      (gameStateService.quests as QuestData[]).push(clone);
    }
  }

  /**
   * Finds the first active quest with an incomplete objective and increments it.
   * Caps at the objective's `max` value.
   */
  progressObjective(): void {
    for (const quest of gameStateService.quests) {
      if (quest.status !== 'active') {
        continue;
      }
      for (const objective of quest.objectives) {
        if (objective.current < objective.max) {
          objective.current++;
          this.debug('progressObjective', {
            questId: quest.id,
            objective: objective.label,
            progress: `${objective.current}/${objective.max}`,
          });
          return;
        }
      }
    }
    this.debug('progressObjective: all objectives complete, nothing to progress');
  }

  /**
   * Moves a random active quest to the failed state.
   */
  failRandomQuest(): void {
    const activeQuests = gameStateService.quests.filter((q) => q.status === 'active');
    if (activeQuests.length === 0) {
      this.debug('failRandomQuest: no active quests to fail');
      return;
    }
    const randomIndex = Math.floor(Math.random() * activeQuests.length);
    const quest = activeQuests[randomIndex];
    if (!quest) {
      return;
    }
    quest.status = 'failed';
    this.debug('failRandomQuest', { questId: quest.id, title: quest.title });
  }
}

export const getQuestDevViewModel = (options: QuestViewModelOptions): QuestDevViewModel =>
  new QuestDevViewModel(options);
