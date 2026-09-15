// packages/frontend/engine/src/combat/combat_bridge_commands.ts
//
// Combat bridge-command registration for `GameWorld`.
//
// Extracted from `game_world.ts`, which is on the source-file-size guard's
// grandfathered baseline. Behaviour is identical — the same commands are
// registered with the same handlers, only the declaration site moved.
//
// Contract: C-145, C-514 AC-4, C-515 AC-5, C-516 AC-2

import type { GameCommand } from '../types.ts';
import type {
  CombatAiDecisionSubmittedCommand,
  CombatLanguageIntentSubmittedCommand,
  CombatPreviewRequestedCommand,
  CombatReactionSelectedCommand,
  CombatStartEncounterCommand,
} from './combat_bridge_types.ts';

/** Registrar matching `GameWorld._registerBridgeCommand`. */
export type BridgeCommandRegistrar = <T extends GameCommand['type']>(
  type: T,
  handler: (command: Extract<GameCommand, { type: T }>) => void,
) => void;

/**
 * The combat commands forwarded to the ECS worker.
 *
 * `EngineBridge.send` DROPS a command whose type has no registered handler, so
 * every combat command the client can send must appear here — an unregistered
 * type is silently lost on the main thread.
 */
export type ForwardedCombatCommand = Extract<
  GameCommand,
  {
    type:
      | 'COMBAT_ACTION'
      | 'COMBAT_AI_DECISION_SUBMITTED'
      | 'COMBAT_END_TURN'
      | 'COMBAT_INTERACT'
      | 'COMBAT_LANGUAGE_INTENT_SUBMITTED'
      | 'COMBAT_MOVE'
      | 'COMBAT_PREVIEW_REQUESTED'
      | 'COMBAT_REACTION_SELECTED'
      | 'COMBAT_START_ENCOUNTER'
      | 'COMBAT_STATE_SNAPSHOT_REQUESTED'
      | 'COMBAT_SYNC_REQUEST'
      | 'WORLD_OBJECTS_REQUESTED'
      | 'WORLD_OBJECTS_RESTORED';
  }
>;

/** Posts a command envelope to the worker. */
export type BridgeCommandPoster = (command: ForwardedCombatCommand) => void;

/**
 * The exact wire envelope posted to the worker for a preview request.
 *
 * Extracted so the forwarded shape is a pure, directly testable value instead
 * of an inline object literal inside the registrar callback.
 */
export const toCombatPreviewEnvelope = (
  command: CombatPreviewRequestedCommand,
): CombatPreviewRequestedCommand => ({
  type: 'COMBAT_PREVIEW_REQUESTED',
  requestId: command.requestId,
  encounterId: command.encounterId,
  basedOnRevision: command.basedOnRevision,
  query: command.query,
});

/**
 * The exact wire envelope posted to the worker for an encounter start.
 *
 * Extracted for the same reason as the preview envelope: the forwarded shape is
 * a pure value a test can assert, and the authored roster travels with it.
 */
export const toCombatStartEncounterEnvelope = (
  command: CombatStartEncounterCommand,
): CombatStartEncounterCommand => ({
  type: 'COMBAT_START_ENCOUNTER',
  encounterId: command.encounterId,
  seed: command.seed,
  ...(command.engine === undefined ? {} : { engine: command.engine }),
  ...(command.roster === undefined ? {} : { roster: command.roster }),
  ...(command.llmAgentsEnabled === undefined ? {} : { llmAgentsEnabled: command.llmAgentsEnabled }),
});

/**
 * The exact wire envelope posted to the worker for an AI decision submission
 * (C-526 AC-5).
 *
 * Extracted for the same reason as the other envelopes: the forwarded shape is
 * a pure value a test can assert, and the decision travels verbatim.
 */
export const toCombatAiDecisionSubmissionEnvelope = (
  command: CombatAiDecisionSubmittedCommand,
): CombatAiDecisionSubmittedCommand => ({
  type: 'COMBAT_AI_DECISION_SUBMITTED',
  requestId: command.requestId,
  encounterId: command.encounterId,
  combatantId: command.combatantId,
  stateRevision: command.stateRevision,
  decision: command.decision,
});

/**
 * The exact wire envelope posted to the worker for a language submission.
 *
 * Extracted so the forwarded shape is a pure, directly testable value.
 */
export const toCombatLanguageIntentEnvelope = (
  command: CombatLanguageIntentSubmittedCommand,
): CombatLanguageIntentSubmittedCommand => ({
  type: 'COMBAT_LANGUAGE_INTENT_SUBMITTED',
  requestId: command.requestId,
  encounterId: command.encounterId,
  basedOnRevision: command.basedOnRevision,
  text: command.text,
  ...(command.context === undefined ? {} : { context: command.context }),
});

/**
 * The exact wire envelope posted to the worker for a reaction selection
 * (C-532 AC-3).
 *
 * Extracted for the same reason as the other envelopes: the forwarded shape is
 * a pure value a test can assert, and window identity, version and encounter-run
 * identity travel verbatim so the kernel can reject a duplicate or stale choice
 * before spending a reaction or RNG.
 */
