// packages/shared/schemas/src/lib/game/combat/combat_reaction.ts
//
// Combat-08 reaction wire contract: the serializable command continuation, the
// opportunity-attack reaction window, and the registered reaction definition.
//
// A reaction suspends an in-flight command rather than making the whole path
// atomic. The suspension is carried as an explicit *committed prefix plus a
// continuation* so a save taken mid-window restores the same remaining path,
// the same spent budgets, and the same already-recorded RNG outcomes. No
// closure is ever serialized.
//
// Contract: C-532 AC-3, AC-6

import Type, { type Static } from 'typebox';
import { GridPointSchema } from './combat_grid';
import type { ReactionPolicy } from './combat_participation';

/** Hard caps for the reaction vocabulary. */
export const COMBAT_REACTION_BOUNDS = {
  idChars: 96,
  /** Maximum path cells a continuation may carry. */
  pathCells: 128,
  /** Maximum eligible reactors queued on one window. */
  reactors: 16,
  /** Maximum simultaneously open windows (nesting is capped at one). */
  openWindows: 8,
  /** Maximum already-resolved window ids recorded on one continuation. */
  resolvedWindows: 32,
  /** Highest legal window version (guards unbounded version growth). */
  maxVersion: 1_000_000,
} as const;

const BoundedIdSchema = Type.String({ minLength: 1, maxLength: COMBAT_REACTION_BOUNDS.idChars });

// ---------------------------------------------------------------------------
// Registered reaction definitions
// ---------------------------------------------------------------------------

/** Reaction triggers supported in this release. Exactly one ships. */
export const ReactionTriggerKindSchema = Type.Union([Type.Literal('opportunity_attack')]);

export type ReactionTriggerKind = Static<typeof ReactionTriggerKindSchema>;

/**
 * A registered reaction: a closed, declarative definition. The reaction is
 * resolved through the ordinary ability/targeting rules named by `abilityId`
 * — there is no reaction-specific attack implementation.
 */
export const RegisteredReactionDefinitionSchema = Type.Object(
  {
    reactionId: BoundedIdSchema,
    triggerKind: ReactionTriggerKindSchema,
    /** Ability the reactor uses when it accepts. Must be in its catalog. */
    abilityId: BoundedIdSchema,
    /** Melee threat range, in cells, that the mover must leave. */
    threatRangeCells: Type.Integer({ minimum: 1, maximum: 8 }),
  },
  { additionalProperties: false },
);

export type RegisteredReactionDefinition = Static<typeof RegisteredReactionDefinitionSchema>;

/** The pinned reaction registry for one encounter. */
export const ReactionRegistrySchema = Type.Object(
  {
    definitions: Type.Array(RegisteredReactionDefinitionSchema, { maxItems: 8 }),
  },
  { additionalProperties: false },
);

export type ReactionRegistry = Static<typeof ReactionRegistrySchema>;

export const emptyReactionRegistry = (): ReactionRegistry => ({ definitions: [] });

// ---------------------------------------------------------------------------
// Serializable continuation
// ---------------------------------------------------------------------------

/**
 * The resumable remainder of a command suspended by a reaction.
 *
 * `committedCells` is the prefix already applied to the mover's position and
 * already charged against its movement budget. `remainingPath` excludes the
 * mover's current cell. Replay never re-charges `committedCells` and never
 * re-rolls an attack already recorded in the event log.
 */
