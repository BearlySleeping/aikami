// scripts/src/lib/agents/evaluation/tasks/process_concurrency_v1.ts
//
// C-480 AC-1: process/concurrency task — a deterministic lost-update race.
// Every worker reads `counter`, yields to the microtask queue, then writes
// `current + 1`. Since all workers' synchronous prefixes run before any
// `await` resolves, they all read 0 and the final count is 1 regardless of
// `count` — not flaky, reliably wrong. The fix must not read-then-await-
// then-write shared state.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AcceptanceOutcome, EvalTask } from '../types.ts';

const TARGET = 'concurrent_counter.ts';

const BASE_SOURCE = `// Run \`count\` concurrent "increments" against a shared counter and return
// the final value. Must equal \`count\` — no lost updates.
export const incrementAllConcurrently = async (count: number): Promise<number> => {
  let counter = 0;
  const workers = Array.from({ length: count }, async () => {
    const current = counter;
    await Promise.resolve();
    counter = current + 1;
  });
  await Promise.all(workers);
  return counter;
};
`;

const importFresh = async (path: string): Promise<Record<string, unknown>> =>
  (await import(`${pathToFileURL(path).href}?t=${Date.now()}-${Math.random()}`)) as Record<
    string,
    unknown
  >;

const acceptance = async (sandboxPath: string): Promise<AcceptanceOutcome> => {
  let mod: Record<string, unknown>;
  try {
    mod = await importFresh(join(sandboxPath, TARGET));
  } catch (err) {
    return { accepted: false, diagnostics: `Module failed to import: ${String(err)}` };
  }
  const fn = mod.incrementAllConcurrently;
  if (typeof fn !== 'function') {
    return {
      accepted: false,
      diagnostics: 'incrementAllConcurrently must remain an exported function.',
    };
  }
  const call = fn as (count: number) => Promise<number>;

  for (const count of [1, 10, 50]) {
    let result: number;
    try {
      result = await call(count);
    } catch (err) {
      return { accepted: false, diagnostics: `Threw for count=${count}: ${String(err)}` };
    }
    if (result !== count) {
      return {
        accepted: false,
        diagnostics: `incrementAllConcurrently(${count}) => ${result}, expected ${count} (lost update).`,
      };
    }
  }
  return { accepted: true, diagnostics: '' };
};

export const task: EvalTask = {
  id: 'process_concurrency_v1',
  version: 1,
  category: 'process_concurrency',
  description: 'Fix a deterministic lost-update race in concurrent counter increments.',
  base: { [TARGET]: BASE_SOURCE },
  prompt: `incrementAllConcurrently() in ${TARGET} loses updates under concurrency. Fix it so the final count always equals the requested count.`,
  heldOut: false,
  acceptance,
};
