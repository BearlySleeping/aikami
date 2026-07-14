// packages/shared/constants/src/lib/slash_commands.test.ts
//
// Unit tests for slash command registry and autocomplete filtering.
//
// Contract: C-241 Chat Modes — autocomplete extension

import { describe, expect, test } from 'bun:test';
import { getSlashCompletions, SLASH_COMMANDS } from './slash_commands.ts';

describe('SLASH_COMMANDS registry', () => {
  test('registry is non-empty', () => {
    expect(SLASH_COMMANDS.length).toBeGreaterThan(0);
  });

  test('every command has a name and description', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(cmd.description.length).toBeGreaterThan(0);
      expect(cmd.usage.startsWith('/')).toBe(true);
    }
  });

  test('includes impersonation command', () => {
    const imp = SLASH_COMMANDS.find((c) => c.name === 'impersonate');
    expect(imp).toBeDefined();
  });

  test('includes roll command', () => {
    const roll = SLASH_COMMANDS.find((c) => c.name === 'roll');
    expect(roll).toBeDefined();
  });

  test('includes help command', () => {
    const help = SLASH_COMMANDS.find((c) => c.name === 'help');
    expect(help).toBeDefined();
  });
});

describe('getSlashCompletions', () => {
  test('returns empty for non-slash input', () => {
    expect(getSlashCompletions('hello')).toEqual([]);
    expect(getSlashCompletions('')).toEqual([]);
  });

  test('returns all commands for bare slash', () => {
    const result = getSlashCompletions('/');
    expect(result.length).toBe(SLASH_COMMANDS.length);
  });

  test('returns matching commands by prefix', () => {
    const result = getSlashCompletions('/imp');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((c) => c.name.startsWith('imp'))).toBe(true);
  });

  test('returns matching commands by alias', () => {
    const result = getSlashCompletions('/r');
    expect(result.some((c) => c.name === 'roll')).toBe(true);
  });

  test('returns empty for input with space', () => {
    expect(getSlashCompletions('/imp test')).toEqual([]);
  });

  test('returns empty for no matches', () => {
    expect(getSlashCompletions('/zzz')).toEqual([]);
  });

  test('case-insensitive matching', () => {
    const result = getSlashCompletions('/HELP');
    expect(result.some((c) => c.name === 'help')).toBe(true);
  });
});
