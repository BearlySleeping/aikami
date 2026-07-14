// apps/frontend/client/src/lib/services/export/formatters/plaintext_formatter.ts
//
// Plain text prose chat export formatter (AC-2).
// Converts chat messages into a readable script-style format with character
// names, timestamps, dice roll markers, and attachment references.

import type { ExportMessage } from './jsonl_formatter.ts';

/**
 * Options for the plain text prose formatter.
 */
export type PlainTextExportOptions = {
  /** NPC character name (e.g., "Elara Nightwhisper"). */
  npcName: string;
  /** User persona name (falls back to "User" if not provided). */
  userName?: string;
  /** ISO-8601 timestamp of export. */
  exportedAt: string;
  /** The messages to format. */
  messages: ExportMessage[];
};

/**
 * Formats a timestamp string into a shorter HH:MM display.
 */
const _formatTime = (iso: string): string => {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
};

/**
 * Formats a dice roll for inline display.
 */
const _formatDiceRoll = (rolls: ExportMessage['diceRolls']): string => {
  if (!rolls?.length) {
    return '';
  }
  return rolls
    .map((r) => `🎲 ${r.notation} = ${r.result}${r.details ? ` (${r.details})` : ''}`)
    .join('\n');
};

/**
 * Converts chat messages to a readable plain text prose format.
 *
 * Format:
 * ```
 * === Chat with Elara Nightwhisper ===
 * Exported 2026-07-10
 *
 * [Elara Nightwhisper, 14:31]
 * *The elf looks up from her map* These ruins predate the kingdom itself.
 *
 * [Thorn Ironvein, 14:32]
 * I cast Detect Magic. Do I sense anything?
 * 🎲 d20 = 17 (success)
 * ```
 */
export const messagesToPlainText = (options: PlainTextExportOptions): string => {
  const { npcName, userName = 'User', exportedAt, messages } = options;
  const lines: string[] = [];

  lines.push(`=== Chat with ${npcName} ===`);
  lines.push(`Exported ${exportedAt.split('T')[0]}`);

  for (const message of messages) {
    lines.push('');
    const senderName = message.sender === 'ai' ? npcName : userName;
    const editMarker = message.edited ? ' (edited)' : '';
    lines.push(`[${senderName}, ${_formatTime(message.timestamp)}]${editMarker}`);

    if (message.text) {
      lines.push(message.text);
    }

    const diceText = _formatDiceRoll(message.diceRolls);
    if (diceText) {
      lines.push(diceText);
    }

    if (message.attachments?.length) {
      for (const attachment of message.attachments) {
        const displayName = attachment.name || attachment.url.split('/').pop() || 'attachment';
        const typeLabel = attachment.type === 'image' ? 'Image' : 'File';
        lines.push(`[${typeLabel}: ${displayName}]`);
      }
    }
  }

  return lines.join('\n');
};
