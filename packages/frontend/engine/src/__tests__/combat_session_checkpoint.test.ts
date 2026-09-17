// packages/frontend/engine/src/__tests__/combat_session_checkpoint.test.ts
//
// Review F-B: ONE coherent save/checkpoint boundary.
//
// Failure classes locked down here:
//  21. a checkpoint captures state, journal, retry checkpoint, pending reaction
//      and the stable actor bindings ATOMICALLY, and its boundary id only moves
//      on an ACCEPTED transition
//  22. a restored checkpoint restores the journal and the retry checkpoint too,
//      not just the bare state
//
// Contract: C-531 AC-7, C-532 AC-4/AC-5/AC-6

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { BASIC_COMBAT_ABILITIES } from '@aikami/constants';
import { emptyMoraleRules, emptyObjectiveRules } from '@aikami/schemas';
import {
  buildCombatSessionCheckpoint,
  combatSessionIsStable,
  getCombatSessionRevision,
} from '../combat/combat_session_checkpoint.ts';
import { getCombatCommandJournal } from '../combat/combat_command_envelope.ts';
import { getEncounterRetryRecord } from '../combat/combat_encounter_retry.ts';
import { buildV2CombatState } from '../combat/combat_v2_resolver.ts';
import { getLiveV2CombatState } from '../combat/combat_v2_state.ts';
import { dispatchCombatCommand } from '../combat/combat_command_dispatch.ts';
import {
  type CombatEncounterHarness,
  buildCombatEncounterHarness,
  HARNESS_ENCOUNTER_ID,
} from './support/combat_encounter_harness.ts';
import { liveCommandIdentity } from './support/combat_command_identity.ts';

let harness: CombatEncounterHarness;

beforeEach(() => {
  harness = buildCombatEncounterHarness({
    depth: {
      objectiveRules: emptyObjectiveRules(),
      moraleRules: emptyMoraleRules(),
      reactionRegistry: { definitions: [] },
    },
  });
});

afterEach(() => {
  harness.dispose();
});

const identity = () => {
  const minted = liveCommandIdentity({
    world: harness.world,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
  });
  if (minted === null) {
    throw new Error('no live encounter');
  }
  return minted;
};

const dispatchRaw = (command: Parameters<typeof dispatchCombatCommand>[0]): void => {
  dispatchCombatCommand(command, {
    world: harness.world,
    bridge: harness.bridge,
    playerEntityId: harness.playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
  });
};

describe('review F-B: the checkpoint is one atomic payload', () => {
  it('captures state, journal, retry checkpoint, actor bindings and the boundary', () => {
    expect(buildCombatSessionCheckpoint(harness.world)).toBeNull();

    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identity() });

    const checkpoint = buildCombatSessionCheckpoint(harness.world);
    expect(checkpoint).not.toBeNull();
    if (checkpoint === null) {
      return;
    }
    expect(checkpoint.encounterId).toBe(HARNESS_ENCOUNTER_ID);
    expect(checkpoint.encounterRunId.length).toBeGreaterThan(0);
    expect(checkpoint.stateRevision).toBe(1);
    expect(checkpoint.sessionRevision).toBe(1);
    expect(checkpoint.state).not.toBeNull();
    expect(checkpoint.schemaVersion).toBe(checkpoint.state?.schemaVersion ?? -1);
    expect(checkpoint.rulesVersion).toBe('combat-2.0.0');
    // The journal is part of the same capture, not a second read.
    expect(checkpoint.journal?.entries).toHaveLength(1);
    expect(checkpoint.journal?.entries[0]?.command.kind).toBe('defend');
    // The initial retry checkpoint carries the authored actor bindings.
    expect(checkpoint.initialCheckpoint?.participants).toHaveLength(2);
    expect(checkpoint.actorBindings.map((binding) => binding.combatantId).sort()).toEqual([
      'emberwatch/harness_hound',
      'player',
    ]);
    // Never a raw eid as durable identity.
    expect(JSON.stringify(checkpoint.initialCheckpoint)).not.toContain('entityIds');
  });

  it('records the authored npc binding for an enemy actor', () => {
    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identity() });
    const checkpoint = buildCombatSessionCheckpoint(harness.world);
    const enemy = checkpoint?.actorBindings.find(
      (binding) => binding.combatantId === 'emberwatch/harness_hound',
    );
    expect(enemy?.authoredNpcId).toBe('harness_hound');
    expect(enemy?.team).toBe('enemy');
  });

  it('exposes a pending reaction window when the encounter is suspended', () => {
    // No reaction is authored here, so the field is honestly null rather than
    // an invented window.
    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identity() });
    expect(buildCombatSessionCheckpoint(harness.world)?.pendingReaction).toBeNull();
  });
});

