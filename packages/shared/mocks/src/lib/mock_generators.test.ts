// packages/shared/mocks/src/lib/mock_generators.test.ts
import { describe, expect, test } from 'bun:test';
import { generateMockMessage } from './mock_generators.ts';

describe('Mock Generators', () => {
  test('should export generateMockMessage function', () => {
    expect(typeof generateMockMessage).toBe('function');
  });

  test('generateMockMessage returns a structurally valid object', () => {
    const message = generateMockMessage();
    expect(message).toBeDefined();
    expect(typeof message).toBe('object');
  });
});
