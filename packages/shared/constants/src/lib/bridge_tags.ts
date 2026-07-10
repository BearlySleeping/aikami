// packages/shared/constants/src/lib/bridge_tags.ts
//
// Constants for the connected chats bridge tag system.
// Tag names, character limits, and regex patterns for parsing.
//
// Contract: C-244 Connected Chats Cross-Mode Bridge

/**
 * Bridge tag names used in game chat messages.
 */
export const BRIDGE_TAG_NAMES = ['note', 'influence', 'ooc'] as const;

/** Durable note tag — persists across turns. */
export const NOTE_TAG = 'note';

/** One-shot influence tag — consumed after injection. */
export const INFLUENCE_TAG = 'influence';

/** Out-of-character cross-post tag — routes to linked OOC chat. */
export const OOC_TAG = 'ooc';

/**
 * Maximum character length for bridge context (notes + influences combined).
 * Exceeding this limit truncates with a warning.
 */
export const BRIDGE_CONTEXT_MAX_CHARS = 1000;

/**
 * Number of recent game chat messages to inject as context into OOC chat.
 */
export const OOC_GAME_CONTEXT_MESSAGE_COUNT = 5;

/**
 * Firestore collection path for ChatLink documents.
 * Subcollection path: chats/{gameChatId}/chatLinks/{linkId}
 */
export const CHAT_LINKS_COLLECTION = 'chatLinks';
