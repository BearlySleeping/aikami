// apps/frontend/client/src/lib/views/combat/utils/dice_notation.test.ts
//
// Unit tests for parseDiceNotation — C-421 AC-1: signed modifier support and
// count/sides bounds.
import { describe, expect, test } from 'bun:test';
import { parseDiceNotation, parseRollCommand } from './dice_notation.ts';

describe('parseDiceNotation', () => {
  test('parses plain notation without modifier', () => {
    expect(parseDiceNotation('2d6')).toEqual({ count: 2, sides: 6, label: '2d6', modifier: 0 });
    expect(parseDiceNotation('d20')).toEqual({ count: 1, sides: 20, label: 'd20', modifier: 0 });
    expect(parseDiceNotation('1d100')).toEqual({
      count: 1,
      sides: 100,
      label: 'd100',
      modifier: 0,
    });
  });

  test('parses a positive signed modifier', () => {
    expect(parseDiceNotation('1d20+3')).toEqual({
      count: 1,
      sides: 20,
      label: 'd20',
      modifier: 3,
    });
    expect(parseDiceNotation('2d6+5')).toEqual({
      count: 2,
      sides: 6,
      label: '2d6',
      modifier: 5,
    });
  });

  test('parses a negative signed modifier', () => {
    expect(parseDiceNotation('1d20-1')).toEqual({
      count: 1,
      sides: 20,
      label: 'd20',
      modifier: -1,
    });
    expect(parseDiceNotation('2d6-2')).toEqual({
      count: 2,
      sides: 6,
      label: '2d6',
      modifier: -2,
    });
  });

  test('trims whitespace and lowercases', () => {
    expect(parseDiceNotation('  1D20+3  ')).toEqual({
      count: 1,
      sides: 20,
      label: 'd20',
      modifier: 3,
    });
  });

  test('returns undefined for malformed notation', () => {
    expect(parseDiceNotation('foo')).toBeUndefined();
    expect(parseDiceNotation('d')).toBeUndefined();
    expect(parseDiceNotation('20')).toBeUndefined();
    expect(parseDiceNotation('1d20x')).toBeUndefined();
    expect(parseDiceNotation('')).toBeUndefined();
  });

  test('returns undefined for out-of-bounds counts and sides', () => {
    expect(parseDiceNotation('99999d6')).toBeUndefined();
    expect(parseDiceNotation('1d999999')).toBeUndefined();
    expect(parseDiceNotation('999999d999999')).toBeUndefined();
  });

  test('returns undefined for zero or negative count/sides', () => {
    expect(parseDiceNotation('0d6')).toBeUndefined();
    expect(parseDiceNotation('d0')).toBeUndefined();
  });
});

describe('parseRollCommand (C-421 AC-1)', () => {
  test('parses a plain roll with no DC', () => {
    expect(parseRollCommand('1d20+3')).toEqual({
      notation: '1d20+3',
      count: 1,
      sides: 20,
      modifier: 3,
      dc: undefined,
    });
  });

  test('parses a trailing vs <dc>', () => {
    expect(parseRollCommand('1d20+3 vs 15')).toEqual({
      notation: '1d20+3',
      count: 1,
      sides: 20,
      modifier: 3,
      dc: 15,
    });
  });

  test('parses a multi-die roll with a DC', () => {
    expect(parseRollCommand('2d6 vs 10')).toEqual({
      notation: '2d6',
      count: 2,
      sides: 6,
      modifier: 0,
      dc: 10,
    });
  });

  test('returns undefined for malformed notation', () => {
    expect(parseRollCommand('foo')).toBeUndefined();
    expect(parseRollCommand('99999d6')).toBeUndefined();
    expect(parseRollCommand('1d20 vs abc')).toBeUndefined();
  });
});
