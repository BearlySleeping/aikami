// GENERATED FILE — do not edit by hand.
// Source: apps/backend/firebase/dataconnect/schema/schema.gql
// Regenerate with: bun run generate:dataconnect-schemas (apps/backend/firebase)
// or: bun moon run firebase:generate-dataconnect-schemas

// Row schema for the `Npc` table (SQL Connect / Data Connect).
import Type from 'typebox';

export const NpcRowSchema = Type.Object({
  id: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  avatarUrl: Type.Optional(Type.String()),
  personality: Type.Optional(Type.String()),
  systemPrompt: Type.Optional(Type.String()),
  // Relation 'owner' → User is not part of the row schema; the FK column below stays.
  uid: Type.Optional(Type.String()),
  visibility: Type.Union([Type.Literal('PRIVATE'), Type.Literal('PUBLIC')], { description: "Mirrors the `_visibilityUnion` TypeBox union (default 'private')." }),
  stats: Type.Optional(Type.Unknown({ description: "Character sheet (D&D abilities, skills, saving throws, narrative traits). Shape validated by NpcSheetSchema in packages/shared/schemas/src/lib/firestore/npc.ts (extends BaseCharacterSheetSchema in database/character.ts)." })),
  tags: Type.Optional(Type.Unknown({ description: "TODO: no TypeBox schema yet — needs one before this field is trustworthy. FEATURES.md does not define an NPC tags shape either." })),
});

export type NpcRowData = Type.Static<typeof NpcRowSchema>;
export type NpcRow = Type.Static<typeof NpcRowSchema>;