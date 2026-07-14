// packages/frontend/engine/src/tag_parser.ts
//
// Bridge tag parser — scans message text for XML-style bridge tags
// (<note>, <influence>, <ooc>), extracts content, and returns cleaned
// text plus structured tag payloads.
//
// Contract: C-244 Connected Chats Cross-Mode Bridge

import type { TagParseResult } from '@aikami/types';

/** Regex matching an opening bridge tag: <note>, <influence>, or <ooc> */
const TAG_OPEN_RE = /<(note|influence|ooc)>/i;

/**
 * All bridge tag names in canonical lowercase.
 */
const TAG_NAMES: readonly string[] = ['note', 'influence', 'ooc'];

/**
 * Parses bridge tags from a message string.
 *
 * Handles the three tag types:
 * - `<note>`: Durable — content is persisted and injected every turn.
 * - `<influence>`: One-shot — consumed after a single injection.
 * - `<ooc>`: Cross-post — content is routed to the linked OOC chat.
 *
 * Edge cases:
 * - Malformed tags (missing closing tag) → treat rest of message as tag content.
 * - Nested tags → extract only the outer tag; discard inner.
 * - Multi-line tags → extraction continues across newlines.
 * - Empty tags → extract empty string (no-op for notes/influences, ignored for OOC).
 * - Tags at very end without content → ignored.
 *
 * @param input — The raw message text to parse.
 * @returns Structured parse result with clean content and extracted tag payloads.
 */
export const parseBridgeTags = (input: string): TagParseResult => {
  const notes: string[] = [];
  const influences: string[] = [];
  const oocContents: string[] = [];

  // Track which positions in the output string map to which ranges
  // in the input. We build a list of [start, end] spans to strip.
  const strips: Array<{ start: number; end: number }> = [];

  let pos = 0;
  const { length } = input;

  while (pos < length) {
    // Find the next opening tag
    const openMatch = input.slice(pos).match(TAG_OPEN_RE);
    if (!openMatch || openMatch.index === undefined) {
      // No more tags — consume the rest
      break;
    }

    const tagStart = pos + openMatch.index;
    const tagName = openMatch[1].toLowerCase();
    const contentStart = tagStart + openMatch[0].length;

    // Only handle recognized bridge tags
    const tagIdx = TAG_NAMES.indexOf(tagName);
    if (tagIdx === -1) {
      // Unknown tag — skip past it and continue
      pos = contentStart;
      continue;
    }

    // Look for matching closing tag
    const closePattern = new RegExp(`</${tagName}>`, 'i');
    const remainder = input.slice(contentStart);
    const closeMatch = remainder.match(closePattern);

    if (closeMatch && closeMatch.index !== undefined) {
      // Fully formed — extract content between tags
      const content = remainder.slice(0, closeMatch.index);
      const tagEnd = contentStart + closeMatch.index + closeMatch[0].length;

      // Strip the entire tag (including angle brackets)
      strips.push({ start: tagStart, end: tagEnd });

      if (tagName === 'note') {
        notes.push(content);
      } else if (tagName === 'influence') {
        influences.push(content);
      } else if (tagName === 'ooc') {
        if (content.trim().length > 0) {
          oocContents.push(content);
        }
      }

      pos = tagEnd;
    } else {
      // Malformed — no closing tag. Treat rest of message as content.
      const content = remainder;
      strips.push({ start: tagStart, end: length });

      if (tagName === 'note') {
        notes.push(content);
      } else if (tagName === 'influence') {
        influences.push(content);
      } else if (tagName === 'ooc') {
        if (content.trim().length > 0) {
          oocContents.push(content);
        }
      }

      // We've consumed everything — break out
      break;
    }
  }

  // Build cleaned content by removing all tagged spans
  const cleanContent = _applyStrips(input, strips);

  return { cleanContent, notes, influences, oocContents };
};

/**
 * Removes the given spans from the input string, collapsing
 * adjacent whitespace between removed spans.
 *
 * @param input — Original string.
 * @param strips — Spans to remove, sorted by start position.
 * @returns Cleaned string with strips removed.
 */
const _applyStrips = (input: string, strips: Array<{ start: number; end: number }>): string => {
  if (strips.length === 0) {
    return input;
  }

  // Sort by start position (should already be sorted from parsing order)
  strips.sort((a, b) => a.start - b.start);

  const parts: string[] = [];
  let cursor = 0;

  for (const strip of strips) {
    // Add the text before this strip
    if (strip.start > cursor) {
      parts.push(input.slice(cursor, strip.start));
    }
    cursor = strip.end;
  }

  // Add remaining text after the last strip
  if (cursor < input.length) {
    parts.push(input.slice(cursor));
  }

  // Join and collapse extra whitespace from tag removal
  return parts
    .join('')
    .replace(/\n{3,}/g, '\n\n') // Collapse triple+ newlines
    .replace(/ {2,}/g, ' ') // Collapse double+ spaces
    .trim();
};
