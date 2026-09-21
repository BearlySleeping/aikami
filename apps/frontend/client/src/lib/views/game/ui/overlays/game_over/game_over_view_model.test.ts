// apps/frontend/client/src/lib/views/game/ui/overlays/game_over/game_over_view_model.test.ts
//
// Unit tests for GameOverViewModel — retry availability and delegation to the
// injected combat/overlay capabilities. Exercises the ViewModel through
// feature-owned fixtures — no global `$services` barrel mock.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { GameOverlayType } from '$types';
import {
  createGameOverViewModel,
  type GameOverCombatCapabilities,
  type GameOverOverlayCapabilities,
} from './game_over_view_model.svelte';
import {
  createGameOverCombat,
  createGameOverOverlay,
  GAME_OVER_ENCOUNTER,
} from './testing/game_over_fixtures.ts';

const createViewModel = (
  combat: GameOverCombatCapabilities = createGameOverCombat(),
  overlay: GameOverOverlayCapabilities = createGameOverOverlay(),
) => createGameOverViewModel({ className: 'GameOverViewModelTest', combat, overlay });

describe('GameOverViewModel — retry availability', () => {
  test('cannot retry when there is no last encounter', () => {
    expect(createViewModel().canRetry).toBe(false);
  });

  test('can retry once a last encounter exists', () => {
    const viewModel = createViewModel(
      createGameOverCombat({ lastCombatOptions: GAME_OVER_ENCOUNTER }),
    );

    expect(viewModel.canRetry).toBe(true);
  });
});

describe('GameOverViewModel — delegation', () => {
  test('respawnPlayer delegates to the overlay capability', async () => {
    const respawnPlayer = mock(async () => {});
    const viewModel = createViewModel(
      createGameOverCombat(),
      createGameOverOverlay({ respawnPlayer }),
    );

    await viewModel.respawnPlayer();

    expect(respawnPlayer).toHaveBeenCalledTimes(1);
  });

  test('loadLastSave delegates to the overlay capability', async () => {
    const loadLastSave = mock(async () => {});
    const viewModel = createViewModel(
      createGameOverCombat(),
      createGameOverOverlay({ loadLastSave }),
    );

    await viewModel.loadLastSave();

    expect(loadLastSave).toHaveBeenCalledTimes(1);
  });

  test('retryEncounter forwards the combat-chosen overlay to the overlay capability', () => {
    const retryEncounter = mock(
      ({ setActive: activate }: { setActive: (overlay: GameOverlayType) => void }) =>
        activate('COMBAT'),
    );
    const setActive = mock((_overlay: GameOverlayType) => {});
    const viewModel = createViewModel(
      createGameOverCombat({ lastCombatOptions: GAME_OVER_ENCOUNTER, retryEncounter }),
      createGameOverOverlay({ setActive }),
    );

    viewModel.retryEncounter();

    expect(retryEncounter).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenCalledWith('COMBAT');
  });
});

describe('GameOverViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
