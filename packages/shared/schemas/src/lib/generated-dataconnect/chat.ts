// GENERATED FILE — do not edit by hand.
// Source: apps/backend/firebase/dataconnect/schema/schema.gql
// Regenerate with: bun run generate:dataconnect-schemas (apps/backend/firebase)
// or: bun moon run firebase:generate-dataconnect-schemas

// Row schema for the `Chat` table (SQL Connect / Data Connect).
import Type from 'typebox';

export const ChatRowSchema = Type.Object({
  id: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  // Relation 'owner' → User is not part of the row schema; the FK column below stays.
  uid: Type.String(),
  // Relation 'npc' → Npc is not part of the row schema; the FK column below stays.
  npcId: Type.Optional(Type.String()),
  npcName: Type.Optional(Type.String({ description: "Denormalised display snapshot of Npc.name / Npc.avatarUrl, kept on purpose: the chat list / chat header read pattern renders without a join to Npc and stays renderable after the NPC row is deleted (see ND-2). Trade-off: can drift from the Npc row — the sync layer must refresh on NPC metadata changes" })),
  npcAvatarUrl: Type.Optional(Type.String()),
  visibility: Type.Union([Type.Literal('PRIVATE'), Type.Literal('PUBLIC')], { description: "Mirrors the `_visibilityUnion` TypeBox union (default 'private')." }),
  messageCount: Type.Number({ description: "Aggregate counters (maintained by the sync layer / message writes)." }),
  affection: Type.Number(),
  lastMessageAt: Type.Optional(Type.String({ format: 'date-time', description: "Timestamp of the last message (drives the chat list ordering index above). Defaults to the row creation time so newly created chats always have a sortable value; explicit last-message updates still overwrite it when a chat receives messages." })),
  backgroundImageUrl: Type.Optional(Type.String({ description: "Background image URL." })),
  stats: Type.Optional(Type.Unknown({ description: "Simplified in-chat character sheet snapshot. Shape validated by ChatSchema.stats in packages/shared/schemas/src/lib/firestore/chat.ts ({ hp?, ac?, level?, class?, abilities? })." })),
});

export type ChatRowData = Type.Static<typeof ChatRowSchema>;
export type ChatRow = Type.Static<typeof ChatRowSchema>;