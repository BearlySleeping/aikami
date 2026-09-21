// scripts/src/lib/herdr/cli.test.ts

import { describe, expect, test } from 'bun:test';
import { parseServiceArgs } from './cli';

describe('parseServiceArgs', () => {
  test('excludes the mode flag and value from service names', () => {
    const result = parseServiceArgs(['voice', '--mode', 'staging']);

    expect(result.services).toEqual(['voice']);
    expect(result.mode).toBe('staging');
  });

  test('preserves multiple non-option service names', () => {
    const result = parseServiceArgs(['client', 'site', '--mode', 'emulator', '--join']);

    expect(result.services).toEqual(['client', 'site']);
    expect(result.join).toBe(true);
  });
});
