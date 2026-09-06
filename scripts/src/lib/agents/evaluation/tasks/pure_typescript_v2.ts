// scripts/src/lib/agents/evaluation/tasks/pure_typescript_v2.ts
//
// C-480 AC-1: held-out pure_typescript task. Excluded from any report used
// to justify a routing change — reserved to catch overfitting to the
// visible task set.

import { candidateRunnerFingerprint, runCandidateTest } from '../candidate_runner.ts';
import type { AcceptanceOutcome, EvalTask } from '../types.ts';

const TARGET = 'group_by.ts';

const BASE_SOURCE = `// Group \`items\` by the string key \`keyOf\` returns for each item.
// TODO: implement.
export const groupBy = <T>(items: T[], keyOf: (item: T) => string): Record<string, T[]> => {
  throw new Error('not implemented');
};
`;

const ACCEPTANCE_TEST_SOURCE = `
const fn = candidate.groupBy;
if (typeof fn !== 'function') {
  return { accepted: false, diagnostics: 'groupBy must remain an exported function.' };
}
try {
  const result = fn([1, 2, 3, 4, 5], (item) => item % 2 === 0 ? 'even' : 'odd');
  const expected = { odd: [1, 3, 5], even: [2, 4] };
  if (JSON.stringify(result) !== JSON.stringify(expected)) {
    return { accepted: false, diagnostics: 'groupBy(...) => ' + JSON.stringify(result) + ', expected ' + JSON.stringify(expected) };
  }
} catch (error) {
  return { accepted: false, diagnostics: 'Threw: ' + String(error) };
}
return { accepted: true, diagnostics: '' };
`;

const acceptance = (sandboxPath: string): Promise<AcceptanceOutcome> =>
  runCandidateTest({ sandboxPath, target: TARGET, testSource: ACCEPTANCE_TEST_SOURCE });

export const task = {
  id: 'pure_typescript_v2',
  version: 1,
  category: 'pure_typescript',
  description: 'Held-out variant: implement groupBy(), a pure grouping function.',
  base: { [TARGET]: BASE_SOURCE },
  prompt: `Implement groupBy() in ${TARGET} per the doc comment. Keep it a pure function.`,
  heldOut: true,
  acceptance,
  acceptanceDependencies: [candidateRunnerFingerprint(), TARGET, ACCEPTANCE_TEST_SOURCE],
} as const satisfies EvalTask;
