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
  isActive: Type.Boolean({ description: "Hub one-active-persona flag. Atomicity is enforced by a partial unique index on (uid) WHERE is_active = true — see dataconnect/migrations/persona_one_active.sql. No client-side transaction exists in @firebase/data-connect@0.7.3." }),
  voiceConfigId: Type.Optional(Type.String({ description: "TTS voice configuration id (PersonaData.voiceConfigId parity)." })),
  traits: Type.Optional(Type.Unknown({ description: "Persona-specific character sheet (everything in PersonaSheetSchema EXCEPT `name`, which lives in the dedicated `name` column above — never duplicated inside traits). Shape validated by PersonaSheetSchema in packages/shared/schemas/src/lib/firestore/persona.ts (extends BaseCharacterSheetSchema in dat" })),
});

export type PersonaRowData = Type.Static<typeof PersonaRowSchema>;
export type PersonaRow = Type.Static<typeof PersonaRowSchema>;