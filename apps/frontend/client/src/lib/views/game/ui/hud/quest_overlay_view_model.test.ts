// apps/frontend/client/src/lib/views/game/ui/hud/quest_overlay_view_model.test.ts
//
// Unit tests for QuestOverlayViewModel — the active-quest mini overlay.
//
// Exercises the ViewModel through feature-owned fixtures — no global
// `$services` barrel mock and no shared test inventory.

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

  test('presents ending options only at the resolution point', () => {
    const chooseEnding = mock(() => true);
    const eligible = () => [
      { id: 'renewed', title: 'Ward Renewed', unlocked: true },
      { id: 'darkened', title: 'Ward Darkened', unlocked: false },
    ];

    // Still being played: the conclusions are not an actionable control.
    const midQuest = createViewModel({
      questState: createQuestStateCapabilities([ACTIVE_QUEST], {
        getEligibleEndings: eligible,
        chooseEnding,
      }),
    });
    expect(midQuest.awaitingEndingChoice).toBe(false);
    expect(midQuest.hasEndingOptions).toBe(false);
    midQuest.selectEnding('renewed');
    expect(chooseEnding).not.toHaveBeenCalled();

    // Resolution-ready: the unlocked choice is offered, locked ones disabled.
    const viewModel = createViewModel({
      questState: createQuestStateCapabilities([{ ...ACTIVE_QUEST, awaitingEndingChoice: true }], {
        getEligibleEndings: eligible,
        chooseEnding,
      }),
    });
    expect(viewModel.hasEndingOptions).toBe(true);
    expect(viewModel.endingOptions.map((ending) => ending.statusLabel)).toEqual([
      'Choose',
      'Locked',
    ]);

    viewModel.selectEnding('renewed');
    expect(chooseEnding).toHaveBeenCalledWith({ questId: 'fading_ward', endingId: 'renewed' });
  });

  test('a resolution-ready quest is presented even when the HUD was hidden', () => {
    const viewModel = createViewModel({
      overlay: createQuestOverlayVisibility({ visible: false }),
      questState: createQuestStateCapabilities([{ ...ACTIVE_QUEST, awaitingEndingChoice: true }], {
        getEligibleEndings: () => [{ id: 'renewed', title: 'Ward Renewed', unlocked: true }],
      }),
    });

    // The final choice is a blocking decision, so a hidden HUD cannot strand it.
    expect(viewModel.visible).toBe(true);
  });

  test('hide() is ignored while a final choice is pending', () => {
    const setVisible = mock(() => {});
    const viewModel = createViewModel({
      overlay: createQuestOverlayVisibility({ setVisible }),
      questState: createQuestStateCapabilities([{ ...ACTIVE_QUEST, awaitingEndingChoice: true }]),
    });

    viewModel.hide();

    expect(setVisible).not.toHaveBeenCalled();
  });

  test('a resolution-ready quest takes precedence over accept order', () => {
    const sideQuest: QuestData = { ...ACTIVE_QUEST, id: 'side_quest', title: 'A Side Quest' };
    const viewModel = createViewModel({
      questState: createQuestStateCapabilities(
        [sideQuest, { ...ACTIVE_QUEST, awaitingEndingChoice: true }],
        { getEligibleEndings: () => [{ id: 'renewed', title: 'Ward Renewed', unlocked: true }] },
      ),
    });

    // The quest awaiting its decision is the one the overlay must present.
    expect(viewModel.activeQuest?.id).toBe('fading_ward');
    expect(viewModel.hasEndingOptions).toBe(true);
  });

  test('reflects a persisted ending selection from quest progress', () => {
    const viewModel = createViewModel({
      questState: createQuestStateCapabilities(
        [{ ...ACTIVE_QUEST, awaitingEndingChoice: true, chosenEndingId: 'reconciled' }],
        {
          getEligibleEndings: () => [
            { id: 'renewed', title: 'Ward Renewed', unlocked: true },
            { id: 'reconciled', title: 'Ward Reconciled', unlocked: true },
          ],
        },
      ),
    });

    expect(viewModel.endingOptions.find((ending) => ending.selected)?.id).toBe('reconciled');
    expect(viewModel.endingOptions.find((ending) => ending.selected)?.statusLabel).toBe('Selected');
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
