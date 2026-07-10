// packages/shared/types/src/lib/bridge_tags.ts
//
// Types for the connected chats bridge tag parser and context injection.
// These are pure data transfer types — no runtime validation needed since
// they flow within the client process.
//
// Contract: C-244 Connected Chats Cross-Mode Bridge

/**
 * Result of parsing bridge tags from a message string.
 */
export type TagParseResult = {
  /** Cleaned message content with all bridge tags stripped. */
  cleanContent: string;
  /** Extracted `<note>` contents (durable). */
  notes: string[];
  /** Extracted `<influence>` contents (one-shot). */
  influences: string[];
  /** Extracted `<ooc>` contents (cross-post to linked OOC chat). */
  oocContents: string[];
};

/**
 * Bridge context injected into the GM prompt assembler.
 */
export type BridgeContext = {
  /** Durable notes from the linked OOC chat. */
  durableNotes: string[];
  /** One-shot influences for this turn (consumed after injection). */
  turnInfluences: string[];
  /** Recent game context (5-10 messages) from the game chat, sent to OOC. */
  recentGameContext: string;
};

/**
 * Metadata attached to cross-posted OOC messages.
 */
export type CrossPostMetadata = {
  /** Whether this message was cross-posted from a linked chat. */
  crossPosted: true;
  /** The ID of the source chat the message was cross-posted from. */
  sourceChatId: string;
};
