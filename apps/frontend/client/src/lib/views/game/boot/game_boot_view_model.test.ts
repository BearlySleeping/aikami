// apps/frontend/client/src/lib/views/game/boot/game_boot_view_model.test.ts
//
// Unit tests for GameBootViewModel — stage derivation, failure message, and
// retry/return actions. Exercises the ViewModel through feature-owned fixtures
// — no global `$services` barrel mock.
//
// Contract: C-326 Make Game Boot Atomic, Observable, and Content-Driven

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { createGameBootViewModel } from './game_boot_view_model.svelte';
import {
  createGameBoot,
  createGameBootRouter,
  createGameBootWithProgress,
} from './testing/game_boot_fixtures.ts';

const createViewModel = (boot = createGameBoot(), router = createGameBootRouter()) =>
  createGameBootViewModel({ className: 'GameBootViewModelTest', boot, router });

describe('GameBootViewModel — progress derivation', () => {
  test('prefers the detail string as the stage label', () => {
    const viewModel = createViewModel(
      createGameBootWithProgress({
        stage: 'loading-content',
        stageIndex: 1,
        stageCount: 4,
        detail: 'Loading content packs…',
      }),
    );

    expect(viewModel.stageLabel).toBe('Loading content packs…');
    expect(viewModel.stageIndex).toBe(1);
    expect(viewModel.stageCount).toBe(4);
    expect(viewModel.detail).toBe('Loading content packs…');
  });

  test('falls back to the stage name when no detail is present', () => {
    const viewModel = createViewModel(
      createGameBootWithProgress({ stage: 'starting', stageIndex: 0, stageCount: 4 }),
    );

    expect(viewModel.stageLabel).toBe('starting');
    expect(viewModel.detail).toBeUndefined();
  });

  test('reports failure and the error message', () => {
    const viewModel = createViewModel(
      createGameBootWithProgress({
        stage: 'failed',
        stageIndex: 2,
        stageCount: 4,
        error: 'Content pack missing',
      }),
    );

    expect(viewModel.isFailed).toBe(true);
    expect(viewModel.bootErrorMessage).toBe('Content pack missing');
  });

  test('uses a default error message when none is provided', () => {
    const viewModel = createViewModel(
      createGameBootWithProgress({ stage: 'failed', stageIndex: 2, stageCount: 4 }),
    );

    expect(viewModel.bootErrorMessage).toBe('An unknown error occurred during boot.');
  });

  test('reports readiness from the boot stage', () => {
    const viewModel = createViewModel(
      createGameBootWithProgress({ stage: 'ready', stageIndex: 4, stageCount: 4 }),
    );

    expect(viewModel.isReady).toBe(true);
    expect(viewModel.isFailed).toBe(false);
  });
});

describe('GameBootViewModel — actions', () => {
  test('retryBoot resets the boot pipeline', () => {
    const resetForRetry = mock(() => {});
    const viewModel = createViewModel(createGameBoot({ resetForRetry }));

    viewModel.retryBoot();

    expect(resetForRetry).toHaveBeenCalledTimes(1);
  });

  test('returnToMenu tears down and navigates home', () => {
    const teardown = mock(() => {});
    const goToHref = mock(async () => {});
    const viewModel = createViewModel(
      createGameBoot({ teardown }),
      createGameBootRouter({ goToHref }),
    );

    viewModel.returnToMenu();

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(goToHref).toHaveBeenCalledWith('/');
  });
});

describe('GameBootViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
