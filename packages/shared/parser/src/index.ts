// packages/shared/parser/src/index.ts
export { extractMacros, hasUnclosedMacro, stripMacros, tokenizeLine } from "./lib/lexer.js";
export {
  buildSystemMessage,
  createStreamBuffer,
  flushStreamBuffer,
  parseLine,
  parseStreamChunk,
} from "./lib/parser.js";
export type { StreamBuffer, StreamChunkResult } from "./lib/parser.js";
export type {
  ASTNode,
  CommandNode,
  MacroNode,
  ParseNode,
  ParseResult,
  TextNode,
} from "./lib/types.js";
