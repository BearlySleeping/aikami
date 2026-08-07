// GENERATED FILE — do not edit by hand.
// Source: apps/backend/firebase/dataconnect/schema/schema.gql
// Regenerate with: bun run generate:dataconnect-schemas (apps/backend/firebase)
// or: bun moon run firebase:generate-dataconnect-schemas

// Row schema for the `Message` table (SQL Connect / Data Connect).
import Type from 'typebox';

export const MessageRowSchema = Type.Object({
  id: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  // Relation 'chat' → Chat is not part of the row schema; the FK column below stays.
  chatId: Type.String(),
  text: Type.String({ description: "Message content." }),
  sender: Type.Union([Type.Literal('USER'), Type.Literal('AI')]),
  editedAt: Type.Optional(Type.String({ format: 'date-time', description: "Edit tracking (editedBy only present when edited)." })),
  editedBy: Type.Optional(Type.Union([Type.Literal('USER'), Type.Literal('AI')])),
  regeneratedFrom: Type.Optional(Type.String({ description: "If this message was regenerated, points to the original message id. Deliberately NOT a @ref: it is an informational pointer and the referenced message may be deleted independently (regeneration chains) — a hard FK would cascade or block those deletions. Revisit only if referential integrity of regen" })),
  attachments: Type.Optional(Type.Unknown({ description: "Attachments. Shape validated by MessageSchema.attachments in packages/shared/schemas/src/lib/firestore/message.ts (Array of { type: 'image' | 'file', url, name?, mimeType?, size? })." })),
  metadata: Type.Optional(Type.Unknown({ description: "Arbitrary per-message metadata. Shape validated by MessageSchema.metadata in packages/shared/schemas/src/lib/firestore/message.ts (Record<string, Unknown>)." })),
});

export type MessageRowData = Type.Static<typeof MessageRowSchema>;
export type MessageRow = Type.Static<typeof MessageRowSchema>;