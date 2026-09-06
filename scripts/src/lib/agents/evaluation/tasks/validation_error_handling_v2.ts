// scripts/src/lib/agents/evaluation/tasks/validation_error_handling_v2.ts
//
// C-480 AC-1: held-out validation/error-handling task.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  const fn = mod.parseHexColor;
  if (typeof fn !== 'function') {
    return { accepted: false, diagnostics: 'parseHexColor must remain an exported function.' };
  }
  const call = fn as (raw: string) => { r: number; g: number; b: number };

  let ok: unknown;
  try {
    ok = call('#ff00aa');
  } catch (err) {
    return { accepted: false, diagnostics: `Threw on valid input: ${String(err)}` };
  }
  if (JSON.stringify(ok) !== JSON.stringify({ r: 255, g: 0, b: 170 })) {
    return { accepted: false, diagnostics: `parseHexColor("#ff00aa") => ${JSON.stringify(ok)}` };
  }

  const invalidCases = ['#fff', '#gggggg', 'ff00aa', '#ff00aaff', ''];
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
        diagnostics: `parseHexColor("${input}") must throw — invalid color did not raise an error.`,
      };
    }
  }
  return { accepted: true, diagnostics: '' };
};

export const task: EvalTask = {
  id: 'validation_error_handling_v2',
  version: 1,
  category: 'validation_error_handling',
  description: 'Held-out variant: fix parseHexColor() to validate its input strictly.',
  base: { [TARGET]: BASE_SOURCE },
  prompt: `Fix parseHexColor() in ${TARGET} to throw on any string that is not exactly "#" + 6 hex digits.`,
  heldOut: true,
  acceptance,
};
