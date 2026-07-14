// apps/frontend/client/src/lib/views/quest/quest_view_model.dev.svelte.ts
//
// Dev sandbox override — injects mock quest data via GameStateService.
// NEVER import this file from production code or non-(dev) routes.

import type { QuestData } from '@aikami/frontend/engine';
import { BaseViewModel, type BaseViewModelOptions } from '@aikami/frontend/services';
import { worldStateService } from '$services';
import {
  getQuestViewModel,
  type QuestViewModelInterface,
  type QuestViewModelOptions,
} from './quest_view_model.svelte.ts';

const MOCK_QUESTS: QuestData[] = [
  {
    id: 'q-slimes',
    title: 'Slime Extermination',
    description: 'Clear the eastern road of slimes.',
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
    description: 'Collect rare Moonpetal herbs from the Silverwood Grove.',
    status: 'active',
    objectives: [
      { label: 'Find Moonpetal Herbs', current: 4, max: 6 },
      { label: 'Deliver herbs to Apothecary Mira', current: 0, max: 1 },
    ],
  },
  {
    id: 'q-cave',
    title: 'Explore the Crystal Caverns',
    description: 'Map the depths of the Crystal Caverns.',
    status: 'active',
    objectives: [
      { label: 'Descend to level 2', current: 0, max: 1 },
      { label: 'Find the glowing source', current: 0, max: 1 },
      { label: 'Collect Crystal Shards', current: 0, max: 5 },
    ],
  },
  {
    id: 'q-artifact',
    title: 'The Lost Artifact of Valdris',
    description: 'Recover the ancient artifact.',
    status: 'completed',
    objectives: [
      { label: 'Find entrance', current: 1, max: 1 },
      { label: 'Solve puzzle', current: 1, max: 1 },
      { label: 'Retrieve artifact', current: 1, max: 1 },
    ],
  },
  {
    id: 'q-bandits',
    title: 'Bandit Camp Investigation',
    description: 'Scout the bandit camp near the Old Mill.',
    status: 'failed',
    objectives: [
      { label: 'Scout undetected', current: 0, max: 1 },
      { label: 'Count enemies', current: 0, max: 1 },
    ],
  },
];

class QuestDevViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements QuestViewModelInterface
{
  private _inner = getQuestViewModel({ className: 'QuestDevInner' });

  async initialize(): Promise<void> {
    this.injectMockQuests();
    await super.initialize();
  }

  get activeQuests(): readonly QuestData[] {
    return this._inner.activeQuests;
  }
  get completedQuests(): readonly QuestData[] {
    return this._inner.completedQuests;
  }
  get failedQuests(): readonly QuestData[] {
    return this._inner.failedQuests;
  }
  get questCount(): number {
    return this._inner.questCount;
  }

  injectMockQuests(): void {
    const clones = MOCK_QUESTS.map((q) => ({
      ...q,
      objectives: q.objectives.map((o) => ({ ...o })),
    }));
    (worldStateService.quests as QuestData[]).length = 0;
    for (const clone of clones) {
      (worldStateService.quests as QuestData[]).push(clone);
    }
  }

  progressObjective(): void {
    for (const quest of worldStateService.quests) {
      if (quest.status !== 'active') {
        continue;
      }
      for (const obj of quest.objectives) {
        if (obj.current < obj.max) {
          obj.current++;
          return;
        }
      }
    }
  }

  failRandomQuest(): void {
    const active = worldStateService.quests.filter((q) => q.status === 'active');
    if (active.length === 0) {
      return;
    }
    const quest = active[Math.floor(Math.random() * active.length)];
    if (quest) {
      quest.status = 'failed';
    }
  }
}

export const getQuestDevViewModel = (options: QuestViewModelOptions): QuestViewModelInterface =>
  QuestDevViewModel.create(options) as unknown as QuestViewModelInterface;
