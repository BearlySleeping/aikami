// packages/shared/types/src/lib/export.ts
//
// Types for the export/import system (C-246). These are fully cross-boundary
// — consumed by the export service, formatters, character importer, and
// settings UI. Derived from @aikami/schemas where schemas exist.

import type { CHARACTER_CARD_TYPES, EXPORT_FORMAT_VERSION } from '@aikami/constants';
import type { BaseCharacterSheet } from '@aikami/schemas';

/**
 * A single message line in a JSONL chat export.
 * One JSON object per line — no top-level array wrapper.
 */
export type JsonlMessageLine = {
  /** Message index in the chat (0-based). */
  index: number;
  /** ISO-8601 timestamp of the message. */
  timestamp: string;
  /** Sender role: 'user' | 'ai'. */
  role: 'user' | 'ai';
  /** The message text content. */
  content: string;
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
  /** Attachments (images, files). */
  attachments?: Array<{
    type: 'image' | 'file';
    url: string;
    name?: string;
  }>;
};

/**
 * Aikami character card — the `.aikami.json` export format.
 * Wraps a full BaseCharacterSheet with versioning and portability metadata.
 */
export type AikamiCharacterCard = {
  /** Format version for forward compatibility. */
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  /** Type discriminator. */
  type: (typeof CHARACTER_CARD_TYPES)[number];
  /** Full character sheet from the TypeBox schema. */
  character: BaseCharacterSheet;
  /** Avatar URL for re-download. */
  avatarUrl?: string;
  /** Embedded avatar as base64 data URI (optional, for offline portability). */
  avatarBase64?: string;
  /** ISO-8601 timestamp of export. */
  exportedAt: string;
  /** App version that generated this export. */
  appVersion: string;
};

/**
 * Manifest file inside a bulk backup zip.
 * Describes the contents and provides a file listing.
 */
export type BackupManifest = {
  /** Format version. */
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  /** ISO-8601 timestamp of backup creation. */
  createdAt: string;
  /** App version. */
  appVersion: string;
  /** Number of chats included. */
  chatCount: number;
  /** Number of characters included. */
  characterCount: number;
  /** Total message count across all chats. */
  totalMessages: number;
  /** Relative file listing inside the zip. */
  files: string[];
};
