// scripts/src/lib/agents/evaluation/tasks/validation_error_handling_v1.ts
//
// C-480 AC-1: validation/error-handling task — a parser must reject invalid
// input with a specific error rather than silently returning a bad value.

import { candidateRunnerFingerprint, runCandidateTest } from '../candidate_runner.ts';
import type { AcceptanceOutcome, EvalTask } from '../types.ts';

const TARGET = 'parse_port.ts';

const BASE_SOURCE = `// Parse a TCP port number from a string. Must be an integer in [1, 65535].
// Currently accepts anything Number() accepts, including NaN-adjacent junk
// and out-of-range values — that is the bug to fix.
export const parsePort = (raw: string): number => {
  return Number(raw);
};
`;

const ACCEPTANCE_TEST_SOURCE = `
const fn = candidate.parsePort;
if (typeof fn !== 'function') {
  return { accepted: false, diagnostics: 'parsePort must remain an exported function.' };
}
for (const [input, expected] of [['80', 80], ['65535', 65535], ['1', 1]]) {
  try {
    const result = fn(input);
    if (result !== expected) {
      return { accepted: false, diagnostics: 'parsePort("' + input + '") => ' + String(result) + ', expected ' + expected };
    }
  } catch (error) {
    return { accepted: false, diagnostics: 'Threw on valid input "' + input + '": ' + String(error) };
  }
}
for (const input of ['0', '65536', '-1', 'abc', '3.5', '']) {
  let threw = false;
  try { fn(input); } catch { threw = true; }
  if (!threw) {
    return { accepted: false, diagnostics: 'parsePort("' + input + '") must throw — invalid port did not raise an error.' };
  }
}
return { accepted: true, diagnostics: '' };
`;

const acceptance = (sandboxPath: string): Promise<AcceptanceOutcome> =>
  runCandidateTest({ sandboxPath, target: TARGET, testSource: ACCEPTANCE_TEST_SOURCE });

export const task: EvalTask = {
  id: 'validation_error_handling_v1',
  version: 1,
  category: 'validation_error_handling',
  description: 'Fix parsePort() to validate its input and throw on anything outside [1, 65535].',
  base: { [TARGET]: BASE_SOURCE },
  prompt: `Fix parsePort() in ${TARGET} to throw on any input that is not an integer in [1, 65535].`,
  heldOut: false,
  acceptance,
  acceptanceDependencies: [candidateRunnerFingerprint(), TARGET, ACCEPTANCE_TEST_SOURCE],
};
