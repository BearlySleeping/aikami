// scripts/src/lib/agents/evaluation/tasks/process_concurrency_v1.ts
//
// C-480 AC-1: process/concurrency task — a deterministic lost-update race.
// Every worker reads `counter`, yields to the microtask queue, then writes
// `current + 1`. Since all workers' synchronous prefixes run before any
// `await` resolves, they all read 0 and the final count is 1 regardless of
// `count` — not flaky, reliably wrong. The fix must not read-then-await-
// then-write shared state.

import { candidateRunnerFingerprint, runCandidateTest } from '../candidate_runner.ts';
import type { AcceptanceOutcome, EvalTask } from '../types.ts';

const TARGET = 'concurrent_counter.ts';

const BASE_SOURCE = `// Run \`count\` concurrent increments against a shared counter and return
// the final value. Every worker must call the supplied operation exactly once,
// and the final value must equal \`count\` — no skipped work or lost updates.
export const incrementAllConcurrently = async (
  count: number,
  increment: () => Promise<void>,
): Promise<number> => {
  let counter = 0;
  const workers = Array.from({ length: count }, async () => {
    const current = counter;
    await increment();
    counter = current + 1;
  });
  await Promise.all(workers);
  return counter;
};
`;

const ACCEPTANCE_TEST_SOURCE = `
const fn = candidate.incrementAllConcurrently;
if (typeof fn !== 'function') {
  return { accepted: false, diagnostics: 'incrementAllConcurrently must remain an exported function.' };
}
for (const count of [1, 10, 50]) {
  let invocationCount = 0;
  const increment = async () => {
    invocationCount += 1;
    await Promise.resolve();
  };
  try {
    const result = await fn(count, increment);
    if (invocationCount !== count) {
      return { accepted: false, diagnostics: 'increment callback ran ' + invocationCount + ' times for count=' + count + ', expected exactly ' + count + '.' };
    }
    if (result !== count) {
      return { accepted: false, diagnostics: 'incrementAllConcurrently(' + count + ') => ' + result + ', expected ' + count + ' (lost update).' };
    }
  } catch (error) {
    return { accepted: false, diagnostics: 'Threw for count=' + count + ': ' + String(error) };
  }
}
return { accepted: true, diagnostics: '' };
`;

const acceptance = (sandboxPath: string): Promise<AcceptanceOutcome> =>
  runCandidateTest({ sandboxPath, target: TARGET, testSource: ACCEPTANCE_TEST_SOURCE });

export const task: EvalTask = {
  id: 'process_concurrency_v1',
  version: 1,
  category: 'process_concurrency',
  description: 'Fix a deterministic lost-update race in concurrent counter increments.',
  base: { [TARGET]: BASE_SOURCE },
  prompt: `incrementAllConcurrently() in ${TARGET} loses updates under concurrency. Fix it so every worker invokes the supplied increment operation exactly once and the final count always equals the requested count.`,
  heldOut: false,
  acceptance,
  acceptanceDependencies: [candidateRunnerFingerprint(), TARGET, ACCEPTANCE_TEST_SOURCE],
};
