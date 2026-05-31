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
export {
  formatAlpaca,
  formatChatML,
  formatDeepSeek,
  formatInstruct,
  formatLlama3,
  formatMistral,
  formatVicuna,
  INSTRUCT_FORMATTERS,
} from "./lib/instruct.js";
export type { InstructTemplateName } from "./lib/instruct.js";
