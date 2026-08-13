import { describe, expect, test } from 'bun:test';
import { unixLabel } from '@aikami/constants';
import type { CoreData } from '@aikami/types';
import { fromJsonData } from './transform.ts';

interface TestData extends Omit<CoreData, 'createdAt'> {
  id: string;
  name: string;
  value: number;
  updatedAt?: Date;
  complex?: {
    nestedValue: string;
    nestedDate?: Date;
  };
  items?: { name: string; date?: Date }[];
  /** Regression: key contains the unixLabel earlier (lastUnixUpdatedUnix). */
  lastUnixUpdated?: Date;
}

describe('fromJsonData', () => {
  test('should convert Unix timestamps to Date instances', () => {
    const now = Date.now();
    const rawData = {
      id: 'test1',
      name: 'Test Object',
      value: 123,
      [`updatedAt${unixLabel}`]: now,
      complex: {
        nestedValue: 'hello',
        [`nestedDate${unixLabel}`]: now - 10000,
      },
      items: [{ name: 'item1', [`date${unixLabel}`]: now - 20000 }, { name: 'item2' }],
    };

    const result = fromJsonData<TestData>(rawData);

    expect(result.id).toBe('test1');
    expect(result.name).toBe('Test Object');
    expect(result.value).toBe(123);
    expect(result.updatedAt?.getTime()).toBe(now);
    expect(result.complex?.nestedValue).toBe('hello');
    expect(result.complex?.nestedDate?.getTime()).toBe(now - 10000);
    expect(result.items?.length).toBe(2);
    expect(result.items?.[0]?.name).toBe('item1');
    expect(result.items?.[0]?.date?.getTime()).toBe(now - 20000);
    expect(result.items?.[1]?.name).toBe('item2');
    expect(result.items?.[1]?.date).toBeUndefined();
  });

  test('should handle data without timestamps', () => {
    const rawData = {
      id: 'test2',
      name: 'No Timestamps',
      value: 456,
    };

    const result = fromJsonData<TestData>(rawData);

    expect(result.id).toBe('test2');
    expect(result.name).toBe('No Timestamps');
    expect(result.value).toBe(456);
  });

  test('should handle nested objects without timestamps', () => {
    const rawData = {
      id: 'test3',
      name: 'Nested No Timestamps',
      value: 789,
      complex: {
        nestedValue: 'world',
      },
    };

    const result = fromJsonData<TestData>(rawData);

    expect(result.id).toBe('test3');
    expect(result.name).toBe('Nested No Timestamps');
    expect(result.value).toBe(789);
    expect(result.complex?.nestedValue).toBe('world');
  });

  test('should handle arrays of objects with and without timestamps', () => {
    const now = Date.now();
    const rawData = {
      id: 'test4',
      name: 'Array Test',
      value: 101,
      items: [
        { name: 'itemA', [`date${unixLabel}`]: now },
        { name: 'itemB' },
        { name: 'itemC', [`date${unixLabel}`]: now - 5000 },
      ],
    };

    const result = fromJsonData<TestData>(rawData);

    expect(result.items?.length).toBe(3);
    expect(result.items?.[0].name).toBe('itemA');
    expect(result.items?.[0].date?.getTime()).toBe(now);
    expect(result.items?.[1].name).toBe('itemB');
    expect(result.items?.[1].date).toBeUndefined();
    expect(result.items?.[2].name).toBe('itemC');
    expect(result.items?.[2].date?.getTime()).toBe(now - 5000);
  });

  test('should return an empty object for empty input', () => {
    const rawData = {};
    const result = fromJsonData<TestData>(rawData);
    expect(Object.keys(result).length).toBe(0);
  });

  test('strips only the trailing unixLabel suffix, preserving earlier occurrences', () => {
    const now = Date.now();
    const rawData = {
      id: 'test5',
      name: 'Trailing Suffix Test',
      [`lastUnixUpdated${unixLabel}`]: now,
    };

    const result = fromJsonData<TestData>(rawData);

    // `lastUnixUpdatedUnix` → `lastUnixUpdated` (only the trailing "Unix" is
    // removed — the earlier occurrence inside the name is preserved).
    expect(result.lastUnixUpdated?.getTime()).toBe(now);
    expect('lastUpdatedUnix' in result).toBe(false);
  });
});
