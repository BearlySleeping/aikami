// apps/frontend/client/src/lib/services/lorebook/keyword_scanner.ts
//
// Pure function that scans user input text against lorebook entry keywords.
// Performs case-insensitive word-boundary matching, deduplicates matches,
// and sorts by priority. Constant entries are always included.

import type { KeywordMatch, LorebookEntry } from '$types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scans a user message for keyword matches against lorebook entries.
 *
 * - Each entry's keywords are tested against the message using
 *   case-insensitive word-boundary matching.
 * - Entries marked as `constant` are always included.
 * - Matches are deduplicated (one match per entry).
 * - Results are sorted by priority descending (highest first).
 *
 * @param options.entries - The lorebook entries to scan against.
 * @param options.message - The user input text to scan.
 * @returns Deduplicated, priority-sorted array of keyword matches.
 */
export const scanKeywords = (options: {
  entries: LorebookEntry[];
  message: string;
}): KeywordMatch[] => {
  const { entries, message } = options;

  const lowerMessage = message.toLowerCase();
  const matches: KeywordMatch[] = [];

  for (const entry of entries) {
    // Constant entries are always included
    if (entry.constant) {
      matches.push({
        entry,
        matchReason: 'constant',
        matchedKeyword: undefined,
      });
      continue;
    }

    // Test each keyword against the message with word-boundary matching
    const matchedKeyword = _findFirstMatch(entry.keywords, lowerMessage);
    if (matchedKeyword) {
      matches.push({
        entry,
        matchReason: `matched: '${matchedKeyword}'`,
        matchedKeyword,
      });
    }
  }

  // Deduplicate by entry ID (first match wins)
  const seen = new Set<string>();
  const deduped = matches.filter((m) => {
    if (seen.has(m.entry.id)) {
      return false;
    }
    seen.add(m.entry.id);
    return true;
  });

  // Sort by priority descending (highest first)
  deduped.sort((a, b) => b.entry.priority - a.entry.priority);

  return deduped;
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns the first keyword that matches the message using word-boundary matching.
 * Uses \b assertion so "gob" does NOT match "goblin", but "goblins" matches "goblin".
 *
 * @param keywords - List of keywords to test.
 * @param lowerMessage - The lowercased user message.
 * @returns The first matching keyword, or undefined if none match.
 */
const _findFirstMatch = (keywords: string[], lowerMessage: string): string | undefined => {
  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();
    // Escape special regex characters in the keyword
    const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Word-boundary before keyword, then either a word boundary after
    // (exact match) or 's'/'es' + word boundary (plural forms).
    const pattern = new RegExp(`\\b${escaped}(?:\\b|s\\b|es\\b)`, 'i');
    if (pattern.test(lowerMessage)) {
      return keyword;
    }
  }
  return undefined;
};
