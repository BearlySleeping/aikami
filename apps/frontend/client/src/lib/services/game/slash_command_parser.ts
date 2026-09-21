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

import type { SlashCommandEntry } from '@aikami/constants';
import { parseLine } from '@aikami/parser';

/**
 * Discriminated result of parsing a dialogue input line.
 *
 * - `generate` → produce an inline image from the given prompt.
 * - `tree` → re-present the previous turn's choice set.
 * - `gm` → route the identified command and instruction to the Game Master address mode.
 * - `help` → inline command help (unknown/empty commands, bare `/`).
 * - `none` → not a slash command; forward as normal dialogue.
 */
export type SlashCommandResult =
  | { kind: 'generate'; prompt: string }
  | { kind: 'tree' }
  | { kind: 'gm'; command: 'action' | 'look'; text: string }
  | { kind: 'help' }
  | { kind: 'none' };

/** Inline help text shown for unknown/empty commands and bare `/` (C-501). */
export const SLASH_COMMAND_HELP =
  'Commands: /generate <prompt> — generate an image · /tree — show previous choices · /action <instruction> or /look — speak to the Game Master · /help — this help';

/**
 * The slash commands the dialogue input can dispatch (C-501).
 *
 * Distinct from the chat surface's `SLASH_COMMANDS` registry — the dialogue
 * commands are scoped to the parser outcomes below. Module-local: the only
 * consumer is `getDialogueSlashCompletions` below, which is what the dialogue
 * composer's autocomplete popup is wired to. Do not export it — an exported
 * registry with no production caller is an orphaned capability
 * (see guard_orphaned_capability.ts).
 */
const DIALOGUE_SLASH_COMMANDS: readonly SlashCommandEntry[] = [
  {
    name: 'generate',
    description: 'Generate an inline image from a prompt',
    usage: '/generate <prompt>',
  },
  {
    name: 'tree',
    description: 'Show the previous choices',
    usage: '/tree',
  },
  {
    name: 'action',
    description: 'Speak to the Game Master with an instruction',
    usage: '/action <instruction>',
  },
  {
    name: 'look',
    description: 'Look around — speak to the Game Master',
    usage: '/look',
  },
  {
    name: 'help',
    description: 'Show available slash commands',
    usage: '/help',
    aliases: ['?'],
  },
] as const;

/**
 * Filters the dialogue command registry by a partial prefix, mirroring
 * `getSlashCompletions` from @aikami/constants for the chat surface.
 *
 * @param partial — Raw input starting with `/` (e.g. `/gen`, `/t`).
 * @returns Matching entries, or all entries if the input is just `/`.
 */
export const getDialogueSlashCompletions = (partial: string): readonly SlashCommandEntry[] => {
  if (!partial.startsWith('/')) {
    return [];
  }

  const rawPrefix = partial.slice(1);
  if (rawPrefix.includes(' ')) {
    return [];
  }

  const prefix = rawPrefix.trim().toLowerCase();
  if (!prefix) {
    return DIALOGUE_SLASH_COMMANDS;
  }

  return DIALOGUE_SLASH_COMMANDS.filter(
    (cmd) => cmd.name.startsWith(prefix) || cmd.aliases?.some((a) => a.startsWith(prefix)),
  );
};

/**
 * Parses a dialogue input line into a {@link SlashCommandResult}.
 *
 * Trims the input, delegates to `parseLine`, lowercases the returned command
 * name for dialogue-command matching, and maps the shared `command.args`
 * tokens into the result (`args.join(' ')` for prompt/text commands) while
 * retaining whether a GM command was `/action` or `/look`.
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
      return { kind: 'gm', command: 'action', text: args };
    case 'look':
      return { kind: 'gm', command: 'look', text: args };
    default:
      return { kind: 'help' };
  }
};
