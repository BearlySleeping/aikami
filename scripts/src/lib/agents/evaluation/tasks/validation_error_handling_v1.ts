// scripts/src/lib/agents/evaluation/tasks/validation_error_handling_v1.ts
//
// C-480 AC-1: validation/error-handling task — a parser must reject invalid
// input with a specific error rather than silently returning a bad value.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AcceptanceOutcome, EvalTask } from '../types.ts';

const TARGET = 'parse_port.ts';

const BASE_SOURCE = `// Parse a TCP port number from a string. Must be an integer in [1, 65535].
// Currently accepts anything Number() accepts, including NaN-adjacent junk
// and out-of-range values — that is the bug to fix.
export const parsePort = (raw: string): number => {
  return Number(raw);
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
  const fn = mod.parsePort;
  if (typeof fn !== 'function') {
    return { accepted: false, diagnostics: 'parsePort must remain an exported function.' };
  }
  const call = fn as (raw: string) => number;

  const validCases: Array<[string, number]> = [
    ['80', 80],
    ['65535', 65535],
    ['1', 1],
  ];
  for (const [input, expected] of validCases) {
    let result: unknown;
    try {
      result = call(input);
    } catch (err) {
      return { accepted: false, diagnostics: `Threw on valid input "${input}": ${String(err)}` };
    }
    if (result !== expected) {
      return {
        accepted: false,
        diagnostics: `parsePort("${input}") => ${String(result)}, expected ${expected}`,
      };
    }
  }

  const invalidCases = ['0', '65536', '-1', 'abc', '3.5', ''];
  for (const input of invalidCases) {
    let threw = false;
    try {
      call(input);
    } catch {
      threw = true;
    }
    if (!threw) {
      return {
        accepted: false,
        diagnostics: `parsePort("${input}") must throw — invalid port did not raise an error.`,
      };
    }
  }
  return { accepted: true, diagnostics: '' };
};

export const task: EvalTask = {
  id: 'validation_error_handling_v1',
  version: 1,
  category: 'validation_error_handling',
  description: 'Fix parsePort() to validate its input and throw on anything outside [1, 65535].',
  base: { [TARGET]: BASE_SOURCE },
  prompt: `Fix parsePort() in ${TARGET} to throw on any input that is not an integer in [1, 65535].`,
  heldOut: false,
  acceptance,
};
