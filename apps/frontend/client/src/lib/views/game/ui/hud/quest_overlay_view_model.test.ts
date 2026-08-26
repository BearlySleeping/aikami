// apps/frontend/client/src/lib/views/game/ui/hud/quest_overlay_view_model.test.ts
//
// Unit tests for QuestOverlayViewModel — the active-quest mini overlay.
// Uses the $services mock from test_preload: questStateService.quests is a
// mutable array the tests drive directly.

import { beforeEach, describe, expect, test } from 'bun:test';
import type { QuestData } from '@aikami/frontend/engine/sim';
import { questOverlayService, questStateService } from '$services';
import {
  getQuestOverlayViewModel,
  type QuestOverlayViewModelInterface,
} from './quest_overlay_view_model.svelte';

const ACTIVE_QUEST: QuestData = {
  id: 'fading_ward',
  title: 'The Fading Ward',
  description: 'Elder Thalia needs the Ward Wand to renew the ward protecting Emberwatch.',
  status: 'active',
  objectives: [
    { label: 'Ask Elder Thalia about the failing ward', current: 1, max: 1 },
    { label: 'Find the Ward Wand keeper at the inn', current: 0, max: 1 },
    { label: 'Obtain the Ward Wand from its keeper', current: 0, max: 1 },
    { label: 'Return the Ward Wand to Elder Thalia', current: 0, max: 1 },
  ],
};

describe('QuestOverlayViewModel', () => {
  let viewModel: QuestOverlayViewModelInterface;

  beforeEach(() => {
    (questStateService.quests as QuestData[]).length = 0;
    questOverlayService.setVisible(true);
    viewModel = getQuestOverlayViewModel({ className: 'QuestOverlayVMTest' });
  });

  test('reports no active quest when none are running', () => {
    expect(viewModel.hasActiveQuest).toBe(false);
    expect(viewModel.questTitle).toBe('No active quest');
    expect(viewModel.currentObjectiveIndex).toBe(-1);
    expect(viewModel.currentObjectivePercent).toBe(0);
  });

  test('ignores completed quests', () => {
    (questStateService.quests as QuestData[]).push({
      ...ACTIVE_QUEST,
      status: 'completed',
    });
    expect(viewModel.hasActiveQuest).toBe(false);
  });

  test('exposes the first active quest and its objectives', () => {
    (questStateService.quests as QuestData[]).push(ACTIVE_QUEST);
    expect(viewModel.hasActiveQuest).toBe(true);
    expect(viewModel.questTitle).toBe('The Fading Ward');
    expect(viewModel.questDescription).toContain('Ward Wand');
    expect(viewModel.objectives.length).toBe(4);
    // First objective already complete → current objective is index 1.
    expect(viewModel.currentObjectiveIndex).toBe(1);
    expect(viewModel.currentObjectivePercent).toBe(0);
  });

  test('current objective percent reflects counter progress', () => {
    const counterQuest: QuestData = {
      ...ACTIVE_QUEST,
      objectives: [
        { label: 'Defeat slimes', current: 3, max: 5 },
        { label: 'Report back', current: 0, max: 1 },
      ],
    };
    (questStateService.quests as QuestData[]).push(counterQuest);
    expect(viewModel.currentObjectiveIndex).toBe(0);
    expect(viewModel.currentObjectivePercent).toBe(60);
  });

  test('hide() delegates to the overlay service', () => {
    (questStateService.quests as QuestData[]).push(ACTIVE_QUEST);
    expect(viewModel.visible).toBe(true);
    viewModel.hide();
    expect(viewModel.visible).toBe(false);
  });

  test('visibility comes from the overlay service', () => {
    expect(viewModel.visible).toBe(true);
  });
});
