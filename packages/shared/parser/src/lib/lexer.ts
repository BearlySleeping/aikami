// packages/shared/parser/src/lib/lexer.ts
//
// Regex-based tokenizer that splits input into commands, macros, and text.
// All outputs are strictly validated against @aikami/schemas TypeBox schemas.

import type { CommandNode, MacroNode, TextNode } from '@aikami/schemas';
import {
  CommandNodeSchema,
  MacroNodeSchema,
  TextNodeSchema,
  validateWithLevel,
} from '@aikami/schemas';

/**
 * Regex patterns for token detection.
 */
const PATTERNS = {
  /**
   * Slash command at the start of a string.
   * Matches `/roll 1d20`, `/move 10 10`, `/roll 2d6+3`, etc.
   * Group 1: command name (word chars, hyphens, underscores)
   * Group 2: rest of line as arguments string (optional)
   */
  command: /^\/([\w-]+)(?:\s+(.+))?$/s,

  /**
   * Mustache-style macros embedded anywhere in text.
   * Matches `{{trigger_anim:attack}}`, `{{roll:1d20}}`, `{{heal:50}}`,
   * `{{skill:}}` (empty args).
   * Group 1: macro name (word chars, hyphens, underscores)
   * Group 2: arguments string (optional, comma-separated convention)
   */
  macro: /\{\{([\w-]+)(?::\s*([^}]*))?\}\}/g,

  /**
   * Unclosed macro — matches `{{` that is NOT followed by a closing `}}`.
   * Used to detect partial macros in streaming chunks.
   */
  unclosedMacro: /\{\{(?![\s\S]*\}\})/,
} as const;

/**
 * Tokenize a single user-input line.
 *
 * If the line starts with `/`, it is matched as a slash command.
 * Otherwise it is treated as plain text (macros in text are handled
 * by the streaming/chunk extractor, not here).
 *
 * All returned nodes are validated via `CommandNodeSchema` / `TextNodeSchema`.
 *
 * @param line - The raw input string from the user.
 * @returns Validated command or text nodes.
 */
export const tokenizeLine = (line: string): Array<CommandNode | TextNode> => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return [];
  }

  // --- Slash command (full-line match) ---
  if (trimmed.startsWith('/')) {
    const match = trimmed.match(PATTERNS.command);
    if (match) {
      const command = match[1];
      const rawArgs = match[2];
      if (!command) {
        return [];
      }
      const args = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [];
      const parsedCommand = {
        type: 'command' as const,
        command,
        args,
        raw: trimmed,
      };
      if (
        validateWithLevel({
          schema: CommandNodeSchema,
          value: parsedCommand,
          parseLevel: 'on',
          context: 'tokenizeLine:command',
        })
      ) {
        return [parsedCommand];
      }
    }
  }

  // --- Plain text ---
  const parsedText: TextNode = {
    type: 'text' as const,
    content: trimmed,
    raw: trimmed,
  };
  if (
    validateWithLevel({
      schema: TextNodeSchema,
      value: parsedText,
      parseLevel: 'on',
      context: 'tokenizeLine:text',
    })
  ) {
    return [parsedText];
  }
  return [];
};

/**
 * Extract completed macro tokens from a text block.
 *
 * Operates on arbitrary substrings — safe for stream evaluation.
 * All extracted macros are validated against `MacroNodeSchema`.
 *
 * @param text - The text to scan for macros.
 * @returns Array of validated MacroNode objects.
 */
export const extractMacros = (text: string): MacroNode[] => {
  const macros: MacroNode[] = [];
  // Clone regex to reset lastIndex per call
  const re = new RegExp(PATTERNS.macro.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const name = match[1];
    const argsRaw = match[2];
    if (!name) {
      continue;
    }
    const args = argsRaw
      ? argsRaw
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean)
      : [];
    const parsedMacro: MacroNode = {
      type: 'macro' as const,
      name,
      args,
      raw: match[0],
    };
    if (
      validateWithLevel({
        schema: MacroNodeSchema,
        value: parsedMacro,
        parseLevel: 'on',
        context: 'extractMacros',
      })
    ) {
      macros.push(parsedMacro);
    }
  }
  return macros;
};

/**
 * Strip all macro tokens from a string, returning clean display text.
 *
 * @param text - The text containing macros to strip.
 * @returns Clean text with all `{{macro}}` tokens removed.
 */
export const stripMacros = (text: string): string => {
  return text.replace(PATTERNS.macro, '');
};

/**
 * Check whether a string contains an unclosed macro opening `{{`
 * with no matching `}}`.
 *
 * Returns `true` when the input has an opening `{{` that hasn't
 * been closed yet — used by `parseStreamChunk` to decide buffering.
 *
 * @param text - The text to inspect.
 * @returns `true` if an unclosed macro opening exists.
 */
export const hasUnclosedMacro = (text: string): boolean => {
  return PATTERNS.unclosedMacro.test(text);
};
