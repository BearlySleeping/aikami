import { describe, expect, test } from 'bun:test';
import { resolvePrSelector, tokenizeArgs } from './gh.ts';

describe('resolvePrSelector', () => {
  test('passes a bare PR number through', () => {
    expect(resolvePrSelector('42')).toBe('42');
  });

  test('extracts the number from a pull URL', () => {
    expect(resolvePrSelector('https://github.com/o/r/pull/42')).toBe('42');
  });

  test('extracts the number from an issue URL', () => {
    expect(resolvePrSelector('https://github.com/o/r/issues/7')).toBe('7');
  });

  test('keeps a branch name whose suffix is numeric', () => {
    // The regression this consolidation fixes: code_rabbit's old prNumber()
    // matched trailing digits and turned this branch into PR "390".
    expect(resolvePrSelector('feat/c-390')).toBe('feat/c-390');
  });

  test('keeps an ordinary branch name', () => {
    expect(resolvePrSelector('feat/xyz')).toBe('feat/xyz');
  });

  test('trims surrounding whitespace', () => {
    expect(resolvePrSelector('  feat/xyz  ')).toBe('feat/xyz');
  });
});

describe('tokenizeArgs', () => {
  test('splits on whitespace', () => {
    expect(tokenizeArgs('pr view 42')).toEqual(['pr', 'view', '42']);
  });

  test('collapses repeated whitespace', () => {
    expect(tokenizeArgs('pr   view    42')).toEqual(['pr', 'view', '42']);
  });

  test('keeps single-quoted jq expressions intact', () => {
    expect(tokenizeArgs("pr view 42 --jq '.comments | length'")).toEqual([
      'pr',
      'view',
      '42',
      '--jq',
      '.comments | length',
    ]);
  });

  test('keeps double-quoted arguments intact', () => {
    expect(tokenizeArgs('issue create --title "a b c"')).toEqual([
      'issue',
      'create',
      '--title',
      'a b c',
    ]);
  });

  test('preserves a deliberate empty argument', () => {
    expect(tokenizeArgs('gh --body ""')).toEqual(['gh', '--body', '']);
  });

  test('returns no tokens for blank input', () => {
    expect(tokenizeArgs('   ')).toEqual([]);
  });

  test('a backslash escapes the next character', () => {
    expect(tokenizeArgs('a b\\ c')).toEqual(['a', 'b c']);
  });

  test('a backslash escapes a quote', () => {
    expect(tokenizeArgs('--body \\"quoted\\"')).toEqual(['--body', '"quoted"']);
  });

  test('backslashes are literal inside single quotes', () => {
    expect(tokenizeArgs("--jq '.a\\.b'")).toEqual(['--jq', '.a\\.b']);
  });
});
