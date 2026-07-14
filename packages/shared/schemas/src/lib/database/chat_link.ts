// packages/shared/schemas/src/lib/database/chat_link.ts
//
// ChatLink schema — connects an OOC Conversation-mode chat (source) to a
// Game-mode chat (target) for asymmetric bridge injection. Persisted as a
// Firestore document.
//
// Contract: C-244 Connected Chats Cross-Mode Bridge

import Type, { type Static } from 'typebox';

/**
 * ChatLink document stored in Firestore.
 *
 * Links an OOC/Conversation chat (source) to a Game chat (target).
 * Notes are durable and injected into every game turn. Influences are
 * one-shot — consumed after injection.
 */
export const ChatLinkSchema = Type.Object({
  /** Unique link identifier (also the Firestore document ID). */
  linkId: Type.String(),
  /** The "source" chat ID — an OOC / Conversation-mode chat. */
  sourceChatId: Type.String(),
  /** The "target" chat ID — a Game / Roleplay-mode chat. */
  targetChatId: Type.String(),
  /** Durable notes injected into every target turn. */
  notes: Type.Array(Type.String()),
  /** Pending one-shot influence tags — consumed after injection. */
  pendingInfluences: Type.Array(Type.String()),
  /** Whether this link is currently active. */
  isActive: Type.Boolean(),
  /** Timestamp when the link was created (milliseconds since epoch). */
  createdAt: Type.Number(),
  /** Timestamp of the last note or influence update. */
  updatedAt: Type.Number(),
  /** Optimistic concurrency version field for Firestore transactions. */
  version: Type.Optional(Type.Number()),
});

export type ChatLink = Static<typeof ChatLinkSchema>;

/**
 * Partial update payload for ChatLink documents.
 */
export const ChatLinkUpdateSchema = Type.Partial(
  Type.Omit(ChatLinkSchema, ['linkId', 'createdAt']),
);

export type ChatLinkUpdate = Static<typeof ChatLinkUpdateSchema>;
