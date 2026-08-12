// apps/frontend/client/src/lib/views/combat/__tests__/combat_view_model.test.ts
//
// Unit tests for the C-385 AC-3 combat music rehoming: `_transitionBgmByMood`
// resolves tracks from the static audio catalog (never Data Connect) and
// crossfades via AudioService. The catalog module is mocked so the test is
// deterministic — resolver behavior itself is covered in
// `audio_track_catalog.test.ts`.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/combat/__tests__/combat_view_model.test.ts

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the static catalog resolver so BGM resolution is deterministic.
mock.module('$lib/services/audio/audio_track_catalog', () => ({
  getTracksByMood: mock(async () => [
    {
      id: 'bgm-combat-epic',
      title: 'Combat BGM',
      mood: 'epic',
      assetPath: 'music/combat/bgm_combat.webm',
    },
  ]),
  resolveAudioTrackUrl: mock((entry: { assetPath: string }) => `/game-data/${entry.assetPath}`),
}));

const transitionToBgmMock = mock(async () => {});

mock.module('$services', () => ({
  audioService: { transitionToBgm: transitionToBgmMock },
  diceService: {},
  gameStateService: {},
  imageGenerationService: {},
  inventoryService: {},
  textGenerationService: {},
  ttsService: {},
  worldGenSeedingService: {},
  worldStateService: {},
}));

import {
  CombatViewModel,
  type CombatViewModelInterface,
  type CombatViewModelOptions,
} from '../combat_view_model.svelte.ts';

// ── Helpers ───────────────────────────────────────────────────────────────

/** Creates a fresh CombatViewModel instance with test options. */
const createViewModel = (): CombatViewModelInterface => {
  const options: CombatViewModelOptions = {
    className: 'CombatViewModelTest',
  };
  return CombatViewModel.create(options);
};

/** Exposes the private BGM transition method for focused unit testing. */
const transitionBgmByMood = (vm: CombatViewModelInterface, mood: string): Promise<void> => {
  return (
    vm as unknown as { _transitionBgmByMood: (m: string) => Promise<void> }
  )._transitionBgmByMood(mood);
};

describe('CombatViewModel — C-385 AC-3 static catalog BGM', () => {
  let viewModel: CombatViewModelInterface;

  beforeEach(() => {
    viewModel = createViewModel();
    transitionToBgmMock.mockClear();
  });

  afterEach(() => {
    transitionToBgmMock.mockClear();
  });

  test('_transitionBgmByMood resolves a track from the static catalog and crossfades', async () => {
    await transitionBgmByMood(viewModel, 'epic');

    expect(transitionToBgmMock).toHaveBeenCalledWith(
      '/game-data/music/combat/bgm_combat.webm',
      2000,
    );
  });

  test('_transitionBgmByMood invokes transitionToBgm for each mood request', async () => {
    await transitionBgmByMood(viewModel, 'epic');
    await transitionBgmByMood(viewModel, 'epic');

    expect(transitionToBgmMock).toHaveBeenCalledTimes(2);
  });
});