export const SerializableCommandContinuationSchema = Type.Object(
  {
    continuationId: BoundedIdSchema,
    /** The command this continuation belongs to. */
    initiatingCommandId: BoundedIdSchema,
    /** Only `move` can be suspended in this release. */
    commandKind: Type.Literal('move'),
    combatantId: BoundedIdSchema,
    /** Cells already committed, in traversal order (may be empty). */
    committedCells: Type.Array(GridPointSchema, {
      maxItems: COMBAT_REACTION_BOUNDS.pathCells,
    }),
    /** Cells still to commit, excluding the mover's current cell. */
    remainingPath: Type.Array(GridPointSchema, {
      maxItems: COMBAT_REACTION_BOUNDS.pathCells,
    }),
    /** Movement cells already charged for the committed prefix. */
    spentMovement: Type.Integer({ minimum: 0 }),
    /** Window ids already resolved for this command, in resolution order. */
    resolvedWindowIds: Type.Array(BoundedIdSchema, {
      maxItems: COMBAT_REACTION_BOUNDS.resolvedWindows,
    }),
    /**
     * Reactor ids already offered a window for this command, in resolution
     * order. A reactor is offered at most one opportunity per suspended
     * command, so declining the trigger for one cell does not re-offer the
     * same exit at the next cell.
     */
    resolvedReactorIds: Type.Array(BoundedIdSchema, {
      maxItems: COMBAT_REACTION_BOUNDS.reactors,
    }),
    /** The window this continuation is currently suspended in, if any. */
    pendingWindowId: Type.Union([BoundedIdSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export type SerializableCommandContinuation = Static<typeof SerializableCommandContinuationSchema>;

// ---------------------------------------------------------------------------
// Reaction windows
// ---------------------------------------------------------------------------

export const ReactionWindowStatusSchema = Type.Union([
  Type.Literal('open'),
  Type.Literal('resolved'),
  Type.Literal('invalidated'),
]);

export type ReactionWindowStatus = Static<typeof ReactionWindowStatusSchema>;

/**
 * One open reaction window.
 *
 * `version` increments on every state mutation that changes the window, so a
 * duplicate or stale `COMBAT_REACTION_SELECTED` request can be rejected
 * without consuming a reaction or advancing RNG.
 */
export const ReactionWindowSchema = Type.Object(
  {
    windowId: BoundedIdSchema,
    version: Type.Integer({ minimum: 1, maximum: COMBAT_REACTION_BOUNDS.maxVersion }),
    status: ReactionWindowStatusSchema,
    /** The command whose movement triggered the window. */
    initiatingCommandId: BoundedIdSchema,
    /** The combatant whose movement opened the window. */
    moverId: BoundedIdSchema,
    /** Registered reaction being offered. */
    reactionId: BoundedIdSchema,
    /** Eligible reactors, ordered by initiative desc then stable id asc. */
    reactorQueue: Type.Array(BoundedIdSchema, {
      maxItems: COMBAT_REACTION_BOUNDS.reactors,
    }),
    /** The reactor currently deciding, or `null` when the queue is drained. */
    currentReactorId: Type.Union([BoundedIdSchema, Type.Null()]),
    /** The cell the mover is attempting to enter (the trigger cell). */
    triggerCell: GridPointSchema,
    /** The resumable remainder of the suspended command. */
    continuation: SerializableCommandContinuationSchema,
  },
  { additionalProperties: false },
);

export type ReactionWindow = Static<typeof ReactionWindowSchema>;

/** Reaction state carried on `CombatState`. */
export const ReactionStateSchema = Type.Object(
  {
    windows: Type.Array(ReactionWindowSchema, {
      maxItems: COMBAT_REACTION_BOUNDS.openWindows,
    }),
  },
  { additionalProperties: false },
);

export type ReactionState = Static<typeof ReactionStateSchema>;

export const emptyReactionState = (): ReactionState => ({ windows: [] });

// ---------------------------------------------------------------------------
// Reaction input
// ---------------------------------------------------------------------------

/** A player/AI choice for one reaction window. */
export const ReactionChoiceSchema = Type.Union([Type.Literal('accept'), Type.Literal('decline')]);

export type ReactionChoice = Static<typeof ReactionChoiceSchema>;

/**
 * A reaction selection request. The worker revalidates window identity,
 * version, encounter-run identity and actor identity before resolving; a stale
 * or duplicate request consumes neither a reaction nor RNG.
 */
export const ReactionSelectionRequestSchema = Type.Object(
  {
    encounterRunId: BoundedIdSchema,
    windowId: BoundedIdSchema,
    windowVersion: Type.Integer({ minimum: 1, maximum: COMBAT_REACTION_BOUNDS.maxVersion }),
    reactorId: BoundedIdSchema,
    choice: ReactionChoiceSchema,
  },
  { additionalProperties: false },
);

export type ReactionSelectionRequest = Static<typeof ReactionSelectionRequestSchema>;

/**
 * How a choice came to exist. `player` and `ai_policy` are external inputs;
 * `timeout` records an optional player-enabled timer expiry as an external
 * input, never as a provider timeout.
 */
export const ReactionChoiceSourceSchema = Type.Union([
  Type.Literal('player'),
  Type.Literal('ai_policy'),
  Type.Literal('timeout'),
]);

export type ReactionChoiceSource = Static<typeof ReactionChoiceSourceSchema>;

/** Default reaction policy when none is authored. */
export const DEFAULT_REACTION_POLICY: ReactionPolicy = 'ask';
