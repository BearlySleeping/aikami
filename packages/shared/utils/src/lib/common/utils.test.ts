import { describe, expect, test } from 'bun:test';
import {
  chunkArray,
  clamp,
  debounce,
  delay,
  exists,
  getCurrentUnixTime,
  getDateFromUnixTime,
  isEmptyObject,
  isEqualArray,
  isEqualObject,
  isSwarmReady,
  shuffle,
  toDisplayUsername,
  toFixedNumber,
  toInitials,
  toPercentage,
} from './utils.ts';

describe('isEqualArray', () => {
  test('should return true for equal arrays', () => {
    expect(isEqualArray([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(isEqualArray(['a', 'b'], ['a', 'b'])).toBe(true);
  });

  test('should return true for equal arrays in different order', () => {
    expect(isEqualArray([1, 2, 3], [3, 1, 2])).toBe(true);
  });

  test('should return false for arrays with different lengths', () => {
    expect(isEqualArray([1, 2], [1, 2, 3])).toBe(false);
  });

  test('should return false for arrays with different values', () => {
    expect(isEqualArray([1, 2, 3], [1, 2, 4])).toBe(false);
  });

  test('should handle undefined arrays', () => {
    expect(isEqualArray(undefined, undefined)).toBe(true);
    expect(isEqualArray([1], undefined)).toBe(false);
    expect(isEqualArray(undefined, [1])).toBe(false);
  });
});

describe('isEqualObject', () => {
  test('should return true for equal objects', () => {
    expect(isEqualObject({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  test('should return false for objects with different keys', () => {
    expect(isEqualObject({ a: 1 }, { b: 1 })).toBe(false);
  });

  test('should return false for objects with different values', () => {
    expect(isEqualObject({ a: 1 }, { a: 2 })).toBe(false);
  });

  test('should handle undefined objects', () => {
    expect(isEqualObject(undefined, undefined)).toBe(true);
    expect(isEqualObject({}, undefined)).toBe(false);
  });
});

describe('isEmptyObject', () => {
  test('should return true for empty object', () => {
    expect(isEmptyObject({})).toBe(true);
  });

  test('should return false for non-empty object', () => {
    expect(isEmptyObject({ a: 1 })).toBe(false);
  });
});

describe('exists', () => {
  test('should return true for non-nullish values', () => {
    expect(exists(0)).toBe(true);
    expect(exists('')).toBe(true);
    expect(exists(false)).toBe(true);
    expect(exists({})).toBe(true);
    expect(exists([])).toBe(true);
  });

  test('should return false for nullish values', () => {
    expect(exists(null)).toBe(false);
    expect(exists(undefined)).toBe(false);
  });
});

describe('shuffle', () => {
  test('should return array with same length', () => {
    const original = [1, 2, 3, 4, 5];
    const shuffled = shuffle(original);
    expect(shuffled.length).toBe(original.length);
  });

  test('should contain all original elements', () => {
    const original = [1, 2, 3, 4, 5];
    const shuffled = shuffle(original);
    expect(shuffled.sort()).toEqual(original.sort());
  });

  test('should not mutate original array', () => {
    const original = [1, 2, 3, 4, 5];
    const copy = [...original];
    shuffle(original);
    expect(original).toEqual(copy);
  });
});

describe('delay', () => {
  test('should resolve after specified time', async () => {
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });
});

describe('debounce', async () => {
  test('should debounce function calls', async () => {
    let callCount = 0;
    const debouncedFn = debounce(() => {
      callCount++;
    }, 50);

    debouncedFn();
    debouncedFn();
    debouncedFn();

    expect(callCount).toBe(0);

    await delay(100);
    expect(callCount).toBe(1);
  });
});

describe('toFixedNumber', () => {
  test('should round to specified decimal places', () => {
    expect(toFixedNumber(1.23456, 2)).toBe(1.23);
    expect(toFixedNumber(1.235, 2)).toBe(1.24);
    expect(toFixedNumber(1.2, 0)).toBe(1);
  });
});

describe('clamp', () => {
  test('should clamp value within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('toInitials', () => {
  test('should return initials from name', () => {
    expect(toInitials('John Doe')).toBe('JD');
    expect(toInitials('John Michael Doe')).toBe('JD');
  });

  test('should handle single name - returns same letter twice', () => {
    // When there's only one name, first and last are the same, so it returns the same letter twice
    expect(toInitials('Alice')).toBe('AA');
  });

  test('should handle empty string', () => {
    expect(toInitials('')).toBe('');
  });
});

describe('toDisplayUsername', () => {
  test('should return displayName when provided', () => {
    expect(toDisplayUsername({ displayName: 'John' })).toBe('John');
  });

  test('should combine first and last name', () => {
    expect(toDisplayUsername({ firstName: 'John', lastName: 'Doe' })).toBe('John Doe');
  });

  test('should handle firstname/lastname alternative keys', () => {
    expect(toDisplayUsername({ firstname: 'John', lastname: 'Doe' })).toBe('John Doe');
  });

  test('should derive from email when no name provided', () => {
    expect(toDisplayUsername({ email: 'john@example.com' })).toBe('John');
  });

  test('should return empty string when nothing provided', () => {
    expect(toDisplayUsername({})).toBe('');
  });
});

describe('chunkArray', () => {
  test('should chunk array into smaller arrays', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test('should handle array smaller than chunk size', () => {
    expect(chunkArray([1, 2], 5)).toEqual([[1, 2]]);
  });

  test('should handle empty array', () => {
    expect(chunkArray([], 2)).toEqual([]);
  });
});

describe('toPercentage', () => {
  test('should convert decimal to percentage string', () => {
    expect(toPercentage(0.5)).toBe('50%');
    expect(toPercentage(1)).toBe('100%');
    expect(toPercentage(0)).toBe('0%');
    expect(toPercentage(0.123)).toBe('12%');
  });
});

describe('getDateFromUnixTime', () => {
  test('should convert unix timestamp to Date', () => {
    const date = getDateFromUnixTime(0);
    expect(date.toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('isSwarmReady', () => {
  test('should return true', () => {
    expect(isSwarmReady()).toBe(true);
  });
});

describe('getCurrentUnixTime', () => {
  test('should return current unix time in seconds', () => {
    const before = Math.floor(Date.now() / 1000);
    const now = getCurrentUnixTime();
    const after = Math.floor(Date.now() / 1000);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeGreaterThanOrEqual(after - 1);
  });
});
