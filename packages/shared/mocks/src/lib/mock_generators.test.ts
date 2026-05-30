import { describe, expect, test } from 'bun:test';

describe('Mock Generators', () => {
  test('should export generateMockMessage function', () => {
    const { generateMockMessage } = require('./mock-generators.ts');

    expect(typeof generateMockMessage).toBe('function');
  });
});
