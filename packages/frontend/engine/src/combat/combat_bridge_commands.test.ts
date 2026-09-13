// packages/frontend/engine/src/combat/combat_bridge_commands.test.ts
//
// C-516 AC-2 / AC-8 regression guard for the main-thread command registry.
//
// `EngineBridgeImpl.send` DROPS a command whose type has no registered handler.
// A combat command that the client can send but the registrar does not forward
// is therefore silently lost on the main thread — the worker's handler becomes
// dead code at runtime and no encounter can ever start in production. This file
// pins the exact set of forwarded types, and the payload of each forwarder.
//
// Contract: C-516 AC-2, AC-8

import { describe, expect, test } from 'bun:test';
import type { GameCommand } from '../types.ts';
import {
  registerCombatBridgeCommands,
  toCombatPreviewEnvelope,
  toCombatStartEncounterEnvelope,
} from './combat_bridge_commands.ts';
import type { CombatEncounterParticipant } from './combat_encounter_start.ts';

type Registrar = Parameters<typeof registerCombatBridgeCommands>[0]['register'];

const ENEMY: CombatEncounterParticipant = {
  combatantId: 'emberwatch/rollo_grasper',
  team: 'enemy',
  npcId: 'rollo_grasper',
  stats: { hitPoints: 20, armorClass: 11, attackBonus: 2, initiative: 0 },
};

/** A registrar that records the handlers instead of wiring them to a world. */
const createHarness = () => {
  const handlers = new Map<string, (command: never) => void>();
  const posted: GameCommand[] = [];

  registerCombatBridgeCommands({
    register: ((type: string, handler: (command: never) => void) => {
      handlers.set(type, handler);
    }) as Registrar,
    post: (command) => {
      posted.push(command as GameCommand);
    },
  });

  const send = (command: GameCommand): void => {
    const handler = handlers.get(command.type);
    if (handler === undefined) {
      throw new Error(`no forwarder registered for ${command.type}`);
    }
    (handler as unknown as (value: GameCommand) => void)(command);
  };

  return { handlers, posted, send };
};

/**
 * Every combat command the CLIENT can send that the worker must receive.
 *
 * `COMBAT_MOVE_MODE` is deliberately absent: it is handled on the main thread
 * by `GameWorld` (the worker cannot see a UI selection).
 */
const WORKER_REACHABLE_COMBAT_COMMANDS = [
  'COMBAT_ACTION',
  'COMBAT_END_TURN',
  'COMBAT_MOVE',
  'COMBAT_PREVIEW_REQUESTED',
  'COMBAT_START_ENCOUNTER',
] as const;

describe('C-516 AC-2: every worker-reachable combat command has a forwarder', () => {
  test('the registry covers the full worker-reachable command set', () => {
    const { handlers } = createHarness();
    for (const type of WORKER_REACHABLE_COMBAT_COMMANDS) {
      expect(handlers.has(type), `${type} has no main-thread forwarder`).toBe(true);
    }
  });

  test('COMBAT_START_ENCOUNTER reaches the worker with its authored roster', () => {
    const { posted, send } = createHarness();
    send({
      type: 'COMBAT_START_ENCOUNTER',
      encounterId: 'proof_encounter',
      seed: 4242,
      engine: 'v2',
      roster: [ENEMY],
    } as GameCommand);

    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      type: 'COMBAT_START_ENCOUNTER',
      encounterId: 'proof_encounter',
      seed: 4242,
      engine: 'v2',
      roster: [ENEMY],
    });
  });

  test('COMBAT_START_ENCOUNTER without a roster forwards no roster key', () => {
    const { posted, send } = createHarness();
    send({
      type: 'COMBAT_START_ENCOUNTER',
      encounterId: 'inn_wand_encounter',
      seed: 1,
    } as GameCommand);

    expect(posted[0]).toEqual({
      type: 'COMBAT_START_ENCOUNTER',
      encounterId: 'inn_wand_encounter',
      seed: 1,
    });
    expect(Object.keys(posted[0] ?? {})).not.toContain('roster');
  });

  test('COMBAT_MOVE forwards the destination cell (never a path)', () => {
    const { posted, send } = createHarness();
    send({ type: 'COMBAT_MOVE', cellX: 3, cellY: 4 } as GameCommand);

    expect(posted[0]).toEqual({ type: 'COMBAT_MOVE', cellX: 3, cellY: 4 });
    expect(Object.keys(posted[0] ?? {})).not.toContain('path');
  });

  test('COMBAT_ACTION keeps the ability id (an ABILITY action would be rejected without it)', () => {
    const { posted, send } = createHarness();
    send({
      type: 'COMBAT_ACTION',
      action: 'ABILITY',
      abilityId: 'wizard_magic_missile',
      targetId: 2,
    } as GameCommand);

    expect(posted[0]).toEqual({
      type: 'COMBAT_ACTION',
      action: 'ABILITY',
      abilityId: 'wizard_magic_missile',
      targetId: 2,
    });
  });

  test('COMBAT_ACTION omits keys the client did not send', () => {
    const { posted, send } = createHarness();
    send({ type: 'COMBAT_ACTION', action: 'DEFEND' } as GameCommand);

    const forwarded = posted[0] ?? {};
    expect(forwarded).toEqual({ type: 'COMBAT_ACTION', action: 'DEFEND' });
    expect(Object.keys(forwarded)).not.toContain('abilityId');
    expect(Object.keys(forwarded)).not.toContain('targetId');
  });

  test('COMBAT_END_TURN and COMBAT_PREVIEW_REQUESTED are unchanged', () => {
    const { posted, send } = createHarness();
    send({ type: 'COMBAT_END_TURN' } as GameCommand);
    send({
      type: 'COMBAT_PREVIEW_REQUESTED',
      requestId: 'preview-1',
      encounterId: 'proof_encounter',
      basedOnRevision: 2,
      query: { kind: 'legalMoves', combatantId: 'player' },
    } as GameCommand);

    expect(posted[0]).toEqual({ type: 'COMBAT_END_TURN' });
    expect(posted[1]).toEqual({
      type: 'COMBAT_PREVIEW_REQUESTED',
      requestId: 'preview-1',
      encounterId: 'proof_encounter',
      basedOnRevision: 2,
      query: { kind: 'legalMoves', combatantId: 'player' },
    });
  });

  test('the start envelope is a pure value with no dropped fields', () => {
    const command = {
      type: 'COMBAT_START_ENCOUNTER' as const,
      encounterId: 'proof_encounter',
      seed: 7,
      engine: 'v2' as const,
      roster: [ENEMY],
    };
    expect(toCombatStartEncounterEnvelope(command)).toEqual(command);
  });

  test('the preview envelope drops nothing the worker validates', () => {
    const command = {
      type: 'COMBAT_PREVIEW_REQUESTED' as const,
      requestId: 'preview-2',
      encounterId: 'proof_encounter',
      basedOnRevision: 0,
      query: { kind: 'legalTargets' as const, combatantId: 'player', abilityId: 'basic_melee' },
    };
    expect(toCombatPreviewEnvelope(command)).toEqual(command);
  });
});
