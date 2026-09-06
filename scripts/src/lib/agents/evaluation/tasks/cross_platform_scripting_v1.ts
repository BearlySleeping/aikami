// scripts/src/lib/agents/evaluation/tasks/cross_platform_scripting_v1.ts
//
// C-480 AC-1: cross-platform scripting task — a path builder hardcodes '/'
// instead of using node:path, which breaks on native Windows and mishandles
// trailing separators/empty segments everywhere.

import { candidateRunnerFingerprint, runCandidateTest } from '../candidate_runner.ts';
import type { AcceptanceOutcome, EvalTask } from '../types.ts';

const TARGET = 'build_asset_path.ts';

const BASE_SOURCE = `// Join a base directory and segments into an asset path.
// BUG: hardcodes '/' — wrong separator on native Windows, and produces
// doubled/missing separators when a segment already ends with one.
export const buildAssetPath = (base: string, ...segments: string[]): string =>
  base + '/' + segments.join('/');
`;

const ACCEPTANCE_TEST_SOURCE = `
const fn = candidate.buildAssetPath;
if (typeof fn !== 'function') {
  return { accepted: false, diagnostics: 'buildAssetPath must remain an exported function.' };
}
const path = await import('node:path');
const cases = [
  { args: ['assets', 'sprites', 'hero.png'], expected: path.join('assets', 'sprites', 'hero.png') },
  { args: ['assets/', 'hero.png'], expected: path.join('assets/', 'hero.png') },
  { args: ['assets'], expected: path.join('assets') },
];
for (const { args, expected } of cases) {
  try {
    const result = fn(...args);
    if (result !== expected) {
      return { accepted: false, diagnostics: 'buildAssetPath(' + JSON.stringify(args) + ') => ' + JSON.stringify(result) + ', expected ' + JSON.stringify(expected) };
    }
  } catch (error) {
    return { accepted: false, diagnostics: 'Threw on ' + JSON.stringify(args) + ': ' + String(error) };
  }
}
return { accepted: true, diagnostics: '' };
`;

const acceptance = (sandboxPath: string): Promise<AcceptanceOutcome> =>
  runCandidateTest({ sandboxPath, target: TARGET, testSource: ACCEPTANCE_TEST_SOURCE });

export const task = {
  id: 'cross_platform_scripting_v1',
  version: 1,
  category: 'cross_platform_scripting',
  description: 'Fix a hardcoded "/" path builder to use node:path so it is correct on every OS.',
  base: { [TARGET]: BASE_SOURCE },
  prompt: `buildAssetPath() in ${TARGET} hardcodes '/'. Rewrite it using node:path so separators, trailing slashes and empty segments are handled correctly on every OS.`,
  heldOut: false,
  acceptance,
  acceptanceDependencies: [candidateRunnerFingerprint(), TARGET, ACCEPTANCE_TEST_SOURCE],
} as const satisfies EvalTask;
