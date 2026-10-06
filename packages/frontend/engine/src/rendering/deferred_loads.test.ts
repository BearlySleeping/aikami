// packages/frontend/engine/src/rendering/deferred_loads.test.ts

import { describe, expect, test } from 'bun:test';
import { createDeferredLoadRegistry, type DeferredLoadRegistry } from './deferred_loads.ts';

/** A load whose resolution the test controls. */
const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (r: unknown) => void;
} => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeRegistry = (): DeferredLoadRegistry<number, string> =>
  createDeferredLoadRegistry<number, string>();

describe('DeferredLoadRegistry — single flight', () => {
  test('concurrent calls for one key share a single load and a single commit', async () => {
    const registry = makeRegistry();
    const gate = deferred<string>();
    const commits: string[] = [];
    let loads = 0;

    const load = (): Promise<string> => {
      loads++;
      return gate.promise;
    };

    const first = registry.run({ key: 7, load, commit: (v) => commits.push(v) });
    const second = registry.run({ key: 7, load, commit: (v) => commits.push(v) });
    const third = registry.run({ key: 7, load, commit: (v) => commits.push(v) });
    expect(registry.inFlightCount).toBe(1);

    gate.resolve('texture');
    expect(await Promise.all([first, second, third])).toEqual(['texture', 'texture', 'texture']);
    // The defect this guards: three decodes of one asset and three accounting
    // entries for a single texture.
    expect(loads).toBe(1);
    expect(commits).toEqual(['texture']);
    expect(registry.inFlightCount).toBe(0);
  });

  test('distinct keys never share a load', async () => {
    const registry = makeRegistry();
    const commits: Array<[number, string]> = [];
    let loads = 0;
    const load = (value: string) => async (): Promise<string> => {
      loads++;
      return value;
    };

    await Promise.all([
      registry.run({ key: 1, load: load('a'), commit: (v) => commits.push([1, v]) }),
      registry.run({ key: 2, load: load('b'), commit: (v) => commits.push([2, v]) }),
    ]);

    expect(loads).toBe(2);
    expect(commits).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  test('a rejected load clears the key so the next caller retries', async () => {
    const registry = makeRegistry();
    const commits: string[] = [];
    let attempts = 0;

    const flaky = async (): Promise<string> => {
      attempts++;
      if (attempts === 1) {
        throw new Error('decode failed');
      }
      return 'recovered';
    };

    await expect(
      registry.run({ key: 3, load: flaky, commit: (v) => commits.push(v) }),
    ).rejects.toThrow('decode failed');
    expect(commits).toEqual([]);

    expect(await registry.run({ key: 3, load: flaky, commit: (v) => commits.push(v) })).toBe(
      'recovered',
    );
    expect(attempts).toBe(2);
    expect(commits).toEqual(['recovered']);
  });

  test('invalidate detaches pending work so nothing commits afterwards', async () => {
    const registry = makeRegistry();
    const gate = deferred<string>();
    const commits: string[] = [];

    const pending = registry.run({
      key: 9,
      load: () => gate.promise,
      commit: (v) => commits.push(v),
    });
    registry.invalidate();
    expect(registry.inFlightCount).toBe(0);

    gate.resolve('late');
    // The caller still gets the value it asked for — the work really ran.
    expect(await pending).toBe('late');
    // But the cache it would have been published into is gone.
    expect(commits).toEqual([]);
  });

  test.each(['resolve', 'reject'] as const)(
    'an old load that settles via %s preserves the newer in-flight entry',
    async (settlement) => {
      const registry = makeRegistry();
      const oldGate = deferred<string>();
      const newGate = deferred<string>();
      const oldLoad = registry.run({ key: 1, load: () => oldGate.promise, commit: () => {} });
      const oldOutcome = oldLoad.catch(() => 'rejected');
      registry.invalidate();
      const options = { key: 1, load: () => newGate.promise, commit: () => {} };
      const newLoad = registry.run(options);

      if (settlement === 'resolve') {
        oldGate.resolve('old');
      } else {
        oldGate.reject(new Error('old failure'));
      }
      await oldOutcome;
      expect(registry.inFlightCount).toBe(1);
      expect(registry.run(options)).toBe(newLoad);

      newGate.resolve('new');
      expect(await newLoad).toBe('new');
      expect(registry.inFlightCount).toBe(0);
    },
  );

  test('after invalidate a new load still runs but still never commits', async () => {
    const registry = makeRegistry();
    const commits: string[] = [];
    registry.invalidate();

    expect(
      await registry.run({
        key: 1,
        load: async () => 'value',
        commit: (v) => commits.push(v),
      }),
    ).toBe('value');
    expect(commits).toEqual([]);
  });

  test('the in-flight slot is reused after a load settles', async () => {
    const registry = makeRegistry();
    let loads = 0;
    const load = async (): Promise<string> => {
      loads++;
      return `load-${loads}`;
    };

    expect(await registry.run({ key: 1, load, commit: () => {} })).toBe('load-1');
    expect(await registry.run({ key: 1, load, commit: () => {} })).toBe('load-2');
    expect(loads).toBe(2);
  });
});
