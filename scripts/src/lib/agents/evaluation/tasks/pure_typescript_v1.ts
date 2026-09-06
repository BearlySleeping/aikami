// scripts/src/lib/agents/evaluation/tasks/pure_typescript_v1.ts
//
// C-480 AC-1: pure_typescript task — implement a small pure function against
// a stub. Acceptance dynamically imports the candidate's module and checks
// behavior, never its source text.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AcceptanceOutcome, EvalTask } from '../types.ts';

const TARGET = 'unique_sorted.ts';

const BASE_SOURCE = `// Return the distinct values of \`values\`, sorted ascending.
// TODO: implement.
export const uniqueSorted = (values: number[]): number[] => {
  throw new Error('not implemented');
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
  const fn = mod.uniqueSorted;
  if (typeof fn !== 'function') {
    return { accepted: false, diagnostics: 'uniqueSorted must remain an exported function.' };
  }

  const cases: Array<{ input: number[]; expected: number[] }> = [
    { input: [3, 1, 2, 1, 3], expected: [1, 2, 3] },
    { input: [], expected: [] },
    { input: [-1, -1, 0, 5], expected: [-1, 0, 5] },
  ];

  for (const { input, expected } of cases) {
    let result: unknown;
    try {
      result = (fn as (values: number[]) => number[])([...input]);
    } catch (err) {
      return { accepted: false, diagnostics: `Threw on ${JSON.stringify(input)}: ${String(err)}` };
    }
    if (JSON.stringify(result) !== JSON.stringify(expected)) {
      return {
        accepted: false,
        diagnostics: `uniqueSorted(${JSON.stringify(input)}) => ${JSON.stringify(result)}, expected ${JSON.stringify(expected)}`,
      };
    }
  }
  return { accepted: true, diagnostics: '' };
};

export const task: EvalTask = {
  id: 'pure_typescript_v1',
  version: 1,
  category: 'pure_typescript',
  description: 'Implement uniqueSorted(): distinct values, ascending, no external dependencies.',
  base: { [TARGET]: BASE_SOURCE },
  prompt: `Implement uniqueSorted() in ${TARGET} per the doc comment. Keep it a pure function.`,
  heldOut: false,
  acceptance,
};
