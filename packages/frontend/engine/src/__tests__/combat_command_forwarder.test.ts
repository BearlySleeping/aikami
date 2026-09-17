// packages/frontend/engine/src/__tests__/combat_command_forwarder.test.ts
//
// Review F-B: the MAIN-THREAD forwarder must carry the whole command.
//
// This is the production seam. `EngineBridge.send` on the main thread runs the
// registered handler and `post`s the resulting envelope to the worker, so a
// field the forwarder drops is a field the worker never sees — even though a
// direct `dispatchCombatCommand` test still passes.
//
// Before the repair the forwarder dropped, for ordinary commands:
//   * `basedOnRevision` on COMBAT_MOVE / COMBAT_END_TURN / COMBAT_INTERACT,
//   * `targetIds` on COMBAT_ACTION (the multi-target fix never reached the
//     kernel in production),
//   * the whole command-admission identity,
// and it had NO registration at all for COMBAT_CHECKPOINT_REQUESTED,
// COMBAT_CHECKPOINT_RESTORED or COMBAT_COMPANION_MODE_SET, so those commands
// were silently dropped on the main thread.
//
// Contract: C-515 AC-5, C-516 AC-4/AC-8, C-531 AC-2, C-532 AC-3/AC-4

import { describe, expect, it } from 'bun:test';
import type { GameCommand } from '../types.ts';
import {
  registerCombatBridgeCommands,
  toCombatActionEnvelope,
  withCommandAdmission,
} from '../combat/combat_bridge_commands.ts';

type Forwarded = Record<string, unknown>;

const forward = (command: GameCommand): Forwarded => {
  const posted: Forwarded[] = [];
  registerCombatBridgeCommands({
    register: (type, handler) => {
      if (type === command.type) {
        (handler as (value: GameCommand) => void)(command);
      }
    },
    post: (value) => {
      posted.push(value as Forwarded);
    },
  });
  const first = posted[0];
  if (first === undefined) {
    throw new Error(`no forwarder posted for ${command.type}`);
  }
  return first;
};

const IDENTITY = {
  commandId: 'cmd-1',
  encounterId: 'emberwatch/proof_encounter',
  encounterRunId: 'run:emberwatch/proof_encounter:r1:abc:1',
  combatantId: 'player',
  turnId: 'r1:player',
  basedOnRevision: 4,
} as const;

describe('review F-B: the forwarder carries the command-admission identity', () => {
  it('keeps every identity field on COMBAT_MOVE, including the confirmed path', () => {
    const forwarded = forward({
      type: 'COMBAT_MOVE',
      cellX: 3,
      cellY: 4,
      path: [
        { x: 2, y: 1 },
        { x: 3, y: 2 },
        { x: 3, y: 3 },
        { x: 3, y: 4 },
      ],
      ...IDENTITY,
    } as GameCommand);
    expect(forwarded).toEqual({
      type: 'COMBAT_MOVE',
      cellX: 3,
      cellY: 4,
      path: [
        { x: 2, y: 1 },
        { x: 3, y: 2 },
        { x: 3, y: 3 },
        { x: 3, y: 4 },
      ],
      ...IDENTITY,
    });
  });

  it('keeps every identity field and the COMPLETE target set on COMBAT_ACTION', () => {
    const forwarded = forward({
      type: 'COMBAT_ACTION',
      action: 'ABILITY',
      abilityId: 'sweeping_strike',
      targetId: 'goblin-1',
      targetIds: ['goblin-1', 'goblin-2'],
      ...IDENTITY,
    } as GameCommand);
    expect(forwarded.type).toBe('COMBAT_ACTION');
    expect(forwarded.abilityId).toBe('sweeping_strike');
    expect(forwarded.targetId).toBe('goblin-1');
    expect(forwarded.targetIds).toEqual(['goblin-1', 'goblin-2']);
    expect(forwarded).toMatchObject(IDENTITY);
  });

  it('keeps the legacy modifiers on COMBAT_ACTION', () => {
    const forwarded = forward({
      type: 'COMBAT_ACTION',
      action: 'ATTACK',
      advantage: true,
      bonusDamage: 2,
      damageType: 'fire',
      ...IDENTITY,
    } as GameCommand);
    expect(forwarded.advantage).toBe(true);
    expect(forwarded.bonusDamage).toBe(2);
    expect(forwarded.damageType).toBe('fire');
  });

  it('keeps every identity field on COMBAT_END_TURN and COMBAT_INTERACT', () => {
    expect(forward({ type: 'COMBAT_END_TURN', ...IDENTITY } as GameCommand)).toEqual({
      type: 'COMBAT_END_TURN',
      ...IDENTITY,
    });
    const interact = forward({
      type: 'COMBAT_INTERACT',
      objectId: 'brazier',
      affordanceId: 'tip_over',
      targetObjectId: 'oil_pool',
      ...IDENTITY,
    } as GameCommand);
    expect(interact.objectId).toBe('brazier');
    expect(interact.affordanceId).toBe('tip_over');
    expect(interact.targetObjectId).toBe('oil_pool');
    expect(interact).toMatchObject(IDENTITY);
  });
});

