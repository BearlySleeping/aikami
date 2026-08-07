// GENERATED FILE — do not edit by hand.
// Source: apps/backend/firebase/dataconnect/schema/schema.gql
// Regenerate with: bun run generate:dataconnect-schemas (apps/backend/firebase)
// or: bun moon run firebase:generate-dataconnect-schemas

// Row schema for the `Notification` table (SQL Connect / Data Connect).
import Type from 'typebox';

export const NotificationRowSchema = Type.Object({
  id: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  // Relation 'user' → User is not part of the row schema; the FK column below stays.
  uid: Type.String(),
  type: Type.Union([Type.Literal('CHAT_MESSAGE'), Type.Literal('SYSTEM')], { description: "ND-1: enum values are the draft's own hint (\"chat_message\" | \"system\"); reconcile with the TypeBox NotificationTypeSchema before trusting." }),
  title: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
  isRead: Type.Optional(Type.Boolean({ description: "Whether the notification has been read." })),
  link: Type.Optional(Type.String({ description: "Optional link / deep-link target." })),
  data: Type.Optional(Type.Unknown({ description: "TODO: no TypeBox schema yet — needs one before this field is trustworthy. NotificationSchema in packages/shared/schemas/src/lib/firestore/ notification.ts models a different payload (ctaClicked/videoViewed marketing events), not this in-app notification payload." })),
});

export type NotificationRowData = Type.Static<typeof NotificationRowSchema>;
export type NotificationRow = Type.Static<typeof NotificationRowSchema>;