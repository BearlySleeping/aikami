// packages/shared/schemas/src/lib/game/game_operation.ts
//
// Durable game-operation record — the provenance + recovery unit behind the
// Chronicle (docs/design/game_ui_hud_overhaul.md §8, verification #9).
//
// A turn, check, image, or TTS generation writes exactly one operation row
// before its presentation begins and advances it to `completed`/`failed` from
// the authoritative result. A `pending` row that survives a restart is
// reconciled to `interrupted` — never silently rerolled or fabricated as
// complete. `request`/`result` are JSON-encoded payloads kept for audit; rules
// must never re-derive authority by parsing them.
//
// Contract: docs/design/game_ui_hud_overhaul.md — operation provenance

import Type from 'typebox';

/** Version stamped into every row so older clients can migrate/fallback. */
export const GAME_OPERATION_SCHEMA_VERSION = 1;

/** The kinds of operations the ledger tracks. */
export const GameOperationKindSchema = Type.Union([
  Type.Literal('dialogue_turn'),
  Type.Literal('skill_check'),
  Type.Literal('image_generation'),
  Type.Literal('tts_generation'),
]);

export type GameOperationKind = Type.Static<typeof GameOperationKindSchema>;

/**
 * Operation lifecycle. `interrupted` is assigned during boot reconciliation to
 * a `pending` row whose presentation/response never completed — distinct from
 * `failed` (a recorded error) and `completed` (an authoritative result).
 */
export const GameOperationStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('interrupted'),
]);

export type GameOperationStatus = Type.Static<typeof GameOperationStatusSchema>;

/**
 * One durable operation. All timestamps are ISO-8601. JSON payloads are opaque
 * strings; callers own their shape via the operation `kind`.
 */
export const GameOperationSchema = Type.Object(
  {
    schemaVersion: Type.Integer({ minimum: 1, description: 'Record schema version' }),
    operationId: Type.String({ minLength: 1, description: 'Stable operation identity (UUID)' }),
    kind: GameOperationKindSchema,
    status: GameOperationStatusSchema,
    /** Campaign the operation belongs to — required for recovery scoping. */
    campaignId: Type.String({ minLength: 1 }),
    /** Conversation/chat the operation belongs to, when applicable. */
    conversationId: Type.Optional(Type.String({ minLength: 1 })),
    /** Turn identity within the conversation, when applicable. */
    turnId: Type.Optional(Type.String({ minLength: 1 })),
    /** Check/dice identity, when the operation resolves a rules check. */
    checkId: Type.Optional(Type.String({ minLength: 1 })),
    /** Link to the committed narrative source event, when one is written. */
    sourceEventId: Type.Optional(Type.String({ minLength: 1 })),
    /** JSON-encoded request payload (audit only — never rules authority). */
    request: Type.String(),
    /** JSON-encoded authoritative result, present once completed. */
    result: Type.Optional(Type.String()),
    /** Human-readable failure/interruption reason, when applicable. */
    error: Type.Optional(Type.String()),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type GameOperation = Type.Static<typeof GameOperationSchema>;
