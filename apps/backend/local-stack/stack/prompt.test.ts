/**
 * apps/backend/local-stack/stack/prompt.test.ts
 *
 * The routing decision in `promptStyle` is the part that can break quietly:
 * pick `rich` where there is no TTY and `curl | sh` hangs forever on a
 * checkbox nobody can see; pick `none` on a real terminal and the wizard stops
 * asking anything. The prompt bodies themselves are covered through
 * init.test.ts (which drives the plain path end to end).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import process from 'node:process';
import { CANCELLED, confirm, multiselect, promptStyle, select } from './prompt.ts';

const original = {
  stdin: process.stdin.isTTY,
  stdout: process.stdout.isTTY,
  noColorEnv: process.env.NO_COLOR,
};

const setTty = (stdin: boolean, stdout: boolean): void => {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true });
};

afterEach(() => {
  setTty(original.stdin, original.stdout);
  if (original.noColorEnv === undefined) {
    process.env.NO_COLOR = undefined;
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = original.noColorEnv;
  }
});

describe('promptStyle', () => {
  test('a colour TTY on both ends gets the rich checkbox UI', () => {
    setTty(true, true);
    delete process.env.NO_COLOR;
    expect(promptStyle({ noColor: false })).toBe('rich');
  });

  test('--no-color and NO_COLOR both fall back to the line-oriented UI', () => {
    setTty(true, true);
    delete process.env.NO_COLOR;
    expect(promptStyle({ noColor: true })).toBe('plain');
    process.env.NO_COLOR = '1';
    expect(promptStyle({ noColor: false })).toBe('plain');
  });

  test('a pipe on either end never prompts', () => {
    // `curl | sh`, CI, and the test runner all land here. A rich prompt in a
    // pipe would block forever with no visible question.
    delete process.env.NO_COLOR;
    setTty(false, true);
    expect(promptStyle({ noColor: false })).toBe('none');
    setTty(true, false);
    expect(promptStyle({ noColor: false })).toBe('none');
    setTty(false, false);
    expect(promptStyle({ noColor: false })).toBe('none');
  });
});

describe('style "none" answers with the caller default and never reads stdin', () => {
  const none = { style: 'none' } as const;

  test('confirm', async () => {
    expect(await confirm('Write .env?', true, none)).toBe(true);
    expect(await confirm('Overwrite?', false, none)).toBe(false);
  });

  test('select', async () => {
    const picked = await select(
      'Hardware backend?',
      [{ value: 'cpu' }, { value: 'cuda' }],
      'cuda',
      none,
    );
    expect(picked).toBe('cuda');
  });

  test('multiselect', async () => {
    const picked = await multiselect(
      'Which engines?',
      [{ value: 'text' }, { value: 'image' }, { value: 'voice' }],
      ['text', 'voice'],
      none,
    );
    expect(picked).toEqual(['text', 'voice']);
  });

  test('never returns CANCELLED — there is no one to cancel', async () => {
    expect(await confirm('q', true, none)).not.toBe(CANCELLED);
  });
});
