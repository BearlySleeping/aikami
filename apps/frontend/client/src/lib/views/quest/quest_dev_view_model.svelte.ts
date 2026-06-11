// apps/frontend/client/src/lib/views/quest/quest_dev_view_model.svelte.ts
//
// Dev sandbox override — injects mock quest data without hitting any backend.
// NEVER import this file from production code or non-(dev) routes.

import type { Quest, QuestObjective } from './quest_view_model.svelte.ts';
import {
  QuestViewModel,
  type QuestViewModelInterface,
  type QuestViewModelOptions,
} from './quest_view_model.svelte.ts';

// ── Mock data ──────────────────────────────────────────────────────────

const MOCK_QUESTS: Quest[] = [
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
  constructor(options: QuestViewModelOptions) {
    super(options);
  }

  override async initialize(): Promise<void> {
    this.injectMockQuests();
    return super.initialize();
  }

  // ── Dev-only methods ─────────────────────────────────────────────────

  /**
   * Populates the view model with a mix of active, completed, and failed quests.
   * Safe to call multiple times — clears existing data first.
   */
  injectMockQuests(): void {
    this.debug('injectMockQuests');

    this.activeQuests = [];
    this.completedQuests = [];
    this.failedQuests = [];

    for (const quest of MOCK_QUESTS) {
      // Deep-clone objectives so mutations during dev testing are isolated
      const clone: Quest = {
        ...quest,
        objectives: quest.objectives.map((o): QuestObjective => ({ ...o, current: o.current })),
      };

      if (clone.status === 'active') {
        this.activeQuests.push(clone);
      } else if (clone.status === 'completed') {
        this.completedQuests.push(clone);
      } else {
        this.failedQuests.push(clone);
      }
    }
  }

  /**
   * Finds the first active quest with an incomplete objective and increments it.
   * Caps at the objective's `max` value.
   * Safe to call when there are no active quests — logs a debug message.
   */
  progressObjective(): void {
    for (const quest of this.activeQuests) {
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
   * Safe to call when there are no active quests — logs a debug message.
   */
  failRandomQuest(): void {
    if (this.activeQuests.length === 0) {
      this.debug('failRandomQuest: no active quests to fail');
      return;
    }
    const randomIndex = Math.floor(Math.random() * this.activeQuests.length);
    const quest = this.activeQuests[randomIndex];
    if (!quest) {
      return;
    }
    this.failQuest(quest.id);
    this.debug('failRandomQuest', { questId: quest.id, title: quest.title });
  }
}

export const getQuestDevViewModel = (options: QuestViewModelOptions): QuestDevViewModel =>
  new QuestDevViewModel(options);