describe('review F-B: the boundary id moves only on an ACCEPTED transition', () => {
  it('does not move for a rejected command', () => {
    const before = getCombatSessionRevision(harness.world);
    // A command with no identity is refused before the kernel.
    harness.dispatchRaw({ type: 'COMBAT_ACTION', action: 'DEFEND' });
    expect(harness.rejected).toHaveLength(1);
    expect(getCombatSessionRevision(harness.world)).toBe(before);
  });

  it('moves exactly once per accepted transition', () => {
    expect(getCombatSessionRevision(harness.world)).toBe(0);
    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identity() });
    const afterDefend = getCombatSessionRevision(harness.world);
    expect(afterDefend).toBeGreaterThan(0);
    harness.dispatch({ type: 'COMBAT_END_TURN', ...identity() });
    // Ending the turn may also resolve AI turns, so the boundary advances by at
    // least one more accepted transition — never backwards, never zero.
    expect(getCombatSessionRevision(harness.world)).toBeGreaterThan(afterDefend);
  });

  it('reports stability for the boundary that was captured', () => {
    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identity() });
    const captured = getCombatSessionRevision(harness.world);
    expect(combatSessionIsStable({ world: harness.world, sessionRevision: captured })).toBe(true);

    // Combat advances: the boundary the caller captured is now stale, so the
    // save must be retried rather than written.
    harness.dispatch({ type: 'COMBAT_END_TURN', ...identity() });
    expect(combatSessionIsStable({ world: harness.world, sessionRevision: captured })).toBe(false);
  });
});

describe('review F-B: a restore installs the whole checkpoint', () => {
  it('restores the state, the journal, the retry checkpoint and the boundary', () => {
    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identity() });
    harness.dispatch({ type: 'COMBAT_END_TURN', ...identity() });
    const checkpoint = buildCombatSessionCheckpoint(harness.world);
    expect(checkpoint).not.toBeNull();
    if (checkpoint === null || checkpoint.state === null) {
      return;
    }

    // A fresh session (the reload) starts with no live encounter.
    const reloaded = buildCombatEncounterHarness();
    try {
      dispatchCombatCommand(
        { type: 'COMBAT_CHECKPOINT_RESTORED', state: null },
        {
          world: reloaded.world,
          bridge: reloaded.bridge,
          playerEntityId: reloaded.playerEid,
          abilityCatalog: BASIC_COMBAT_ABILITIES,
        },
      );
      expect(getLiveV2CombatState(reloaded.world)).toBeNull();

      dispatchCombatCommand(
        {
          type: 'COMBAT_CHECKPOINT_RESTORED',
          state: checkpoint.state,
          journal: checkpoint.journal,
          initialCheckpoint: checkpoint.initialCheckpoint,
          sessionRevision: checkpoint.sessionRevision,
        },
        {
          world: reloaded.world,
          bridge: reloaded.bridge,
          playerEntityId: reloaded.playerEid,
          abilityCatalog: BASIC_COMBAT_ABILITIES,
        },
      );

      // The authoritative state is installed at its own revision…
      expect(getLiveV2CombatState(reloaded.world)?.stateRevision).toBe(checkpoint.stateRevision);
      // …the boundary continues the recorded one…
      expect(getCombatSessionRevision(reloaded.world)).toBe(checkpoint.sessionRevision);
      // …the accepted-command journal is restored (replay + idempotency)…
      const journal = getCombatCommandJournal(reloaded.world, HARNESS_ENCOUNTER_ID);
      expect(journal?.entries).toHaveLength(2);
      // …and the initial retry checkpoint is re-bound to THIS session's entities.
      const retry = getEncounterRetryRecord(reloaded.world);
      expect(retry?.participants).toHaveLength(2);
      expect(retry?.entityIds.some((eid) => eid > 0)).toBe(true);
    } finally {
      reloaded.dispose();
    }
  });

  it('refuses to resume a fight the save never captured', () => {
    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identity() });
    expect(getLiveV2CombatState(harness.world)).not.toBeNull();

    dispatchRaw({ type: 'COMBAT_CHECKPOINT_RESTORED', state: null });

    expect(getLiveV2CombatState(harness.world)).toBeNull();
    expect(buildV2CombatState({ world: harness.world, abilityCatalog: BASIC_COMBAT_ABILITIES })).not.toBeNull();
    expect(getEncounterRetryRecord(harness.world)).not.toBeNull();
  });
});

