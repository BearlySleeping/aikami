// GENERATED FILE — do not edit by hand.
// Source: apps/backend/firebase/dataconnect/schema/schema.gql
// Regenerate with: bun run generate:dataconnect-schemas (apps/backend/firebase)
// or: bun moon run firebase:generate-dataconnect-schemas

// Row schema for the `Config` table (SQL Connect / Data Connect).
import Type from 'typebox';

export const ConfigRowSchema = Type.Object({
  id: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  key: Type.String({ description: "Configuration key. Unique — two rows sharing a key would be a bug." }),
  value: Type.Optional(Type.Unknown({ description: "TODO: no TypeBox schema governs this generic key→value shape. ConfigSchema in packages/shared/schemas/src/lib/firestore/config.ts models a fixed per-user settings object and does NOT match an arbitrary value." })),
});

export type ConfigRowData = Type.Static<typeof ConfigRowSchema>;
export type ConfigRow = Type.Static<typeof ConfigRowSchema>;