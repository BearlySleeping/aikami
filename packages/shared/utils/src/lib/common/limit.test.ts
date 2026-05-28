import { describe, expect, test } from 'bun:test';
import { runFunctions } from './limit.ts';

describe('runFunctions', () => {
  test('should run functions sequentially when concurrency is 1', async () => {
    const results: number[] = [];
    const functions = [
      async () => {
        results.push(1);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 1;
      },
      async () => {
        results.push(2);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 2;
      },
      async () => {
        results.push(3);
        return 3;
      },
    ];

    const result = await runFunctions(functions, 1);

    expect(result).toEqual([1, 2, 3]);
    expect(results).toEqual([1, 2, 3]);
  });

  test('should run functions concurrently with given concurrency limit', async () => {
    const order: number[] = [];

    const functions = [
      async () => {
        order.push(1);
        await new Promise((resolve) => setTimeout(resolve, 100));
        order.push(4);
        return 1;
      },
      async () => {
        order.push(2);
        await new Promise((resolve) => setTimeout(resolve, 50));
        order.push(3);
        return 2;
      },
    ];

    const result = await runFunctions(functions, 2);

    expect(result).toEqual([1, 2]);
    // With concurrency 2, both start together, then second finishes first
    expect(order).toEqual([1, 2, 3, 4]);
  });

  test('should handle empty array', async () => {
    const result = await runFunctions([], 2);
    expect(result).toEqual([]);
  });

  test('should handle single function', async () => {
    const fn = async () => 42;
    const result = await runFunctions([fn], 3);
    expect(result).toEqual([42]);
  });

  test('should throw error for concurrency less than 1', async () => {
    const functions = [async () => 1];

    await expect(runFunctions(functions, 0)).rejects.toThrow('Concurrency must be at least 1.');
    await expect(runFunctions(functions, -1)).rejects.toThrow('Concurrency must be at least 1.');
  });

  test('should propagate errors from functions', async () => {
    const functions = [
      async () => 1,
      async () => {
        throw new Error('Function error');
      },
    ];

    await expect(runFunctions(functions, 2)).rejects.toThrow('Function error');
  });

  test('should maintain order of results regardless of completion order', async () => {
    const functions = [
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'slow';
      },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'fast';
      },
    ];

    const result = await runFunctions(functions, 2);
    expect(result).toEqual(['slow', 'fast']);
  });
});