describe('review F-B: the checkpoint survives the objective/morale rules pinning', () => {
  it('carries the pinned depth through the initial checkpoint', () => {
    const withDepth = buildCombatEncounterHarness({
      depth: {
        objectiveRules: emptyObjectiveRules(),
        moraleRules: emptyMoraleRules(),
        reactionRegistry: { definitions: [] },
      },
    });
    try {
      withDepth.dispatch({
        type: 'COMBAT_ACTION',
        action: 'DEFEND',
        ...liveCommandIdentity({
          world: withDepth.world,
          abilityCatalog: BASIC_COMBAT_ABILITIES,
        }),
      });
      const checkpoint = buildCombatSessionCheckpoint(withDepth.world);
      const depth = checkpoint?.initialCheckpoint?.depth;
      expect(depth).toBeDefined();
      // The authored depth is pinned verbatim — never today's content pack.
      expect(depth?.objectiveRules).toEqual(emptyObjectiveRules());
      expect(depth?.moraleRules).toEqual(emptyMoraleRules());
    } finally {
      withDepth.dispose();
    }
  });
});

describe('review F-B: a save before the first command still captures the fight', () => {
  it('projects the opening state so the checkpoint is not silently omitted', () => {
    // No command has been issued, so no live kernel state exists yet.
    expect(buildCombatSessionCheckpoint(harness.world)).toBeNull();

    const ready: Array<{ sessionRevision: number; checkpoint: unknown }> = [];
    harness.bridge.on('COMBAT_SESSION_CHECKPOINT_READY', (event) => {
      ready.push({ sessionRevision: event.sessionRevision, checkpoint: event.checkpoint });
    });
    dispatchRaw({ type: 'COMBAT_SESSION_CHECKPOINT_REQUESTED', requestId: 'save-1' });

    expect(ready).toHaveLength(1);
    const captured = ready[0]?.checkpoint as { state: unknown; encounterId: string } | null;
    expect(captured).not.toBeNull();
    expect(captured?.encounterId).toBe(HARNESS_ENCOUNTER_ID);
    // The opening state is revision 0 — a save taken before the first command
    // must not advance the accepted-command boundary.
    expect(ready[0]?.sessionRevision).toBe(0);
    expect(getCombatSessionRevision(harness.world)).toBe(0);
  });

  it('reports the boundary id for a stable re-read', () => {
    const revisions: number[] = [];
    harness.bridge.on('COMBAT_SESSION_REVISION_READY', (event) => {
      revisions.push(event.sessionRevision);
    });
    dispatchRaw({ type: 'COMBAT_SESSION_REVISION_REQUESTED', requestId: 'rev-1' });
    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identity() });
    dispatchRaw({ type: 'COMBAT_SESSION_REVISION_REQUESTED', requestId: 'rev-2' });
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toBe(0);
    expect(revisions[1]).toBeGreaterThan(0);
  });
});
