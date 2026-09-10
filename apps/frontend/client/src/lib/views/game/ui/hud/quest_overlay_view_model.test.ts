// apps/frontend/client/src/lib/views/game/ui/hud/quest_overlay_view_model.test.ts
//
// Unit tests for QuestOverlayViewModel — the active-quest mini overlay.
//
// Exercises the ViewModel through feature-owned fixtures — no global
// `$services` barrel mock and no `test_preload` inventory coupling.

import { describe, expect, mock, test } from 'bun:test';
import type { QuestData } from '@aikami/frontend/engine/sim';
import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  createQuestOverlayViewModel,
  type QuestOverlayViewModelOptions,
} from './quest_overlay_view_model.svelte';
import {
  createQuestCampaignCapabilities,
  createQuestOverlayVisibility,
  createQuestStateCapabilities,
} from './testing/quest_overlay_fixtures.ts';

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

const createViewModel = (
  options: Partial<Pick<QuestOverlayViewModelOptions, 'overlay' | 'questState' | 'campaign'>> = {},
) =>
  createQuestOverlayViewModel({
    className: 'QuestOverlayVMTest',
    overlay: options.overlay ?? createQuestOverlayVisibility(),
    questState: options.questState ?? createQuestStateCapabilities(),
    campaign: options.campaign ?? createQuestCampaignCapabilities(),
  });

describe('QuestOverlayViewModel', () => {
  test('reports no active quest when none are running', () => {
    const viewModel = createViewModel();

    expect(viewModel.hasActiveQuest).toBe(false);
    expect(viewModel.questTitle).toBe('No active quest');
    expect(viewModel.currentObjectiveIndex).toBe(-1);
    expect(viewModel.currentObjectivePercent).toBe(0);
  });

  test('ignores completed quests', () => {
    const viewModel = createViewModel({
      questState: createQuestStateCapabilities([{ ...ACTIVE_QUEST, status: 'completed' }]),
    });

    expect(viewModel.hasActiveQuest).toBe(false);
  });

  test('exposes the first active quest and its objectives', () => {
    const viewModel = createViewModel({
      questState: createQuestStateCapabilities([ACTIVE_QUEST]),
    });

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
    const viewModel = createViewModel({
      questState: createQuestStateCapabilities([counterQuest]),
    });

    expect(viewModel.currentObjectiveIndex).toBe(0);
    expect(viewModel.currentObjectivePercent).toBe(60);
  });

  test('hide() delegates to the overlay capability', () => {
    const setVisible = mock(() => {});
    const viewModel = createViewModel({
      overlay: createQuestOverlayVisibility({ setVisible }),
    });

    viewModel.hide();

    expect(setVisible).toHaveBeenCalledWith(false);
  });

  test('visibility comes from the overlay capability', () => {
    const viewModel = createViewModel({
      overlay: createQuestOverlayVisibility({ visible: false }),
    });

    expect(viewModel.visible).toBe(false);
  });

  test('sampledTruthId comes from the active campaign', () => {
    const viewModel = createViewModel({
      campaign: createQuestCampaignCapabilities({
        activeCampaign: { sampledTruthId: 'truth-42' },
      }),
    });

    expect(viewModel.sampledTruthId).toBe('truth-42');
  });

  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
