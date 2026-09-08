// apps/frontend/client/src/lib/services/game/slash_command_parser.ts
//
// C-501 Dialogue Slash Commands — a thin, pure adapter over @aikami/parser's
// `parseLine` that maps shared command tokens to dialogue-command outcomes.
//
// The dialogue input boundary parses leading `/` text into one of four
// outcomes (image, tree, GM, help) instead of forwarding it to the NPC
// dialogue pipeline. Ordinary text (a non-command parse) maps to `none` and
// is forwarded exactly as before.
//
// Contract: C-501 Dialogue Slash Commands

import { parseLine } from '@aikami/parser';

/**
 * Discriminated result of parsing a dialogue input line.
 *
 * - `generate` → produce an inline image from the given prompt.
 * - `tree` → re-present the previous turn's choice set.
 * - `gm` → route the instruction to the Game Master address mode.
 * - `help` → inline command help (unknown/empty commands, bare `/`).
 * - `none` → not a slash command; forward as normal dialogue.
 */
export type SlashCommandResult =
  | { kind: 'generate'; prompt: string }
  | { kind: 'tree' }
  | { kind: 'gm'; text: string }
  | { kind: 'help' }
  | { kind: 'none' };

/** Inline help text shown for unknown/empty commands and bare `/` (C-501). */
export const SLASH_COMMAND_HELP =
  'Commands: /generate <prompt> — generate an image · /tree — show previous choices · /action <instruction> or /look — speak to the Game Master · /help — this help';

/**
 * Parses a dialogue input line into a {@link SlashCommandResult}.
 *
 * Trims the input, delegates to `parseLine`, lowercases the returned command
 * name for dialogue-command matching, and maps the shared `command.args`
 * tokens into the result (`args.join(' ')` for prompt/text commands).
 *
 * Edge cases:
 * - A trimmed bare `/` maps to `help` — `parseLine` treats it as text, but
 *   the dialogue UI uses a bare `/` to request command help.
 * - Unknown parsed command names also map to `help`.
 * - `/generate` with no arguments maps to `help`, never an image request.
 */
export const parseSlashCommand = (input: string): SlashCommandResult => {
  const trimmed = input.trim();

  if (trimmed === '/') {
    return { kind: 'help' };
  }

  const { command } = parseLine(trimmed);
  if (!command) {
    return { kind: 'none' };
  }

  const name = command.command.toLowerCase();
  const args = command.args.join(' ');

  switch (name) {
    case 'generate':
      // An empty prompt is command help, not an image request (watch point).
      return args.length > 0 ? { kind: 'generate', prompt: args } : { kind: 'help' };
    case 'tree':
      return { kind: 'tree' };
    case 'action':
    case 'look':
      return { kind: 'gm', text: args };
    default:
      return { kind: 'help' };
  }
};
