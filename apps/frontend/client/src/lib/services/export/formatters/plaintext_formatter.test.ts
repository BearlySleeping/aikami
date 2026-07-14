// apps/frontend/client/src/lib/services/export/formatters/plaintext_formatter.test.ts
//
// Unit tests for plain text prose chat export formatter (C-246, AC-2).

import { describe, expect, test } from 'bun:test';
import type { ExportMessage } from './jsonl_formatter.ts';
import { messagesToPlainText } from './plaintext_formatter.ts';

const _makeMessage = (
  overrides: Partial<ExportMessage> & { text: string; sender: 'user' | 'ai' },
): ExportMessage => ({
  text: overrides.text,
  sender: overrides.sender,
  timestamp: overrides.timestamp || '2026-07-10T14:30:00.000Z',
  edited: overrides.edited || false,
  diceRolls: overrides.diceRolls,
  attachments: overrides.attachments,
});

describe('messagesToPlainText', () => {
  test('produces header with NPC name and export date', () => {
    const result = messagesToPlainText({
      npcName: 'Elara Nightwhisper',
      exportedAt: '2026-07-10T12:00:00.000Z',
      messages: [],
    });
    expect(result).toContain('=== Chat with Elara Nightwhisper ===');
    expect(result).toContain('Exported 2026-07-10');
  });

  test('uses userName for user messages and npcName for AI messages', () => {
    const messages: ExportMessage[] = [
      _makeMessage({ text: 'Hello there', sender: 'user' }),
      _makeMessage({ text: 'Greetings, traveler', sender: 'ai' }),
    ];
    const result = messagesToPlainText({
      npcName: 'Elara',
      userName: 'Thorn',
      exportedAt: '2026-07-10',
      messages,
    });
    expect(result).toContain('[Thorn,');
    expect(result).toContain('[Elara,');
  });

  test('falls back to "User" when userName is not provided', () => {
    const messages: ExportMessage[] = [_makeMessage({ text: 'Hello', sender: 'user' })];
    const result = messagesToPlainText({
      npcName: 'Elara',
      exportedAt: '2026-07-10',
      messages,
    });
    expect(result).toContain('[User,');
  });

  test('edited messages show (edited) marker', () => {
    const messages: ExportMessage[] = [
      _makeMessage({ text: 'Original message', sender: 'user', edited: true }),
    ];
    const result = messagesToPlainText({
      npcName: 'Elara',
      exportedAt: '2026-07-10',
      messages,
    });
    expect(result).toContain('(edited)');
  });

  test('dice rolls are shown as 🎲 markers', () => {
    const messages: ExportMessage[] = [
      _makeMessage({
        text: 'I roll for perception',
        sender: 'user',
        diceRolls: [{ notation: 'd20', result: 17, details: 'success' }],
      }),
    ];
    const result = messagesToPlainText({
      npcName: 'Elara',
      exportedAt: '2026-07-10',
      messages,
    });
    expect(result).toContain('🎲 d20 = 17 (success)');
  });

  test('attachments are shown as [Image: ...] or [File: ...] markers', () => {
    const messages: ExportMessage[] = [
      _makeMessage({
        text: 'Here is an image',
        sender: 'ai',
        attachments: [
          { type: 'image', url: 'https://example.com/forest.png', name: 'forest_path.png' },
          { type: 'file', url: 'https://example.com/note.txt', name: 'note.txt' },
        ],
      }),
    ];
    const result = messagesToPlainText({
      npcName: 'Elara',
      exportedAt: '2026-07-10',
      messages,
    });
    expect(result).toContain('[Image: forest_path.png]');
    expect(result).toContain('[File: note.txt]');
  });

  test('handles empty messages array', () => {
    const result = messagesToPlainText({
      npcName: 'Elara',
      exportedAt: '2026-07-10',
      messages: [],
    });
    expect(result).toContain('=== Chat with Elara ===');
    // No message blocks, just the header
    const lines = result.split('\n');
    expect(lines.length).toBeLessThanOrEqual(3); // header + export date + maybe trailing newline
  });
});
