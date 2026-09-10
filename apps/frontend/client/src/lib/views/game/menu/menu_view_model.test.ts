// apps/frontend/client/src/lib/views/game/menu/menu_view_model.test.ts
//
// Unit tests for MenuViewModel — continue availability, navigation callbacks,
// and platform probe. Exercises the ViewModel through feature-owned fixtures —
// no global `$services` barrel mock.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { SaveSlotInfo } from '$types';
import { createMenuViewModel } from './menu_view_model.svelte';
import {
  createMenuCampaign,
  createMenuGameSave,
  createMenuRouter,
} from './testing/menu_fixtures.ts';

const save = (overrides: Partial<SaveSlotInfo> = {}): SaveSlotInfo => ({
  id: 'auto-save',
  timestamp: 1,
  mapName: 'Village',
  ...overrides,
});

const createViewModel = (
  options: {
    gameSave?: ReturnType<typeof createMenuGameSave>;
    campaign?: ReturnType<typeof createMenuCampaign>;
    router?: ReturnType<typeof createMenuRouter>;
    isTauri?: () => boolean;
    quitApp?: () => Promise<void>;
    onStart?: () => void;
    onOptions?: () => void;
    onCredits?: () => void;
  } = {},
) =>
  createMenuViewModel({
    className: 'MenuViewModelTest',
    onStart: options.onStart ?? (() => {}),
    onOptions: options.onOptions ?? (() => {}),
    onCredits: options.onCredits ?? (() => {}),
    gameSave: options.gameSave ?? createMenuGameSave(),
    campaign: options.campaign ?? createMenuCampaign(),
    router: options.router ?? createMenuRouter(),
    isTauri: options.isTauri,
    quitApp: options.quitApp,
  });

describe('MenuViewModel — continue availability', () => {
  test('cannot continue with no saves', () => {
    const viewModel = createViewModel();

    expect(viewModel.canContinue).toBe(false);
    expect(viewModel.latestSave).toBeUndefined();
  });

  test('selects the most recent save', () => {
    const viewModel = createViewModel({
      gameSave: createMenuGameSave({
        availableSaves: [
          save({ id: 'older', timestamp: 100 }),
          save({ id: 'newest', timestamp: 300 }),
          save({ id: 'middle', timestamp: 200 }),
        ],
      }),
    });

    expect(viewModel.canContinue).toBe(true);
    expect(viewModel.latestSave?.id).toBe('newest');
  });

  test('initialize loads available saves', async () => {
    const fetchAvailableSaves = mock(async () => {});
    const viewModel = createViewModel({ gameSave: createMenuGameSave({ fetchAvailableSaves }) });

    await viewModel.initialize();

    expect(fetchAvailableSaves).toHaveBeenCalledTimes(1);
  });
});

describe('MenuViewModel — navigation callbacks', () => {
  test('startGame, goToOptions, and goToCredits invoke their callbacks', () => {
    const onStart = mock(() => {});
    const onOptions = mock(() => {});
    const onCredits = mock(() => {});
    const viewModel = createViewModel({ onStart, onOptions, onCredits });

    viewModel.startGame();
    viewModel.goToOptions();
    viewModel.goToCredits();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onOptions).toHaveBeenCalledTimes(1);
    expect(onCredits).toHaveBeenCalledTimes(1);
  });

  test('continueGame loads the latest campaign and opens the game', async () => {
    const loadCampaign = mock(async () => ({}));
    const openGame = mock(() => {});
    const viewModel = createViewModel({
      gameSave: createMenuGameSave({ availableSaves: [save({ id: 'camp-1' })] }),
      campaign: createMenuCampaign({ loadCampaign }),
      router: createMenuRouter({ openGame }),
    });

    await viewModel.continueGame();

    expect(loadCampaign).toHaveBeenCalledWith({ campaignId: 'camp-1' });
    expect(openGame).toHaveBeenCalledTimes(1);
  });

  test('continueGame is a no-op without a save', async () => {
    const loadCampaign = mock(async () => ({}));
    const openGame = mock(() => {});
    const viewModel = createViewModel({
      campaign: createMenuCampaign({ loadCampaign }),
      router: createMenuRouter({ openGame }),
    });

    await viewModel.continueGame();

    expect(loadCampaign).not.toHaveBeenCalled();
    expect(openGame).not.toHaveBeenCalled();
  });
});

describe('MenuViewModel — platform', () => {
  test('isTauri reflects the injected probe', () => {
    expect(createViewModel({ isTauri: () => true }).isTauri).toBe(true);
    expect(createViewModel({ isTauri: () => false }).isTauri).toBe(false);
  });

  test('quitApp is a no-op outside Tauri', async () => {
    const viewModel = createViewModel({ isTauri: () => false });

    await expect(viewModel.quitApp()).resolves.toBeUndefined();
  });

  test('quitApp delegates to the injected quit capability inside Tauri', async () => {
    const quitApp = mock(async () => {});
    const viewModel = createViewModel({ isTauri: () => true, quitApp });

    await viewModel.quitApp();

    expect(quitApp).toHaveBeenCalledTimes(1);
  });
});

describe('MenuViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
