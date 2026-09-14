// packages/frontend/engine/src/combat/combat_ai_worker_binding.ts
//
// Worker-side ownership of the LLM AI turn coordinator (Combat-06, AC-5).
//
// `worker/ecs_worker.ts` is on the source-file-size guard's grandfathered
// baseline, so the coordinator's lifetime — build, run, submit, cancel, and the
// deterministic-retry hook — lives here instead of inline in the worker. The
// worker keeps only a single binding field and one-line call sites.
//
// Contract: C-526 AC-5, AC-9

import { BASIC_COMBAT_ABILITIES } from '@aikami/constants';
import type { CombatAbilityDefinition } from '@aikami/types';
import type { World } from 'bitecs';
import type { EngineBridge } from '../engine_bridge.ts';
import type { CombatDecisionPolicy } from './combat_ai_perception.ts';
import { type CombatAiTurnCoordinator, createCombatAiTurnCoordinator } from './combat_ai_turns.ts';
import type { CombatAiDecisionSubmittedCommand } from './combat_bridge_types.ts';
import { type RunV2AiTurnsOptions, runV2AiTurns } from './combat_v2_ai.ts';

/** Everything the coordinator needs that is stable for one encounter. */
export type CombatAiEncounterPin = {
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  /** The `PUBLIC_COMBAT_LLM_AGENTS` value pinned at encounter start (AC-9). */
  llmAgentsEnabled: boolean;
  /**
   * Authored character policies pinned with the encounter (AC-8).
   *
   * Retained across a retry rebuild so the deterministic retry plans with the
   * same personality/role context the original fight had.
   */
  policyByCombatant: Record<string, CombatDecisionPolicy>;
};

export type CombatAiWorkerBindingOptions = CombatAiEncounterPin & {
  world: World;
  bridge: EngineBridge;
  playerEntityId: number;
  abilityIdsByCombatant?: Record<string, string[]>;
  policyByCombatant?: Record<string, CombatDecisionPolicy>;
};

/** The options the worker has at encounter start (the catalog is the pin). */
export type CombatAiEncounterStartOptions = {
  world: World;
  bridge: EngineBridge;
  playerEntityId: number;
  /** The encounter-start result; its ability grants and policies are authoritative. */
  started:
    | {
        ok: true;
        abilityIdsByCombatant: Record<string, string[]>;
        policyByCombatant: Record<string, CombatDecisionPolicy>;
      }
    | { ok: false };
  llmAgentsEnabled: boolean;
};

export type CombatAiWorkerBinding = {
  /** Builds (or rebuilds) the coordinator for the encounter about to run. */
  configure(options: CombatAiWorkerBindingOptions): void;
  /** Encounter-start path: pins the production catalog, then runs the chain. */
  startFromEncounter(options: CombatAiEncounterStartOptions): void;
  /** Runs or defers AI turns through the current coordinator. */
  run(): void;
  /** Hands a client submission to the coordinator; `false` when it matched nothing. */
  submit(command: CombatAiDecisionSubmittedCommand): boolean;
  /**
   * The `runAiTurns` hook the deterministic encounter retry expects.
   *
   * Rebuilds the coordinator from the retry options (the world and the ability
   * grants it carries are authoritative) and runs it; the pinned flag and the
   * ability catalog come from the encounter pin.
   */
  runRetryAiTurns(options: RunV2AiTurnsOptions): void;
  /** Cancels every outstanding request (encounter teardown / restart). */
  cancel(): void;
  /** The live coordinator, for the dispatcher's submission routing. */
  coordinator(): CombatAiTurnCoordinator | null;
};

/** Creates the per-worker binding holder (one instance per ECS worker). */
export const createCombatAiWorkerBinding = (): CombatAiWorkerBinding => {
  let coordinator: CombatAiTurnCoordinator | null = null;
  let pin: CombatAiEncounterPin = {
    abilityCatalog: {},
    llmAgentsEnabled: false,
    policyByCombatant: {},
  };

  const cancel = (): void => {
    coordinator?.cancelAll();
    coordinator = null;
  };

  const build = (options: CombatAiWorkerBindingOptions): void => {
    cancel();
    pin = {
      abilityCatalog: options.abilityCatalog,
      llmAgentsEnabled: options.llmAgentsEnabled,
      policyByCombatant: options.policyByCombatant ?? pin.policyByCombatant,
    };
    coordinator = createCombatAiTurnCoordinator({
      world: options.world,
      bridge: options.bridge,
      abilityCatalog: options.abilityCatalog,
      playerEntityId: options.playerEntityId,
      llmAgentsEnabled: options.llmAgentsEnabled,
      ...(options.abilityIdsByCombatant === undefined
        ? {}
        : { abilityIdsByCombatant: options.abilityIdsByCombatant }),
      ...(options.policyByCombatant === undefined
        ? {}
        : { policyByCombatant: options.policyByCombatant }),
    });
  };

  return {
    configure(options) {
      build(options);
    },
    startFromEncounter(options) {
      build({
        world: options.world,
        bridge: options.bridge,
        playerEntityId: options.playerEntityId,
        abilityCatalog: BASIC_COMBAT_ABILITIES,
        llmAgentsEnabled: options.llmAgentsEnabled,
        abilityIdsByCombatant: options.started.ok ? options.started.abilityIdsByCombatant : {},
        policyByCombatant: options.started.ok ? options.started.policyByCombatant : {},
      });
      coordinator?.run();
    },
    run() {
      coordinator?.run();
    },
    submit(command) {
      return coordinator?.submit(command) ?? false;
    },
    runRetryAiTurns(options) {
      build({
        world: options.world,
        bridge: options.bridge,
        playerEntityId: options.playerEntityId,
        abilityCatalog: pin.abilityCatalog,
        llmAgentsEnabled: pin.llmAgentsEnabled,
        policyByCombatant: pin.policyByCombatant,
        ...(options.abilityIdsByCombatant === undefined
          ? {}
          : { abilityIdsByCombatant: options.abilityIdsByCombatant }),
      });
      if (coordinator === null) {
        runV2AiTurns(options);
        return;
      }
      coordinator.run();
    },
    cancel,
    coordinator() {
      return coordinator;
    },
  };
};
