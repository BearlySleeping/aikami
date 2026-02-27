import { describe, expect, test } from 'bun:test';
import { unixLabel } from './transform.ts';

describe('unixLabel', () => {
  test('should be a non-empty string', () => {
    expect(typeof unixLabel).toBe('string');
    expect(unixLabel.length).toBeGreaterThan(0);
  });

  test('should have correct value', () => {
    expect(unixLabel).toBe('Unix');
  });
});
