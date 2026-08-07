// GENERATED FILE — do not edit by hand.
// Source: apps/backend/firebase/dataconnect/schema/schema.gql
// Regenerate with: bun run generate:dataconnect-schemas (apps/backend/firebase)
// or: bun moon run firebase:generate-dataconnect-schemas

// Row schema for the `Persona` table (SQL Connect / Data Connect).
import Type from 'typebox';

export const PersonaRowSchema = Type.Object({
  id: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  avatarUrl: Type.Optional(Type.String()),
  // Relation 'owner' → User is not part of the row schema; the FK column below stays.
  uid: Type.String(),
  traits: Type.Optional(Type.Unknown({ description: "Persona-specific character sheet. Shape validated by PersonaSheetSchema in packages/shared/schemas/src/lib/firestore/persona.ts (extends BaseCharacterSheetSchema in database/character.ts)." })),
});

export type PersonaRowData = Type.Static<typeof PersonaRowSchema>;
export type PersonaRow = Type.Static<typeof PersonaRowSchema>;