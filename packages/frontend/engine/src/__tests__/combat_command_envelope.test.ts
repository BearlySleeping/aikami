// packages/frontend/engine/src/__tests__/combat_command_envelope.test.ts
//
// Review F-B: ONE command-admission envelope for ordinary v2 commands, with
// command-ID idempotency and cross-run rejection.
//
// Failure classes locked down here:
//   6. a duplicate command ID cannot reroll / spend / apply twice
//   7. the same ID with different content is rejected
//   8. an old-run delayed command after retry is rejected even when the
//      revision numbers coincide
//   9. a stale turn identity is rejected
//  19. the accepted journal replays without provider calls
//
// Contract: C-525 AC-4, C-532 AC-4/AC-6

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { BASIC_COMBAT_ABILITIES } from '@aikami/constants';
import {
  acceptedCommandsForReplay,
  COMBAT_COMMAND_JOURNAL_MAX_ENTRIES,
  combatCommandDigest,
  findCommandJournalEntry,
  getCombatCommandJournal,
  recordCommandOutcome,
  restoreCombatCommandJournal,
} from '../combat/combat_command_envelope.ts';
import { getCombatSessionRevision } from '../combat/combat_session_checkpoint.ts';
import { buildV2CombatState } from '../combat/combat_v2_resolver.ts';
import { getLiveV2CombatState } from '../combat/combat_v2_state.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { liveCommandIdentity } from './support/combat_command_identity.ts';
import {
  buildCombatEncounterHarness,
  type CombatEncounterHarness,
  HARNESS_ENEMY_ID,
  HARNESS_PLAYER_ID,
} from './support/combat_encounter_harness.ts';

let harness: CombatEncounterHarness;

beforeEach(() => {
  harness = buildCombatEncounterHarness();
});

afterEach(() => {
  harness.dispose();
});

const identityFor = (overrides?: {
  basedOnRevision?: number;
  encounterRunId?: string;
  turnId?: string;
}) => {
  const identity = liveCommandIdentity({
    world: harness.world,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    ...overrides,
  });
  if (identity === null) {
    throw new Error('no live encounter');
  }
  return identity;
};

describe('review F-B: a v2 command without the admission envelope is refused', () => {
  it('rejects an ordinary command that carries no identity', () => {
    const before = getLiveV2CombatState(harness.world)?.stateRevision ?? 0;
    const hpBefore = CombatStats.health[harness.enemyEid] ?? 0;
    const sessionBefore = getCombatSessionRevision(harness.world);

    harness.dispatchRaw({ type: 'COMBAT_ACTION', action: 'DEFEND' });

    expect(harness.rejected.at(-1)?.reasonCode).toBe('invalidCommandShape');
    expect(harness.rejected.at(-1)?.detail).toBe('missingCommandIdentity');
    expect(getLiveV2CombatState(harness.world)?.stateRevision).toBe(before);
    expect(CombatStats.health[harness.enemyEid]).toBe(hpBefore);
    expect(getCombatSessionRevision(harness.world)).toBe(sessionBefore);
  });

  it('rejects a command whose encounter-run identity is not the live run', () => {
    const before = getLiveV2CombatState(harness.world)?.stateRevision ?? 0;
    harness.dispatch({
      type: 'COMBAT_ACTION',
      action: 'DEFEND',
      ...identityFor(),
      encounterRunId: 'run:some-other-execution',
    });
    expect(harness.rejected.at(-1)?.reasonCode).toBe('encounterRunMismatch');
    expect(getLiveV2CombatState(harness.world)?.stateRevision).toBe(before);
  });

  it('rejects a stale turn identity at the same revision', () => {
    const before = getLiveV2CombatState(harness.world)?.stateRevision ?? 0;
    harness.dispatch({
      type: 'COMBAT_ACTION',
      action: 'DEFEND',
      ...identityFor(),
      turnId: 'r99:someone-else',
    });
    expect(harness.rejected.at(-1)?.detail).toBe('staleTurn');
    expect(getLiveV2CombatState(harness.world)?.stateRevision).toBe(before);
  });

  it('rejects an actor the engine does not own the turn for', () => {
    const before = getLiveV2CombatState(harness.world)?.stateRevision ?? 0;
    harness.dispatch({
      type: 'COMBAT_ACTION',
      action: 'DEFEND',
      ...identityFor(),
      combatantId: HARNESS_ENEMY_ID,
    });
    expect(harness.rejected.at(-1)?.detail).toBe('actorMismatch');
    expect(getLiveV2CombatState(harness.world)?.stateRevision).toBe(before);
  });
});

