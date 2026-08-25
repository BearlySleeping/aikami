// apps/frontend/client/src/lib/services/character/character_book_mapper.ts
//
// Maps V2/V3 CharacterBookEntry onto the client-local LorebookEntry shape.
// Unmapped V2 fields are preserved verbatim in the entry's extensions bag.
//
// Priority decision (documented):
// When both `insertion_order` and `priority` are present on a spec entry,
// `insertion_order` wins as Aikami's `priority`. Rationale: the spec defines
// `insertion_order` as the canonical ordering field; `priority` in the spec
// has ambiguous semantics across frontends. This choice is tested explicitly.

import type { CharacterBook, CharacterBookEntry } from '@aikami/types';
import type { LorebookEntry } from '$types';

// ── Types ─────────────────────────────────────────────────────────────────

export type BookImportSummary = {
  /** Total entries in the source book. */
  total: number;
  /** Number of entries successfully mapped. */
  imported: number;
  /** Number of entries skipped (disabled, malformed, over bound). */
  skipped: number;
  /** Human-readable reason for skipped entries. */
  skippedReasons: string[];
};

export type NormalizedBook = {
  /** The lorebook name from the card, or a generated name. */
  name: string;
  /** The lorebook description from the card. */
  description: string;
  /** Mapped entries ready for the lorebook store. */
  entries: Omit<LorebookEntry, 'id' | 'createdAt' | 'updatedAt'>[];
  /** Import summary for the UI. */
  summary: BookImportSummary;
};

// ── Constants ─────────────────────────────────────────────────────────────

/** Hard limit on the number of entries that can be imported from a single book. */
const MAX_ENTRY_COUNT = 200;

/** Hard limit on the content length of a single entry (characters). */
const MAX_CONTENT_LENGTH = 10_000;

// ── Mapping ───────────────────────────────────────────────────────────────

/**
 * Maps a single CharacterBookEntry onto the Aikami LorebookEntry shape.
 *
 * Mapping rules:
 * - `keys` → `keywords` (direct)
 * - `content` → `content` (direct)
 * - `constant` → `constant` (defaults to `false` when absent)
 * - `insertion_order` → `priority` (wins over spec `priority` when both present)
 * - `enabled: false` → entry is skipped entirely
 * - All other fields → preserved verbatim in `extensions`
 */
const _mapEntry = (options: {
  entry: CharacterBookEntry;
}): Omit<LorebookEntry, 'id' | 'createdAt' | 'updatedAt'> | undefined => {
  const { entry } = options;

  // Skip disabled entries
  if (entry.enabled === false) {
    return undefined;
  }

  // Build extensions bag with all unmapped fields preserved verbatim
  const extensions: Record<string, unknown> = {};

  // Preserve spec fields that don't map directly to Aikami's LorebookEntry
  if (entry.case_sensitive !== undefined) {
    extensions.case_sensitive = entry.case_sensitive;
  }
  if (entry.name !== undefined) {
    extensions.name = entry.name;
  }
  if (entry.id !== undefined) {
    extensions.id = entry.id;
  }
  if (entry.comment !== undefined) {
    extensions.comment = entry.comment;
  }
  if (entry.selective !== undefined) {
    extensions.selective = entry.selective;
  }
  if (entry.secondary_keys !== undefined) {
    extensions.secondary_keys = entry.secondary_keys;
  }
  if (entry.position !== undefined) {
    extensions.position = entry.position;
  }
  if (entry.insertion_order !== undefined) {
    extensions.insertion_order = entry.insertion_order;
  }
  if (entry.priority !== undefined) {
    extensions.spec_priority = entry.priority;
  }

  // Preserve any vendor-specific extensions from the source
  if (entry.extensions && typeof entry.extensions === 'object') {
    for (const [key, value] of Object.entries(entry.extensions)) {
      extensions[key] = value;
    }
  }

  // Priority: insertion_order wins over spec priority
  const priority = entry.insertion_order ?? entry.priority ?? 0;

  return {
    keywords: entry.keys,
    content: entry.content,
    priority,
    constant: entry.constant === true,
    extensions: Object.keys(extensions).length > 0 ? extensions : undefined,
  };
};

/**
 * Normalizes a raw V2/V3 character_book into the internal NormalizedBook shape.
 * Validates bounds, maps entries, and produces an import summary.
 */
export const normalizeCharacterBook = (options: {
  book: CharacterBook;
  characterName: string;
}): NormalizedBook => {
  const { book, characterName } = options;

  const skippedReasons: string[] = [];
  const entries: Omit<LorebookEntry, 'id' | 'createdAt' | 'updatedAt'>[] = [];

  // Enforce entry count bound
  const entriesToProcess = book.entries.slice(0, MAX_ENTRY_COUNT);
  if (book.entries.length > MAX_ENTRY_COUNT) {
    skippedReasons.push(
      `Entry count (${book.entries.length}) exceeds the maximum (${MAX_ENTRY_COUNT}). Only the first ${MAX_ENTRY_COUNT} entries were imported.`,
    );
  }

  for (const specEntry of entriesToProcess) {
    // Validate content length
    if (specEntry.content && specEntry.content.length > MAX_CONTENT_LENGTH) {
      skippedReasons.push(
        `Entry "${specEntry.name || '(unnamed)'}" content (${specEntry.content.length} chars) exceeds the maximum (${MAX_CONTENT_LENGTH}). It was skipped.`,
      );
      continue;
    }

    // Ensure content is a string
    if (typeof specEntry.content !== 'string') {
      skippedReasons.push(`Entry "${specEntry.name || '(unnamed)'}" has non-string content and was skipped.`);
      continue;
    }

    const mapped = _mapEntry({ entry: specEntry });
    if (mapped === undefined) {
      // Entry was disabled
      skippedReasons.push(
        `Entry "${specEntry.name || '(unnamed)'}" was disabled in the original card and was not imported.`,
      );
      continue;
    }

    entries.push(mapped);
  }

  const total = book.entries.length;
  const imported = entries.length;
  const skipped = total - imported;

  return {
    name: book.name || `${characterName}'s Lorebook`,
    description: book.description || `Lorebook imported from character card: ${characterName}`,
    entries,
    summary: { total, imported, skipped, skippedReasons },
  };
};