describe('review F-B: the commands that had NO forwarder are now routed', () => {
  it('forwards COMBAT_CHECKPOINT_REQUESTED', () => {
    expect(forward({ type: 'COMBAT_CHECKPOINT_REQUESTED', requestId: 'r-1' } as GameCommand)).toEqual(
      { type: 'COMBAT_CHECKPOINT_REQUESTED', requestId: 'r-1' },
    );
  });

  it('forwards COMBAT_CHECKPOINT_RESTORED', () => {
    expect(forward({ type: 'COMBAT_CHECKPOINT_RESTORED', state: null } as GameCommand)).toEqual({
      type: 'COMBAT_CHECKPOINT_RESTORED',
      state: null,
    });
  });

  it('forwards COMBAT_COMPANION_MODE_SET with the encounter and mode', () => {
    expect(
      forward({
        type: 'COMBAT_COMPANION_MODE_SET',
        encounterId: 'emberwatch/proof_encounter',
        combatantId: 'npc-mara',
        mode: 'direct',
      } as GameCommand),
    ).toEqual({
      type: 'COMBAT_COMPANION_MODE_SET',
      encounterId: 'emberwatch/proof_encounter',
      combatantId: 'npc-mara',
      mode: 'direct',
    });
  });

  it('forwards the atomic session checkpoint and the revision probe', () => {
    expect(
      forward({ type: 'COMBAT_SESSION_CHECKPOINT_REQUESTED', requestId: 'r-2' } as GameCommand),
    ).toEqual({ type: 'COMBAT_SESSION_CHECKPOINT_REQUESTED', requestId: 'r-2' });
    expect(
      forward({ type: 'COMBAT_SESSION_REVISION_REQUESTED', requestId: 'r-3' } as GameCommand),
    ).toEqual({ type: 'COMBAT_SESSION_REVISION_REQUESTED', requestId: 'r-3' });
  });
});

describe('review F-B: withCommandAdmission copies optional fields verbatim', () => {
  it('omits absent fields instead of writing undefined', () => {
    expect(withCommandAdmission({}, { type: 'X' })).toEqual({ type: 'X' });
  });

  it('copies every present field', () => {
    expect(withCommandAdmission({ ...IDENTITY, requestId: 'req-1' }, { type: 'X' })).toEqual({
      type: 'X',
      ...IDENTITY,
      requestId: 'req-1',
    });
  });
});

describe('review F-B: toCombatActionEnvelope is a pure value', () => {
  it('preserves the full target set and identity', () => {
    const envelope = toCombatActionEnvelope({
      type: 'COMBAT_ACTION',
      action: 'ABILITY',
      abilityId: 'a',
      targetIds: ['t1', 't2'],
      ...IDENTITY,
    } as Extract<GameCommand, { type: 'COMBAT_ACTION' }>);
    expect(envelope.targetIds).toEqual(['t1', 't2']);
    expect(envelope).toMatchObject(IDENTITY);
  });
});