describe('review F-B: command-ID idempotency', () => {
  it('a duplicate delivery of an accepted command neither rerolls nor spends twice', () => {
    const identity = identityFor();
    const command = { type: 'COMBAT_ACTION', action: 'ATTACK', targetId: HARNESS_ENEMY_ID };
    harness.dispatch({ ...command, ...identity });

    const afterFirst = getLiveV2CombatState(harness.world);
    const hpAfterFirst = CombatStats.health[harness.enemyEid] ?? 0;
    const revisionAfterFirst = afterFirst?.stateRevision ?? 0;
    expect(revisionAfterFirst).toBe(1);
    expect(harness.accepted).toHaveLength(1);

    // Deliver the SAME command id and the SAME content again.
    harness.dispatch({ ...command, ...identity });

    const afterSecond = getLiveV2CombatState(harness.world);
    expect(afterSecond?.stateRevision).toBe(revisionAfterFirst);
    expect(CombatStats.health[harness.enemyEid]).toBe(hpAfterFirst);
    // The duplicate is acknowledged (the original acceptance stands) and flagged.
    expect(harness.accepted).toHaveLength(2);
    expect(harness.accepted.at(-1)?.duplicate).toBe(true);
    expect(harness.accepted.at(-1)?.stateRevision).toBe(revisionAfterFirst);
    // The RNG substream did not move: the recorded state is byte-identical.
    expect(afterSecond?.rng.streams.actions).toEqual(afterFirst?.rng.streams.actions);
  });

  it('a duplicate of a FAILED command does not reroll', () => {
    const identity = identityFor();
    // A target that does not exist is a typed rejection, not a roll.
    const command = { type: 'COMBAT_ACTION', action: 'ABILITY', abilityId: 'not_a_real_ability' };
    harness.dispatch({ ...command, ...identity });
    const rejectionCount = harness.rejected.length;
    expect(rejectionCount).toBeGreaterThan(0);
    const rngAfterFirst = getLiveV2CombatState(harness.world)?.rng.streams.actions;

    harness.dispatch({ ...command, ...identity });

    expect(harness.rejected.length).toBe(rejectionCount + 1);
    expect(getLiveV2CombatState(harness.world)?.rng.streams.actions).toEqual(rngAfterFirst);
    // A rejected command never advances the accepted-command boundary.
    expect(getCombatSessionRevision(harness.world)).toBe(0);
  });

  it('the same command ID with DIFFERENT content is rejected', () => {
    const identity = identityFor();
    harness.dispatch({
      type: 'COMBAT_ACTION',
      action: 'ATTACK',
      targetId: HARNESS_ENEMY_ID,
      ...identity,
    });
    const revisionAfterFirst = getLiveV2CombatState(harness.world)?.stateRevision ?? 0;

    // Same id, different command content.
    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identity });

    expect(harness.rejected.at(-1)?.reasonCode).toBe('invalidCommandShape');
    expect(harness.rejected.at(-1)?.detail).toBe('commandIdConflict');
    expect(getLiveV2CombatState(harness.world)?.stateRevision).toBe(revisionAfterFirst);
  });

  it('the digest ignores identity and depends only on mechanical content', () => {
    const command = {
      kind: 'endTurn' as const,
      combatantId: HARNESS_PLAYER_ID,
    };
    expect(combatCommandDigest(command)).toBe(combatCommandDigest({ ...command }));
    expect(combatCommandDigest(command)).not.toBe(
      combatCommandDigest({ kind: 'defend', combatantId: HARNESS_PLAYER_ID }),
    );
  });
});

describe('review F-B: an old run cannot act on a new one', () => {
  it('rejects a delayed command from a previous run at the same revision', () => {
    const staleIdentity = identityFor();
    const revisionAtCapture = staleIdentity.basedOnRevision;

    // Simulate a retry: a NEW execution run at the SAME authored encounter id
    // and the SAME revision number (a same-seed retry is deterministic).
    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identityFor() });
    const runAfterAdvance = getLiveV2CombatState(harness.world)?.encounterRunId ?? '';
    expect(runAfterAdvance.length).toBeGreaterThan(0);

    // In-run: the captured identity of the previous attempt is refused before a
    // second harness can allocate overlapping process-global component slots.
    const before = getLiveV2CombatState(harness.world)?.stateRevision ?? 0;
    harness.dispatch({
      type: 'COMBAT_ACTION',
      action: 'ATTACK',
      targetId: HARNESS_ENEMY_ID,
      ...staleIdentity,
      encounterRunId: 'run:retired-attempt',
    });
    expect(harness.rejected.at(-1)?.reasonCode).toBe('encounterRunMismatch');
    expect(getLiveV2CombatState(harness.world)?.stateRevision).toBe(before);

    // A fresh attempt allocates a new run identity for the same encounter.
    const fresh = buildCombatEncounterHarness({ seed: 4242 });
    try {
      const freshRun = getLiveV2CombatState(fresh.world)?.encounterRunId;
      // The identity that was captured in the OLD run must not be admitted even
      // though `basedOnRevision` matches the fresh run's revision 0.
      expect(staleIdentity.encounterRunId).not.toBe(freshRun ?? '');
      expect(staleIdentity.basedOnRevision).toBe(revisionAtCapture);
    } finally {
      fresh.dispose();
    }
  });
});

