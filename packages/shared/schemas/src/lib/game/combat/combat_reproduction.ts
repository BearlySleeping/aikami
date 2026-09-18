// packages/shared/schemas/src/lib/game/combat/combat_reproduction.ts
//
// Portable reproduction bundle — the export/import artifact for the dev combat
// debugging workspace. It evolves `CombatReplay` (initialState + rulesVersion +
// commands) with scenario identity, content pins, run identity, the accepted
// command journal, named checkpoints, expected final hash, controller metadata
// and an explicit completeness flag.
//
// Why a separate schema from `CombatReplay`: a replay is the pure-kernel
// reconstruction result; a reproduction is what a player files as a bug. The
// reproduction carries diagnostic metadata (build revision, controller
// decisions, typed failures) that the kernel must never consume, and an
// explicit truncation status so a bounded trace cannot silently produce a
// bundle that looks complete. `initialState` + `commands` remain the sole
// mechanical authority — replay never reads controller metadata.
//
// Contract: combat debug workspace (execution prompt §8)

import Type, { type Static } from 'typebox';
import { CombatCommandSchema } from './combat_command';
import { CombatEventSchema } from './combat_event';
import { CombatReplaySchema } from './combat_replay';
import { CombatStateSchema } from './combat_state';

/**
 * Format version of {@link CombatReproductionSchema}. Bump on any breaking
 * shape change; importers reject versions they do not know.
 */
export const COMBAT_REPRODUCTION_VERSION = 1;

/** Maximum accepted export size in bytes before allocation/execution. */
export const COMBAT_REPRODUCTION_MAX_BYTES = 8 * 1024 * 1024;

/** Maximum accepted command count — bounds import work and file size. */
export const COMBAT_REPRODUCTION_MAX_COMMANDS = 20_000;

/** Maximum accepted checkpoint count. */
export const COMBAT_REPRODUCTION_MAX_CHECKPOINTS = 256;

/** Loose identifier used for scenario ids, pins and run identities. */
const IdentifierSchema = Type.String({ minLength: 1, maxLength: 256 });

/**
 * Non-mechanical controller/decision metadata. Recorded for inspection only;
 * import/replay must never feed these fields into the kernel.
 */
export const CombatReproductionControllerRecordSchema = Type.Object(
  {
    /** Command this record annotates, when it maps to one. */
    commandId: Type.Optional(Type.String({ maxLength: 256 })),
    /** Control owner at record time: 'player' | 'companion' | 'npc' | 'ai' | 'debugger'. */
    controlOwner: Type.String({ maxLength: 32 }),
    /** Typed failure code from the controller layer, when one occurred. */
    failureCode: Type.Optional(Type.String({ maxLength: 128 })),
    /** Whether a real provider was consulted (never in an exported default). */
    providerUsed: Type.Boolean(),
    /** Concise supplied rationale — never hidden chain-of-thought. */
    rationale: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);

export const CombatReproductionControllerRecord = CombatReproductionControllerRecordSchema;
export type CombatReproductionControllerRecord = Static<typeof CombatReproductionControllerRecordSchema>;

/** A named checkpoint the scenario declares it must reach. */
export const CombatReproductionCheckpointSchema = Type.Object(
  {
    name: IdentifierSchema,
    /** Revision at which the checkpoint is expected to hold. */
    stateRevision: Type.Integer({ minimum: 0 }),
    /** Index into `commands` up to and including which the checkpoint applies. */
    throughCommandIndex: Type.Integer({ minimum: -1 }),
  },
  { additionalProperties: false },
);

export type CombatReproductionCheckpoint = Static<typeof CombatReproductionCheckpointSchema>;

export const CombatReproductionSchema = Type.Object(
  {
    reproductionVersion: Type.Integer({ minimum: 1 }),
    rulesVersion: Type.String({ minLength: 1 }),
    scenarioId: IdentifierSchema,
    scenarioVersion: Type.Integer({ minimum: 1 }),
    /** Content pack id/version pins; omitted when the scenario is synthetic. */
    contentPackId: Type.Optional(IdentifierSchema),
    /** Source build/revision when available — diagnostic metadata only. */
    sourceRevision: Type.Optional(Type.String({ maxLength: 128 })),
    /** Recorded run identity; forks get a new one and record their ancestry. */
    encounterRunId: IdentifierSchema,
    /** Optional ancestry: the run this bundle was forked from. */
    forkedFromRunId: Type.Optional(IdentifierSchema),
    seed: Type.String({ maxLength: 128 }),
    recordedInitialState: CombatStateSchema,
    /** Accepted commands only, in commit order — the mechanical authority. */
    commands: Type.Array(CombatCommandSchema, { maxItems: COMBAT_REPRODUCTION_MAX_COMMANDS }),
    checkpoints: Type.Array(CombatReproductionCheckpointSchema, {
      maxItems: COMBAT_REPRODUCTION_MAX_CHECKPOINTS,
    }),
    /** Expected mechanical events for divergence comparison. */
    expectedEvents: Type.Array(CombatEventSchema, { maxItems: COMBAT_REPRODUCTION_MAX_COMMANDS }),
    /** Canonical hash of the expected final state, when fully recorded. */
    expectedFinalHash: Type.Optional(Type.String({ maxLength: 128 })),
    controllerRecords: Type.Array(CombatReproductionControllerRecordSchema, {
      maxItems: COMBAT_REPRODUCTION_MAX_COMMANDS,
    }),
    /**
     * False when the recorded command journal or expected events were dropped
     * or truncated. Importers must reject an incomplete bundle for replay.
     */
    complete: Type.Boolean(),
    /** Count of trace entries dropped by the bounded buffer, for diagnostics. */
    droppedTraceEntries: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type CombatReproduction = Static<typeof CombatReproductionSchema>;

/**
 * Result of replaying a reproduction through the production pure kernel.
 * Mirrors {@link ReplayCombatResultSchema} but keyed to the reproduction.
 */
export const CombatReproductionReplayResultSchema = Type.Object(
  {
    reproductionVersion: Type.Integer({ minimum: 1 }),
    scenarioId: IdentifierSchema,
    encounterRunId: IdentifierSchema,
    replay: CombatReplaySchema,
    finalState: Type.Union([CombatStateSchema, Type.Null()]),
    /** True when the replayed final hash matched `expectedFinalHash`. */
    matchedExpected: Type.Union([Type.Boolean(), Type.Null()]),
    /** First divergent command index, or null when none was observed. */
    divergence: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export type CombatReproductionReplayResult = Static<
  typeof CombatReproductionReplayResultSchema
>;
