// apps/frontend/client/src/lib/services/export/formatters/jsonl_formatter.ts
//
// JSONL chat export formatter (AC-1).
// Converts chat messages into a JSONL string — one JSON object per line,
// no trailing newline for the last line.

import type { JsonlMessageLine } from '@aikami/types';

/**
 * Normalized message input for all export formatters.
 * Abstracts away Firestore-specific types (Timestamps, metadata blobs).
 */
export type ExportMessage = {
  /** Message text content. */
  text: string;
  /** Sender role. */
  sender: 'user' | 'ai';
  /** ISO-8601 timestamp string. */
  timestamp: string;
  /** Whether this message was edited. */
  edited: boolean;
  /** Branch/swipe ID if this is an alternate. */
  branchId?: string;
  /** Dice roll metadata extracted from the message. */
  diceRolls?: Array<{
    notation: string;
    result: number;
    details: string;
  }>;
  /** Attachments. */
  attachments?: Array<{
    type: 'image' | 'file';
    url: string;
    name?: string;
  }>;
};

/**
 * Export chat metadata passed alongside messages.
 */
export type ExportChatMetadata = {
  /** Name of the NPC this chat is with. */
  npcName: string;
  /** ISO-8601 timestamp of export. */
  exportedAt: string;
  /** ISO-8601 timestamp of the chat's last activity. */
  lastMessageAt?: string;
};

/**
 * Converts a single export message to a {@link JsonlMessageLine}.
 */
const _messageToLine = (options: { message: ExportMessage; index: number }): JsonlMessageLine => {
  const { message, index } = options;
  return {
    index,
    timestamp: message.timestamp,
    role: message.sender,
    content: message.text,
    edited: message.edited,
    ...(message.branchId && { branchId: message.branchId }),
    ...(message.diceRolls?.length && { diceRolls: message.diceRolls }),
    ...(message.attachments?.length && { attachments: message.attachments }),
  };
};

/**
 * Converts an array of export messages to a JSONL string.
 * Each line is a valid JSON object. No top-level array wrapper.
 *
 * @returns The JSONL string, or an empty string if there are no messages.
 */
export const messagesToJsonl = (options: { messages: ExportMessage[] }): string => {
  const { messages } = options;

  if (messages.length === 0) {
    return '';
  }

  return messages
    .map((message, index) => JSON.stringify(_messageToLine({ message, index })))
    .join('\n');
};
