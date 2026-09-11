// apps/frontend/client/src/browser_tests/game_over.browser.test.ts
//
// Real-runes coverage for the migrated game-over ViewModel. The Bun suite uses
// plain fixtures; this lane runs the ViewModel in Chromium with the real Svelte
// compiler against a reactive combat fixture.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createGameOverViewModel } from '../lib/views/game/ui/overlays/game_over/game_over_view_model.svelte';
import { GAME_OVER_ENCOUNTER } from '../lib/views/game/ui/overlays/game_over/testing/game_over_fixtures.ts';
import { createReactiveGameOverHarness } from '../lib/views/game/ui/overlays/game_over/testing/game_over_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('GameOverViewModel — reactive retry availability (real runes)', () => {
  test('canRetry follows the reactive last combat options', () => {
    const harness = createReactiveGameOverHarness();
    const viewModel = createGameOverViewModel({
      className: 'GameOverViewModel',
      combat: harness.combat,
      overlay: harness.overlay,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.canRetry).toBe(false);

    harness.setLastCombatOptions(GAME_OVER_ENCOUNTER);
    flushSync();

    expect(viewModel.canRetry).toBe(true);

    harness.setLastCombatOptions(null);
    flushSync();

    expect(viewModel.canRetry).toBe(false);
  });

  test('retryEncounter activates the combat overlay', () => {
    const harness = createReactiveGameOverHarness();
    const viewModel = createGameOverViewModel({
      className: 'GameOverViewModel',
      combat: harness.combat,
      overlay: harness.overlay,
    });
    disposables.push(() => viewModel.dispose());

    viewModel.retryEncounter();

    expect(harness.activations).toEqual(['COMBAT']);
  });
});
