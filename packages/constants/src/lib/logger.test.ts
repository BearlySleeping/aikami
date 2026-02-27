import { describe, expect, test } from 'bun:test';
import { LogLevelPriority } from './logger.ts';

describe('LogLevelPriority', () => {
  test('should have NONE with value 0', () => {
    expect(LogLevelPriority.NONE).toBe(0);
  });

  test('should have DEBUG with value 1', () => {
    expect(LogLevelPriority.DEBUG).toBe(1);
  });

  test('should have INFO with value 2', () => {
    expect(LogLevelPriority.INFO).toBe(2);
  });

  test('should have NOTICE with value 3', () => {
    expect(LogLevelPriority.NOTICE).toBe(3);
  });

  test('should have WARNING with value 4', () => {
    expect(LogLevelPriority.WARNING).toBe(4);
  });

  test('should have ERROR with value 5', () => {
    expect(LogLevelPriority.ERROR).toBe(5);
  });

  test('should have CRITICAL with value 6', () => {
    expect(LogLevelPriority.CRITICAL).toBe(6);
  });

  test('should have ALERT with value 7', () => {
    expect(LogLevelPriority.ALERT).toBe(7);
  });

  test('should have EMERGENCY with value 8', () => {
    expect(LogLevelPriority.EMERGENCY).toBe(8);
  });

  test('should have values in ascending order', () => {
    expect(LogLevelPriority.NONE).toBeLessThan(LogLevelPriority.DEBUG);
    expect(LogLevelPriority.DEBUG).toBeLessThan(LogLevelPriority.INFO);
    expect(LogLevelPriority.INFO).toBeLessThan(LogLevelPriority.NOTICE);
    expect(LogLevelPriority.NOTICE).toBeLessThan(LogLevelPriority.WARNING);
    expect(LogLevelPriority.WARNING).toBeLessThan(LogLevelPriority.ERROR);
    expect(LogLevelPriority.ERROR).toBeLessThan(LogLevelPriority.CRITICAL);
    expect(LogLevelPriority.CRITICAL).toBeLessThan(LogLevelPriority.ALERT);
    expect(LogLevelPriority.ALERT).toBeLessThan(LogLevelPriority.EMERGENCY);
  });
});
