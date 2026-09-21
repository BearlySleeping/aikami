// scripts/src/lib/ops/emberwatch_studio.test.ts

import { describe, expect, test } from 'bun:test';
import { parseStudioPort } from './emberwatch_studio.ts';

describe('parseStudioPort', () => {
  test('accepts finite integer TCP ports', () => {
    expect(parseStudioPort(['--port', '4321'])).toBe(4321);
    expect(parseStudioPort(['--port', '65535'])).toBe(65_535);
  });

  test('falls back for missing, malformed, fractional, or out-of-range values', () => {
    expect(parseStudioPort([])).toBe(8788);
    expect(parseStudioPort(['--port'])).toBe(8788);
    expect(parseStudioPort(['--port', 'NaN'])).toBe(8788);
    expect(parseStudioPort(['--port', '12.5'])).toBe(8788);
    expect(parseStudioPort(['--port', '0'])).toBe(8788);
    expect(parseStudioPort(['--port', '65536'])).toBe(8788);
  });
});
