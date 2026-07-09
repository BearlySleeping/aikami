// apps/frontend/client/src/lib/types/lorebook.ts
//
// Client-local types for the Lorebook / World Info system (C-238).
// Lorebooks and entries are persisted in localStorage via ConfigService.

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** A named collection of world info entries. */
export type Lorebook = {
  /** Unique identifier (crypto.randomUUID()). */
  id: string;
  /** Human-readable name (e.g. "Forgotten Realms Lore"). */
  name: string;
  /** Optional description of the lorebook's purpose. */
  description: string;
  /** Ordered list of world info entries. */
  entries: LorebookEntry[];
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
};

/** A single world info entry with keywords, content, and metadata. */
export type LorebookEntry = {
  /** Unique identifier (crypto.randomUUID()). */
  id: string;
  /** Keywords that trigger this entry when matched in user input. */
  keywords: string[];
  /** The world info content injected into the prompt. */
  content: string;
  /** Higher priority entries are injected first and appear earlier. */
  priority: number;
  /** When true, this entry is always included regardless of keyword match. */
  constant: boolean;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
};

/** Result of scanning user input for matching lorebook entries. */
export type KeywordMatch = {
  /** The matched lorebook entry. */
  entry: LorebookEntry;
  /** Reason for inclusion: "constant" or "matched: '<keyword>'" */
  matchReason: string;
  /** The specific keyword that triggered the match, or undefined for constant entries. */
  matchedKeyword: string | undefined;
};

// ---------------------------------------------------------------------------
// AI generator input types (mirrors TypeBox schema in lorebook_generator)
// ---------------------------------------------------------------------------

/** Input type for AI-generated lorebook entries (before validation). */
export type LorebookEntryInput = {
  keywords: string[];
  content: string;
  priority?: number;
  constant?: boolean;
};

/** AI generator output: an array of validated lorebook entry inputs. */
export type LorebookEntriesArray = LorebookEntryInput[];
