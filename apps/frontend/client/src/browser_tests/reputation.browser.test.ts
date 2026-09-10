// apps/frontend/client/src/browser_tests/reputation.browser.test.ts
//
// Real-runes coverage for the migrated reputation ViewModel. The Bun suite uses
// plain fixtures; this lane runs the ViewModel in Chromium with the real Svelte
// compiler against a reactive relationship snapshot.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createReputationViewModel } from '../lib/views/game/ui/overlays/reputation/reputation_view_model.svelte';
import { createReactiveReputationHarness } from '../lib/views/game/ui/overlays/reputation/testing/reputation_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('ReputationViewModel — reactive standings (real runes)', () => {
  test('derived entries follow the reactive snapshot', () => {
    const harness = createReactiveReputationHarness();
    const viewModel = createReputationViewModel({
      className: 'ReputationViewModel',
      relationship: harness.relationship,
      overlay: harness.overlay,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.isEmpty).toBe(true);

    harness.setSnapshot({
      factionStandings: { emberwatch: { standing: 60, tier: 'honored' } },
      characterRelationships: { npcA: { trust: 10, affinity: 5, relationshipType: 'friend' } },
    });
    flushSync();

    expect(viewModel.isEmpty).toBe(false);
    expect(viewModel.factions).toHaveLength(1);
    expect(viewModel.factions[0].tierLabel).toBe('Honored');
    expect(viewModel.relationships).toHaveLength(1);
    expect(viewModel.relationships[0].relationshipType).toBe('Friend');
  });
});
