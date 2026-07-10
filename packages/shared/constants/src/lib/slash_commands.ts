// packages/shared/constants/src/lib/slash_commands.ts
//
// Slash command registry — flat list of available /commands with name,
// description, usage, and brief label. Used by the chat input autocomplete
// popup and the ChatViewModel command dispatcher.
//
// Contract: C-241 Chat Modes Address System — autocomplete extension

import { IMPERSONATION_COMMAND } from './impersonation.ts';

/**
 * A registered slash command available in the chat input.
 */
export type SlashCommandEntry = {
  /** Command name (without the leading `/`). */
  name: string;
  /** Short description shown in the autocomplete popup. */
  description: string;
  /** Usage example (e.g. "/impersonate I examine the runes"). */
  usage: string;
  /** Aliases that also trigger this command. */
  aliases?: readonly string[];
};

/**
 * All registered slash commands for the chat input.
 *
 * Keep this flat — no nested categories. The autocomplete filters by
 * prefix match against `name` and `aliases`.
 */
export const SLASH_COMMANDS: readonly SlashCommandEntry[] = [
  {
    name: IMPERSONATION_COMMAND,
    description: 'Draft a message as your persona (editable before sending)',
    usage: '/impersonate [direction]',
  },
  {
    name: 'roll',
    description: 'Roll dice — e.g. /roll 2d6, /roll 1d20+5',
    usage: '/roll <notation>',
    aliases: ['r', 'dice'],
  },
  {
    name: 'help',
    description: 'Show available slash commands',
    usage: '/help',
    aliases: ['?'],
  },
] as const;

/**
 * Filters the slash command registry by a partial prefix.
 *
 * @param partial — Raw input starting with `/` (e.g. `/imp`, `/r`).
 * @returns Matching entries, or all entries if the input is just `/`.
 */
export const getSlashCompletions = (partial: string): readonly SlashCommandEntry[] => {
  if (!partial.startsWith('/')) {
    return [];
  }

  const rawPrefix = partial.slice(1);
  if (rawPrefix.includes(' ')) {
    return [];
  }

  const prefix = rawPrefix.trim().toLowerCase();
  if (!prefix) {
    return SLASH_COMMANDS;
  }

  return SLASH_COMMANDS.filter(
    (cmd) => cmd.name.startsWith(prefix) || cmd.aliases?.some((a) => a.startsWith(prefix)),
  );
};
