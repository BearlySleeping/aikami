// apps/frontend/client/src/lib/views/quest/quest_view_model.dev.svelte.ts
//
// Dev sandbox override — injects mock quest data via WorldStateService.
// NEVER import this file from production code or non-(dev) routes.
// Updated C-339: Added branching, hidden, optional, timed objective mocks

import type { QuestData, QuestJournalEntry } from '@aikami/frontend/engine';
import { BaseViewModel, type BaseViewModelOptions } from '@aikami/frontend/services';
import { questStateService, worldStateService } from '$services';
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
      { label: 'Descend to level 2', current: 0, max: 1, status: 'active' },
      { label: 'Find the glowing source', current: 0, max: 1, status: 'locked' },
      { label: 'Collect Crystal Shards', current: 0, max: 5, status: 'active', optional: true },
    ],
  },
  {
    id: 'q-branching',
    title: 'The Castle Gates',
    description: 'Find a way into the castle.',
    status: 'active',
    objectives: [
      { label: 'Convince the Guard (Path A)', current: 0, max: 1, status: 'active' },
      { label: 'Enter through the Gate (Path A)', current: 0, max: 1, status: 'locked' },
      { label: 'Find the Tunnel (Path B)', current: 0, max: 1, status: 'active' },
      {
        label: 'Climb through Window (Path B)',
        current: 0,
        max: 1,
        status: 'locked',
        hidden: true,
        hiddenRevealed: false,
      },
    ],
  },
  {
    id: 'q-artifact',
    title: 'The Lost Artifact of Valdris',
    description: 'Recover the ancient artifact.',
    status: 'completed',
    objectives: [
      { label: 'Find entrance', current: 1, max: 1, status: 'completed' },
      { label: 'Solve puzzle', current: 1, max: 1, status: 'completed' },
      { label: 'Retrieve artifact', current: 1, max: 1, status: 'completed' },
    ],
  },
  {
    id: 'q-bandits',
    title: 'Bandit Camp Investigation',
    description: 'Scout the bandit camp near the Old Mill.',
    status: 'failed',
    objectives: [
      { label: 'Scout undetected', current: 0, max: 1, status: 'failed' },
      { label: 'Count enemies', current: 0, max: 1, status: 'skipped' },
    ],
  },
];

const MOCK_JOURNAL_ENTRIES: QuestJournalEntry[] = [
  {
    questId: 'q-artifact',
    title: 'The Lost Artifact of Valdris',
    status: 'completed',
    timestamp: Date.now() - 86400000,
    endingId: 'restored',
    endingTitle: 'Artifact Restored',
    narration:
      'You placed the artifact upon the ancient pedestal. A warm light filled the chamber as the long-dormant magic awakened, restoring the protective wards around the valley.',
    objectiveResults: [
      { label: 'Find entrance', status: 'completed' },
      { label: 'Solve puzzle', status: 'completed' },
      { label: 'Retrieve artifact', status: 'completed' },
    ],
    rewards: [
      { type: 'item', label: 'Item: Ancient Amulet' },
      { type: 'gold', label: 'Gold: 500' },
      { type: 'xp', label: 'XP: 1000' },
    ],
    worldStateFlags: ['valdris.artifact.restored'],
  },
  {
    questId: 'q-bandits',
    title: 'Bandit Camp Investigation',
    status: 'failed',
    timestamp: Date.now() - 43200000,
    narration:
      'You were spotted by the bandit scouts before you could gather enough information. The bandits have since moved their camp to an unknown location.',
    objectiveResults: [
      { label: 'Scout undetected', status: 'failed' },
      { label: 'Count enemies', status: 'skipped' },
    ],
    rewards: [],
    worldStateFlags: [],
  },
];

class QuestDevViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements QuestViewModelInterface
{
  private _inner = getQuestViewModel({ className: 'QuestDevInner' });

  async initialize(): Promise<void> {
    this.injectMockQuests();
    this.injectMockJournal();
    await super.initialize();
  }

  get activeTab(): 'quests' | 'journal' {
    return this._inner.activeTab;
  }
  setActiveTab(tab: 'quests' | 'journal'): void {
    this._inner.setActiveTab(tab);
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
  get journalEntries(): readonly QuestJournalEntry[] {
    return this._inner.journalEntries;
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

  injectMockJournal(): void {
    (questStateService.journalEntries as QuestJournalEntry[]).length = 0;
    for (const entry of MOCK_JOURNAL_ENTRIES) {
      (questStateService.journalEntries as QuestJournalEntry[]).push({ ...entry });
    }
  }

  progressObjective(): void {
    for (const quest of worldStateService.quests) {
      if (quest.status !== 'active') {
        continue;
      }
      for (const obj of quest.objectives) {
        if (obj.current < obj.max && obj.status !== 'locked') {
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