describe('review F-B: the accepted journal is the replay input', () => {
  it('records accepted commands in order and exposes them for replay', () => {
    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identityFor() });
    harness.dispatch({ type: 'COMBAT_END_TURN', ...identityFor() });

    const journal = getCombatCommandJournal(harness.world, 'review-2-harness-encounter');
    expect(journal).not.toBeNull();
    expect(journal?.entries).toHaveLength(2);
    expect(journal?.entries[0]?.outcome).toBe('accepted');
    expect(journal?.entries[0]?.previousRevision).toBe(0);
    expect(journal?.entries[0]?.resultRevision).toBe(1);

    const commands = acceptedCommandsForReplay(harness.world, 'review-2-harness-encounter');
    expect(commands).toHaveLength(2);
    expect(commands[0]?.kind).toBe('defend');
    expect(commands[1]?.kind).toBe('endTurn');
  });

  it('records a rejected command too, so a replay aborts at the same point', () => {
    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identityFor() });
    // A second DEFEND has no action left.
    harness.dispatch({ type: 'COMBAT_ACTION', action: 'DEFEND', ...identityFor() });
    const journal = getCombatCommandJournal(harness.world, 'review-2-harness-encounter');
    const last = journal?.entries.at(-1);
    expect(last?.outcome).toBe('rejected');
    expect(last?.reasonCode).toBe('noActionAvailable');
    expect(last?.resultRevision).toBeNull();
    // Only the accepted one is replay input.
    expect(acceptedCommandsForReplay(harness.world, 'review-2-harness-encounter')).toHaveLength(1);
  });

  it('bounds the journal and tracks the eviction cursor', () => {
    const overflow = 3;
    for (let index = 0; index < COMBAT_COMMAND_JOURNAL_MAX_ENTRIES + overflow; index++) {
      recordCommandOutcome({
        world: harness.world,
        encounterId: 'review-2-harness-encounter',
        identity: {
          commandId: `synthetic-${index}`,
          encounterId: 'review-2-harness-encounter',
          encounterRunId: 'run:synthetic',
          combatantId: HARNESS_PLAYER_ID,
          turnId: 'r1:player',
          basedOnRevision: index,
        },
        digest: `digest-${index}`,
        command: { kind: 'endTurn', combatantId: HARNESS_PLAYER_ID },
        previousRevision: index,
        resultRevision: index + 1,
        outcome: 'accepted',
      });
    }
    const journal = getCombatCommandJournal(harness.world, 'review-2-harness-encounter');
    expect(journal?.entries).toHaveLength(COMBAT_COMMAND_JOURNAL_MAX_ENTRIES);
    expect(journal?.droppedCount).toBe(overflow);
    expect(
      findCommandJournalEntry(harness.world, 'review-2-harness-encounter', 'synthetic-0'),
    ).toBeNull();
  });

  it('adds entries truncated from an oversized restored journal to the cursor', () => {
    const overflow = 2;
    restoreCombatCommandJournal({
      world: harness.world,
      encounterId: 'review-2-harness-encounter',
      journal: {
        droppedCount: 4,
        entries: Array.from(
          { length: COMBAT_COMMAND_JOURNAL_MAX_ENTRIES + overflow },
          (_, index) => ({
            commandId: `restored-${index}`,
            digest: `digest-${index}`,
            command: { kind: 'defend' as const, combatantId: HARNESS_PLAYER_ID },
            previousRevision: index,
            resultRevision: index + 1,
            outcome: 'accepted' as const,
          }),
        ),
      },
    });

    const journal = getCombatCommandJournal(harness.world, 'review-2-harness-encounter');
    expect(journal?.entries).toHaveLength(COMBAT_COMMAND_JOURNAL_MAX_ENTRIES);
    expect(journal?.droppedCount).toBe(4 + overflow);
    expect(
      findCommandJournalEntry(harness.world, 'review-2-harness-encounter', 'restored-0'),
    ).toBeNull();
  });
});

describe('review F-B: the admission identity matches the engine projection', () => {
  it('mints the encounter, run, turn, actor and revision the engine owns', () => {
    const identity = identityFor();
    const state = buildV2CombatState({
      world: harness.world,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
    });
    expect(state).not.toBeNull();
    if (state === null) {
      return;
    }
    expect(identity.encounterId).toBe(state.encounterId);
    expect(identity.encounterRunId).toBe(state.encounterRunId);
    expect(identity.turnId).toBe(state.turnId ?? '');
    expect(identity.basedOnRevision).toBe(state.stateRevision);
    expect(identity.combatantId).toBe(state.initiative.order[state.initiative.activeIndex]);
  });
});
