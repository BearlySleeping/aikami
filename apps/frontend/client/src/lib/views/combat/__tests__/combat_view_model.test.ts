// apps/frontend/client/src/lib/views/combat/__tests__/combat_view_model.test.ts
//
// Unit tests for the C-385 AC-3 combat music rehoming: `_transitionBgmByMood`
// resolves tracks from the static audio catalog (never Data Connect) and
// crossfades via AudioService. The audio capability is injected as a feature
// fixture so the test is deterministic.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  type CombatViewModelInterface,
  createCombatViewModel,
} from '../combat_view_model.svelte.ts';
import { createCombatAudio, createCombatTestOptions } from '../testing/combat_fixtures.ts';

/** Exposes the private BGM transition method for focused unit testing. */
const transitionBgmByMood = (vm: CombatViewModelInterface, mood: string): Promise<void> =>
  (vm as unknown as { _transitionBgmByMood: (m: string) => Promise<void> })._transitionBgmByMood(
    mood,
  );

describe('CombatViewModel — C-385 AC-3 static catalog BGM', () => {
  const transitionToBgm = mock(async () => {});
  let viewModel: CombatViewModelInterface;

  beforeEach(() => {
    transitionToBgm.mockClear();
    viewModel = createCombatViewModel(
      createCombatTestOptions({
        audio: createCombatAudio({
          getTracksByMood: mock(async (mood: string) => [
            {
              id: `bgm-combat-${mood}`,
              title: 'Combat BGM',
              mood,
              assetPath: 'music/combat/bgm_combat.webm',
            },
          ]),
          resolveAudioTrackUrl: mock(
            async (entry: { assetPath: string }) => `/game-data/${entry.assetPath}`,
          ),
          transitionToBgm,
        }),
      }),
    );
  });

  test('_transitionBgmByMood resolves a track from the static catalog and crossfades', async () => {
    await transitionBgmByMood(viewModel, 'epic');

    expect(transitionToBgm).toHaveBeenCalledWith('/game-data/music/combat/bgm_combat.webm', 2000);
  });

  test('_transitionBgmByMood invokes transitionToBgm for each mood request', async () => {
    await transitionBgmByMood(viewModel, 'epic');
    await transitionBgmByMood(viewModel, 'epic');

    expect(transitionToBgm).toHaveBeenCalledTimes(2);
  });
});
