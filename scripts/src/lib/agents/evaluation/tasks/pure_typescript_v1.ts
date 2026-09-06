// scripts/src/lib/agents/evaluation/tasks/pure_typescript_v1.ts
//
// C-480 AC-1: pure_typescript task — implement a small pure function against
// a stub. Acceptance imports the candidate in a restricted subprocess and
// checks behavior, never its source text.

import { candidateRunnerFingerprint, runCandidateTest } from '../candidate_runner.ts';
import type { AcceptanceOutcome, EvalTask } from '../types.ts';

const TARGET = 'unique_sorted.ts';

const BASE_SOURCE = `// Return the distinct values of \`values\`, sorted ascending.
// TODO: implement.
export const uniqueSorted = (values: number[]): number[] => {
  throw new Error('not implemented');
};
`;

const ACCEPTANCE_TEST_SOURCE = `
const fn = candidate.uniqueSorted;
if (typeof fn !== 'function') {
  return { accepted: false, diagnostics: 'uniqueSorted must remain an exported function.' };
}
const cases = [
  { input: [3, 1, 2, 1, 3], expected: [1, 2, 3] },
  { input: [], expected: [] },
  { input: [-1, -1, 0, 5], expected: [-1, 0, 5] },
];
for (const { input, expected } of cases) {
  const snapshot = JSON.stringify(input);
  try {
    const result = fn(input);
    if (JSON.stringify(input) !== snapshot) {
      return { accepted: false, diagnostics: 'uniqueSorted mutated its input for ' + snapshot };
    }
    if (JSON.stringify(result) !== JSON.stringify(expected)) {
      return { accepted: false, diagnostics: 'uniqueSorted(' + snapshot + ') => ' + JSON.stringify(result) + ', expected ' + JSON.stringify(expected) };
    }
  } catch (error) {
    return { accepted: false, diagnostics: 'Threw on ' + snapshot + ': ' + String(error) };
  }
}
return { accepted: true, diagnostics: '' };
`;

const acceptance = (sandboxPath: string): Promise<AcceptanceOutcome> =>
  runCandidateTest({ sandboxPath, target: TARGET, testSource: ACCEPTANCE_TEST_SOURCE });

export const task: EvalTask = {
  id: 'pure_typescript_v1',
  version: 1,
  category: 'pure_typescript',
  description: 'Implement uniqueSorted(): distinct values, ascending, no external dependencies.',
  base: { [TARGET]: BASE_SOURCE },
  prompt: `Implement uniqueSorted() in ${TARGET} per the doc comment. Keep it a pure function.`,
  heldOut: false,
  acceptance,
  acceptanceDependencies: [candidateRunnerFingerprint(), TARGET, ACCEPTANCE_TEST_SOURCE],
};
