// scripts/src/lib/agents/evaluation/tasks/validation_error_handling_v2.ts
//
// C-480 AC-1: held-out validation/error-handling task.

import { candidateRunnerFingerprint, runCandidateTest } from '../candidate_runner.ts';
import type { AcceptanceOutcome, EvalTask } from '../types.ts';

const TARGET = 'parse_hex_color.ts';

const BASE_SOURCE = `// Parse a "#rrggbb" hex color string into { r, g, b } (0-255 each).
// Currently accepts any string starting with "#" regardless of length or
// character validity — that is the bug to fix.
export const parseHexColor = (raw: string): { r: number; g: number; b: number } => {
  const hex = raw.slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16) || 0,
    g: Number.parseInt(hex.slice(2, 4), 16) || 0,
    b: Number.parseInt(hex.slice(4, 6), 16) || 0,
  };
};
`;

const ACCEPTANCE_TEST_SOURCE = `
const fn = candidate.parseHexColor;
if (typeof fn !== 'function') {
  return { accepted: false, diagnostics: 'parseHexColor must remain an exported function.' };
}
try {
  const result = fn('#ff00aa');
  if (JSON.stringify(result) !== JSON.stringify({ r: 255, g: 0, b: 170 })) {
    return { accepted: false, diagnostics: 'parseHexColor("#ff00aa") => ' + JSON.stringify(result) };
  }
} catch (error) {
  return { accepted: false, diagnostics: 'Threw on valid input: ' + String(error) };
}
for (const input of ['#fff', '#gggggg', 'ff00aa', '#ff00aaff', '']) {
  let threw = false;
  try { fn(input); } catch { threw = true; }
  if (!threw) {
    return { accepted: false, diagnostics: 'parseHexColor("' + input + '") must throw — invalid color did not raise an error.' };
  }
}
return { accepted: true, diagnostics: '' };
`;

const acceptance = (sandboxPath: string): Promise<AcceptanceOutcome> =>
  runCandidateTest({ sandboxPath, target: TARGET, testSource: ACCEPTANCE_TEST_SOURCE });

export const task = {
  id: 'validation_error_handling_v2',
  version: 1,
  category: 'validation_error_handling',
  description: 'Held-out variant: fix parseHexColor() to validate its input strictly.',
  base: { [TARGET]: BASE_SOURCE },
  prompt: `Fix parseHexColor() in ${TARGET} to throw on any string that is not exactly "#" + 6 hex digits.`,
  heldOut: true,
  acceptance,
  acceptanceDependencies: [candidateRunnerFingerprint(), TARGET, ACCEPTANCE_TEST_SOURCE],
} as const satisfies EvalTask;
