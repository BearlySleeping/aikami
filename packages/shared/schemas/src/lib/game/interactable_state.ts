// packages/shared/schemas/src/lib/game/interactable_state.ts
//
// TypeBox schemas for interactable runtime state persistence.
// Contract C-342: World interactables, dungeons, puzzles, and loot tables.
import Type, { type Static } from 'typebox';

// ── Interactable kind discriminator ─────────────────────────────────────

export const InteractableKindSchema = Type.Union([
  Type.Literal('npc'),
  Type.Literal('item'),
  Type.Literal('door'),
  Type.Literal('chest'),
  Type.Literal('lever'),
  Type.Literal('pressure_plate'),
  Type.Literal('container'),
  Type.Literal('readable'),
  Type.Literal('trap'),
]);

export type InteractableKind = Static<typeof InteractableKindSchema>;

// ── InteractableStateEntry — persisted per-spawnId state ─────────────────

export const InteractableStateEntrySchema = Type.Object(
  {
    isOpen: Type.Optional(
      Type.Boolean({ description: 'Whether the door/chest/container is open' }),
    ),
    isLocked: Type.Optional(Type.Boolean({ description: 'Whether the door/chest is locked' })),
    isLooted: Type.Optional(
      Type.Boolean({ description: 'Whether the chest/container has been looted' }),
    ),
    isToggled: Type.Optional(
      Type.Boolean({ description: 'Whether the lever/pressure-plate is toggled on' }),
    ),
    isTriggered: Type.Optional(
      Type.Boolean({ description: 'Whether the trap has been triggered' }),
    ),
  },
  {
    description: 'Persisted interactable state for a single spawn ID',
    additionalProperties: false,
  },
);

export type InteractableStateEntry = Static<typeof InteractableStateEntrySchema>;

// ── InteractableStatesMap — the full persistence map ────────────────────

export const InteractableStatesMapSchema = Type.Record(
  Type.String({ description: 'Spawn ID key' }),
  InteractableStateEntrySchema,
);

export type InteractableStatesMap = Static<typeof InteractableStatesMapSchema>;
