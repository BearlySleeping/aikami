// packages/frontend/engine/src/__tests__/combat_sync_events.test.ts
//
// Review F9: the live-snapshot re-emission carries the EXECUTION-RUN identity.
//
// A ViewModel that mounts after `COMBAT_STARTED` has already been emitted asks
// the engine for the live snapshot (`COMBAT_SYNC_REQUEST`), which re-emits
// `COMBAT_STARTED`. If that re-emission omits the run identity, the client's
// run guard degrades to the AUTHORED encounter id — which recurs on retry — so a
// delayed close callback from a finished attempt could act on its replacement.
//
// The identity must also survive a restore: `COMBAT_CHECKPOINT_RESTORED` clears
// the per-world run registry but installs the run id on the live kernel state,
// so the snapshot must read it from there.
//
// Contract: C-516 AC-5, C-532 AC-5

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { clearEncounterRunIds } from '../combat/combat_run_identity.ts';
import { getLiveV2CombatState } from '../combat/combat_v2_state.ts';
import {
  type CombatEncounterHarness,
  buildCombatEncounterHarness,
} from './support/combat_encounter_harness.ts';

let harness: CombatEncounterHarness;

beforeEach(() => {
  harness = buildCombatEncounterHarness();
});

afterEach(() => {
  harness.dispose();
});

/** Subscribes to `COMBAT_STARTED` and returns the captured events. */
const captureStarted = (): Array<{ encounterRunId?: string; encounterId?: string | null }> => {
  const events: Array<{ encounterRunId?: string; encounterId?: string | null }> = [];
  harness.bridge.on('COMBAT_STARTED', (event) => events.push(event));
  return events;
};

/** Resolves the first v2 command, which is what allocates the run identity. */
const advanceOnce = (): string => {
  harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND' });
  const runId = getLiveV2CombatState(harness.world)?.encounterRunId ?? '';
  expect(runId.length).toBeGreaterThan(0);
  return runId;
};

describe('review F9: the live combat snapshot carries the execution-run identity', () => {
  it('re-emits the SAME run identity the encounter allocated', () => {
    const liveRunId = advanceOnce();

    const started = captureStarted();
    harness.dispatchRaw({ type: 'COMBAT_SYNC_REQUEST' });

    expect(started).toHaveLength(1);
    expect(started[0]?.encounterRunId).toBe(liveRunId);
  });

  it('falls back to the live kernel state when a restore cleared the registry', () => {
    const liveRunId = advanceOnce();

    // `COMBAT_CHECKPOINT_RESTORED` clears the per-world run registry and then
    // installs the stored state — which still carries the run identity.
    clearEncounterRunIds(harness.world);

    const started = captureStarted();
    harness.dispatchRaw({ type: 'COMBAT_SYNC_REQUEST' });

    expect(started).toHaveLength(1);
    expect(started[0]?.encounterRunId).toBe(liveRunId);
  });
});
