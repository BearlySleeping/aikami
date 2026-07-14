// apps/frontend/client/src/lib/services/export/formatters/jsonl_formatter.test.ts
//
// Unit tests for JSONL chat export formatter (C-246, AC-1).

import { describe, expect, test } from 'bun:test';
import { type ExportMessage, messagesToJsonl } from './jsonl_formatter.ts';

const _makeMessage = (
  overrides: Partial<ExportMessage> & { text: string; sender: 'user' | 'ai' },
): ExportMessage => ({
  text: overrides.text,
  sender: overrides.sender,
  timestamp: overrides.timestamp || '2026-07-10T14:30:00.000Z',
  edited: overrides.edited || false,
  branchId: overrides.branchId,
  diceRolls: overrides.diceRolls,
  attachments: overrides.attachments,
});

describe('messagesToJsonl', () => {
  test('empty messages returns empty string', () => {
    const result = messagesToJsonl({ messages: [] });
    expect(result).toBe('');
  });

  test('single message produces valid JSON line', () => {
    const messages: ExportMessage[] = [_makeMessage({ text: 'Hello world', sender: 'user' })];
    const result = messagesToJsonl({ messages });
    const lines = result.split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.index).toBe(0);
    expect(parsed.role).toBe('user');
    expect(parsed.content).toBe('Hello world');
    expect(parsed.edited).toBe(false);
  });

  test('messages with special characters are properly JSON-escaped', () => {
    const messages: ExportMessage[] = [
      _makeMessage({ text: 'Line 1\nLine 2 with "quotes"', sender: 'user' }),
      _makeMessage({ text: 'Emoji 😀 and backslash \\ test', sender: 'ai' }),
    ];
    const result = messagesToJsonl({ messages });
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    // Each line should be valid JSON
    const parsed1 = JSON.parse(lines[0]);
    expect(parsed1.content).toBe('Line 1\nLine 2 with "quotes"');
    const parsed2 = JSON.parse(lines[1]);
    expect(parsed2.content).toBe('Emoji 😀 and backslash \\ test');
  });

  test('edited message has edited: true', () => {
    const messages: ExportMessage[] = [
      _makeMessage({ text: 'Original', sender: 'user', edited: true }),
    ];
    const result = messagesToJsonl({ messages });
    const parsed = JSON.parse(result);
    expect(parsed.edited).toBe(true);
  });

  test('dice rolls are included when present', () => {
    const messages: ExportMessage[] = [
      _makeMessage({
        text: 'I roll for initiative',
        sender: 'user',
        diceRolls: [
          { notation: 'd20', result: 17, details: 'success' },
          { notation: '2d6', result: 9, details: '4,5' },
        ],
      }),
    ];
    const result = messagesToJsonl({ messages });
    const parsed = JSON.parse(result);
    expect(parsed.diceRolls).toHaveLength(2);
    expect(parsed.diceRolls[0].notation).toBe('d20');
    expect(parsed.diceRolls[0].result).toBe(17);
  });

  test('attachments are included when present', () => {
    const messages: ExportMessage[] = [
      _makeMessage({
        text: 'Look at this',
        sender: 'ai',
        attachments: [
          { type: 'image', url: 'https://example.com/img.png', name: 'forest_path.png' },
        ],
      }),
    ];
    const result = messagesToJsonl({ messages });
    const parsed = JSON.parse(result);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].type).toBe('image');
  });

  test('branchId is included when present', () => {
    const messages: ExportMessage[] = [
      _makeMessage({
        text: 'Alternate path',
        sender: 'ai',
        branchId: 'branch-123',
      }),
    ];
    const result = messagesToJsonl({ messages });
    const parsed = JSON.parse(result);
    expect(parsed.branchId).toBe('branch-123');
  });

  test('optional fields are omitted when not present', () => {
    const messages: ExportMessage[] = [_makeMessage({ text: 'Simple message', sender: 'user' })];
    const result = messagesToJsonl({ messages });
    const parsed = JSON.parse(result);
    expect(parsed.branchId).toBeUndefined();
    expect(parsed.diceRolls).toBeUndefined();
    expect(parsed.attachments).toBeUndefined();
  });

  test('multiple messages have sequential indices', () => {
    const messages: ExportMessage[] = [
      _makeMessage({ text: 'First', sender: 'user' }),
      _makeMessage({ text: 'Second', sender: 'ai' }),
      _makeMessage({ text: 'Third', sender: 'user' }),
    ];
    const result = messagesToJsonl({ messages });
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).index).toBe(0);
    expect(JSON.parse(lines[1]).index).toBe(1);
    expect(JSON.parse(lines[2]).index).toBe(2);
  });
});
