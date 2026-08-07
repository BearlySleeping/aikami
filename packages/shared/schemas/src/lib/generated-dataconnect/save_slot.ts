// GENERATED FILE — do not edit by hand.
// Source: apps/backend/firebase/dataconnect/schema/schema.gql
// Regenerate with: bun run generate:dataconnect-schemas (apps/backend/firebase)
// or: bun moon run firebase:generate-dataconnect-schemas

// Row schema for the `SaveSlot` table (SQL Connect / Data Connect).
import Type from 'typebox';

export const SaveSlotRowSchema = Type.Object({
  id: Type.String(),
  // Relation 'user' → User is not part of the row schema; the FK column below stays.
  uid: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  slotNumber: Type.Number({ description: "Slot number (1-based; values >= 1 only). Composite @unique(uid, slotNumber) above enforces one slot per number per user. Connector-layer validation and the TypeBox schema must enforce the same lower bound (min: 1)." }),
  lastLocationName: Type.Optional(Type.String({ description: "Human-readable location name for the save thumbnail." })),
  playedTimeSeconds: Type.Optional(Type.Number({ description: "Accumulated play time in seconds." })),
  storageRef: Type.String({ description: "Firebase Cloud Storage path to the ECS snapshot blob." }),
});

export type SaveSlotRowData = Type.Static<typeof SaveSlotRowSchema>;
export type SaveSlotRow = Type.Static<typeof SaveSlotRowSchema>;