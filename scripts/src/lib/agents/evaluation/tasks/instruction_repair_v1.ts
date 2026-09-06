// scripts/src/lib/agents/evaluation/tasks/instruction_repair_v1.ts
//
// C-480 AC-1: instruction_repair task — a comment/doc string contradicts the
// code it describes. The candidate must correct the comment to match actual
// behavior without changing behavior itself.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AcceptanceOutcome, EvalTask } from '../types.ts';

const TARGET = 'clamp.ts';

const BASE_SOURCE = `// Returns the larger of \`value\` and \`min\`, ignoring \`max\` entirely.
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
`;

const acceptance = async (sandboxPath: string): Promise<AcceptanceOutcome> => {
  const content = await readFile(join(sandboxPath, TARGET), 'utf-8');
  const stillWrong = /Returns the larger of `value` and `min`, ignoring `max` entirely\./.test(
    content,
  );
  const implementationSource = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .trim();
  const bodyUnchanged =
    /^export\s+const\s+clamp\s*=\s*\(\s*value\s*:\s*number\s*,\s*min\s*:\s*number\s*,\s*max\s*:\s*number\s*\)\s*:\s*number\s*=>\s*Math\.min\(\s*Math\.max\(\s*value\s*,\s*min\s*\)\s*,\s*max\s*\)\s*;?$/.test(
      implementationSource,
    );

  if (!bodyUnchanged) {
    return { accepted: false, diagnostics: 'clamp() implementation must not change.' };
  }
  if (stillWrong) {
    return {
      accepted: false,
      diagnostics: 'The comment still describes behavior that contradicts the code.',
    };
  }
  const describesClamp = /clamp/i.test(content) && /min/.test(content) && /max/.test(content);
  if (!describesClamp) {
    return {
      accepted: false,
      diagnostics: 'Corrected comment must describe the actual clamping behavior.',
    };
  }
  return { accepted: true, diagnostics: '' };
};

export const task = {
  id: 'instruction_repair_v1',
  version: 1,
  category: 'instruction_repair',
  description:
    'Fix a doc comment on clamp() that describes the wrong behavior (says it ignores `max`, but the code clamps on both bounds) without touching the implementation.',
  base: { [TARGET]: BASE_SOURCE },
  prompt:
    `The comment above clamp() in ${TARGET} is factually wrong about what the function does. ` +
    'Correct the comment to accurately describe the implementation. Do not change the implementation.',
  heldOut: false,
  acceptance,
  acceptanceDependencies: [TARGET],
} as const satisfies EvalTask;
