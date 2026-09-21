// apps/frontend/client/src/lib/services/game/slash_command_parser.test.ts
//
// Unit tests for parseSlashCommand (C-501 AC-5). Covers shared argument
// tokenization, case normalization, ordinary text, unknown commands, and a
// bare `/`.

import { describe, expect, test } from 'bun:test';
import { getDialogueSlashCompletions, parseSlashCommand } from './slash_command_parser.ts';

describe('parseSlashCommand', () => {
  describe('ordinary text', () => {
    test('plain text with no slash maps to none', () => {
      expect(parseSlashCommand('Hello, elder.')).toEqual({ kind: 'none' });
    });

    test('a leading word that only contains a slash is treated as text when not at start', () => {
      // "5 / 2" is not a command — parseLine tokenizes it as text.
      expect(parseSlashCommand('5 / 2')).toEqual({ kind: 'none' });
    });
  });

  describe('bare slash', () => {
    test('a bare "/" maps to help', () => {
      expect(parseSlashCommand('/')).toEqual({ kind: 'help' });
    });

    test('a trimmed bare "/" maps to help', () => {
      expect(parseSlashCommand('  /  ')).toEqual({ kind: 'help' });
    });
  });

  describe('generate', () => {
    test('parses a prompt, joining tokens', () => {
      expect(parseSlashCommand('/generate a forest clearing at dusk')).toEqual({
        kind: 'generate',
        prompt: 'a forest clearing at dusk',
      });
    });

    test('is case-insensitive', () => {
      expect(parseSlashCommand('/Generate a castle')).toEqual({
        kind: 'generate',
        prompt: 'a castle',
      });
    });

    test('trims surrounding whitespace', () => {
      expect(parseSlashCommand('  /generate   a river  ')).toEqual({
        kind: 'generate',
        prompt: 'a river',
      });
    });

    test('an empty prompt maps to help, not an image request', () => {
      expect(parseSlashCommand('/generate')).toEqual({ kind: 'help' });
      expect(parseSlashCommand('/generate   ')).toEqual({ kind: 'help' });
    });
  });

  describe('tree', () => {
    test('maps /tree', () => {
      expect(parseSlashCommand('/tree')).toEqual({ kind: 'tree' });
    });

    test('is case-insensitive and ignores trailing args', () => {
      expect(parseSlashCommand('  /Tree anything')).toEqual({ kind: 'tree' });
    });
  });

  describe('gm commands', () => {
    test('/action routes to gm with the instruction text', () => {
      expect(parseSlashCommand('/action search for tracks')).toEqual({
        kind: 'gm',
        command: 'action',
        text: 'search for tracks',
      });
    });

    test('bare /action retains its command identity for help routing', () => {
      expect(parseSlashCommand('/action')).toEqual({ kind: 'gm', command: 'action', text: '' });
    });

    test('/look retains its command identity for descriptive default routing', () => {
      expect(parseSlashCommand('/look')).toEqual({ kind: 'gm', command: 'look', text: '' });
    });

    test('/Look is case-insensitive', () => {
      expect(parseSlashCommand('/Look around')).toEqual({
        kind: 'gm',
        command: 'look',
        text: 'around',
      });
    });
  });

  describe('unknown commands', () => {
    test('an unknown command maps to help', () => {
      expect(parseSlashCommand('/foobar x y')).toEqual({ kind: 'help' });
    });
  });
});

describe('getDialogueSlashCompletions', () => {
  test('returns every dialogue command for a bare slash', () => {
    const result = getDialogueSlashCompletions('/');
    expect(result.map((c) => c.name)).toEqual(['generate', 'tree', 'action', 'look', 'help']);
  });

  test('filters by prefix, matching the command name', () => {
    expect(getDialogueSlashCompletions('/gen').map((c) => c.name)).toEqual(['generate']);
    expect(getDialogueSlashCompletions('/a').map((c) => c.name)).toEqual(['action']);
  });

  test('matches aliases (help via ?)', () => {
    expect(getDialogueSlashCompletions('/?').map((c) => c.name)).toEqual(['help']);
  });

  test('is case-insensitive', () => {
    expect(getDialogueSlashCompletions('/TREE').map((c) => c.name)).toEqual(['tree']);
  });

  test('returns an empty list for non-slash input', () => {
    expect(getDialogueSlashCompletions('hello')).toEqual([]);
  });

  test('returns an empty list once a space is typed (full command)', () => {
    expect(getDialogueSlashCompletions('/generate a forest')).toEqual([]);
  });

  test('returns an empty list for an unmatched prefix', () => {
    expect(getDialogueSlashCompletions('/zzz')).toEqual([]);
  });
});
