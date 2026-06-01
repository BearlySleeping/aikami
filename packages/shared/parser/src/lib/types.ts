// packages/shared/parser/src/lib/types.ts
//
// Core type definitions for the macro/slash command parser.

import type { ASTNode, CommandNode, MacroNode, TextNode } from '@aikami/schemas';

export type { ASTNode, CommandNode, MacroNode, TextNode };

/**
 * Discriminated union of all parseable AST node types.
 */
export type ParseNode = CommandNode | MacroNode | TextNode;

/**
 * Result of parsing a single input line or stream chunk.
 */
export type ParseResult = {
  nodes: ASTNode[];
  /** Original raw input that was parsed. */
  raw: string;
};