export const toCombatReactionSelectedEnvelope = (
  command: CombatReactionSelectedCommand,
): CombatReactionSelectedCommand => ({
  type: 'COMBAT_REACTION_SELECTED',
  encounterId: command.encounterId,
  encounterRunId: command.encounterRunId,
  windowId: command.windowId,
  windowVersion: command.windowVersion,
  reactorId: command.reactorId,
  choice: command.choice,
  source: command.source,
  basedOnRevision: command.basedOnRevision,
});

/**
 * Registers the combat bridge commands. `COMBAT_END_TURN` carries no payload —
 * the worker validates turn ownership before advancing (C-514 AC-4).
 */
export const registerCombatBridgeCommands = (options: {
  register: BridgeCommandRegistrar;
  post: BridgeCommandPoster;
}): void => {
  const { register, post } = options;

  // Forward COMBAT_ACTION commands (C-145). `abilityId` MUST travel with the
  // command: the v2 resolver maps an ABILITY action to that catalog entry, and
  // dropping it would reject every ability as `invalidCommandShape`.
  register('COMBAT_ACTION', (cmd) => {
    post({
      type: 'COMBAT_ACTION',
      action: cmd.action,
      ...(cmd.abilityId === undefined ? {} : { abilityId: cmd.abilityId }),
      ...(cmd.targetId === undefined ? {} : { targetId: cmd.targetId }),
    });
  });

  // Forward COMBAT_END_TURN commands (C-514 AC-4)
  register('COMBAT_END_TURN', () => {
    post({ type: 'COMBAT_END_TURN' });
  });

  // Forward COMBAT_PREVIEW_REQUESTED commands (C-515 AC-5). The worker answers
  // with exactly one correlated COMBAT_PREVIEW_READY / COMBAT_PLAN_REJECTED.
  register('COMBAT_PREVIEW_REQUESTED', (cmd) => {
    post(toCombatPreviewEnvelope(cmd));
  });

  // Forward the player's natural-language instruction (C-525 AC-4). The engine
  // acknowledges with COMBAT_DECISION_PENDING; interpretation stays on the
  // client, so no frame ever waits on a model.
  register('COMBAT_LANGUAGE_INTENT_SUBMITTED', (cmd) => {
    post(toCombatLanguageIntentEnvelope(cmd));
  });

  // Forward a budgeted v2 move to a destination cell (C-516 AC-8). The engine
  // reconstructs the path, so only the cell travels.
  register('COMBAT_MOVE', (cmd) => {
    post({ type: 'COMBAT_MOVE', cellX: cmd.cellX, cellY: cmd.cellY });
  });

  // Forward the encounter start to the ECS worker (C-516 AC-2). Without this
  // registration `EngineBridge.send` drops the command on the main thread and
  // the worker's `COMBAT_START_ENCOUNTER` handler is unreachable at runtime.
  register('COMBAT_START_ENCOUNTER', (cmd) => {
    post(toCombatStartEncounterEnvelope(cmd));
  });

  // Forward the decision for one open reaction window to the worker (C-532
  // AC-3). Without this registration `EngineBridge.send` drops the choice on
  // the main thread, the kernel stays suspended in phase 'reaction', and the
  // encounter never resumes.
  register('COMBAT_REACTION_SELECTED', (cmd) => {
    post(toCombatReactionSelectedEnvelope(cmd));
  });

  // Forward an authored-object interaction to the worker (C-531 AC-2). Without
  // this registration `EngineBridge.send` drops the command on the main thread.
  register('COMBAT_INTERACT', (cmd) => {
    post({
      type: 'COMBAT_INTERACT',
      objectId: cmd.objectId,
      affordanceId: cmd.affordanceId,
      targetObjectId: cmd.targetObjectId ?? null,
    });
  });

  // Forward the world-object round trip (C-531 AC-7). Without these
  // registrations `EngineBridge.send` drops the command on the main thread.
  register('WORLD_OBJECTS_REQUESTED', (cmd) => {
    post({ type: 'WORLD_OBJECTS_REQUESTED', requestId: cmd.requestId });
  });
  register('WORLD_OBJECTS_RESTORED', (cmd) => {
    post({ type: 'WORLD_OBJECTS_RESTORED', worldObjects: cmd.worldObjects });
  });

  // Re-emit the live combat state to a freshly mounted ViewModel (C-516 AC-5).
  register('COMBAT_SYNC_REQUEST', () => {
    post({ type: 'COMBAT_SYNC_REQUEST' });
  });

  // Answer with the live v2 kernel state so the client can ground a compiled
  // intent locally (C-525 AC-4).
  register('COMBAT_STATE_SNAPSHOT_REQUESTED', (cmd) => {
    post({
      type: 'COMBAT_STATE_SNAPSHOT_REQUESTED',
      requestId: cmd.requestId,
      encounterId: cmd.encounterId,
    });
  });

  // Answer the engine's AI decision request (C-526 AC-5). Without this
  // registration `EngineBridge.send` would drop the submission on the main
  // thread and every deferred AI turn would have to wait out the hard deadline.
  register('COMBAT_AI_DECISION_SUBMITTED', (cmd) => {
    post(toCombatAiDecisionSubmissionEnvelope(cmd));
  });
};
