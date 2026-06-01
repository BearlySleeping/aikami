// packages/shared/parser/src/lib/parser.ts
//
// Parser — coordinates lexer with AST node construction for
// full-line commands, inline macro extraction, and stream buffering.

import type { ASTNode, CommandNode, MacroNode, TextNode } from '@aikami/schemas';
import { extractMacros, hasUnclosedMacro, stripMacros, tokenizeLine } from './lexer.js';

/**
 * Parse a complete user-input line.
 *
 * Returns both the full AST node array and the first CommandNode (if any).
 * The `command` field being non-null signals that the input is a
 * slash-command and should NOT be forwarded to the AI service.
 *
 * @param line - The raw input string from the user.
 * @returns Parsed nodes and optional command reference.
 */
export const parseLine = (line: string): { nodes: ASTNode[]; command: CommandNode | null } => {
  const tokens = tokenizeLine(line);
  let command: CommandNode | null = null;
  const nodes: ASTNode[] = [];

  for (const token of tokens) {
    if (token.type === 'command') {
      command = token;
    }
    nodes.push(token);
  }

  return { nodes, command };
};

// ---------------------------------------------------------------------------
// Streaming macro parser
// ---------------------------------------------------------------------------

/**
 * State container for incremental stream parsing.
 *
 * Consumers (chat VM, game bridge) should create one `StreamBuffer` per
 * AI response stream and feed chunks through {@link parseStreamChunk}.
 */
export type StreamBuffer = {
  /** Text accumulated across chunks that hasn't resolved yet. */
  buffer: string;
  /** Text that has been safely emitted to the UI so far. */
  emitted: string;
};

/**
 * Create a fresh streaming buffer.
 *
 * @returns A new, empty StreamBuffer.
 */
export const createStreamBuffer = (): StreamBuffer => {
  return { buffer: '', emitted: '' };
};

/**
 * Result of processing one chunk of an AI stream.
 */
export type StreamChunkResult = {
  /** Text safe to append to the UI display (macros stripped). */
  displayText: string;
  /** Any macros that fully resolved in this chunk. */
  macros: MacroNode[];
  /** Whether the buffer still holds an unclosed macro across chunks. */
  pending: boolean;
};

/**
 * Process a single chunk from an AI response stream.
 *
 * **Buffering logic**:
 * - If the chunk contains an unclosed `{{` (no `}}`), the partial
 *   text is held in the buffer and NOT returned as display text.
 * - On subsequent chunks, the buffer is prepended and evaluated.
 * - Macros are extracted and stripped only when they are fully closed.
 *
 * This ensures that `{{anim:attack_01}}` is stripped from the UI
 * even when it arrives across multiple network packets.
 *
 * @param chunk - The current chunk of the AI stream.
 * @param buffer - The mutable stream buffer carrying state across chunks.
 * @returns Parsed display text, macros, and pending state.
 */
export const parseStreamChunk = (chunk: string, buffer: StreamBuffer): StreamChunkResult => {
  // Prepend any buffered text from a previous partial-chunk
  const combined = buffer.buffer + chunk;

  // If the combined text still has an unclosed macro, buffer it
  if (hasUnclosedMacro(combined)) {
    buffer.buffer = combined;
    return { displayText: '', macros: [], pending: true };
  }

  // Fully-resolved text — extract macros and return clean display
  buffer.buffer = '';
  const macros = extractMacros(combined);
  const displayText = stripMacros(combined);
  buffer.emitted += displayText;

  return { displayText, macros, pending: false };
};

/**
 * Flush any remaining buffered text. Call when the stream ends.
 *
 * If the stream ended mid-macro (e.g. `{{anim:att` without closing),
 * the partial text is returned as-is since it was malformed input.
 *
 * @param buffer - The mutable stream buffer to flush.
 * @returns Remaining text (if any) and pending state.
 */
export const flushStreamBuffer = (buffer: StreamBuffer): StreamChunkResult => {
  const remaining = buffer.buffer;
  buffer.buffer = '';
  if (remaining.length === 0) {
    return { displayText: '', macros: [], pending: false };
  }
  return { displayText: remaining, macros: [], pending: false };
};

// ---------------------------------------------------------------------------
// System message builder
// ---------------------------------------------------------------------------

/**
 * Build a system-message TextNode for command results or echo.
 *
 * @param text - The display text for the system message.
 * @returns A TextNode representing a system message.
 */
export const buildSystemMessage = (text: string): TextNode => {
  return {
    type: 'text' as const,
    content: text,
    raw: text,
  };
};
