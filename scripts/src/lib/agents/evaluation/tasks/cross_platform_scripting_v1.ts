// scripts/src/lib/agents/evaluation/tasks/cross_platform_scripting_v1.ts
//
// C-480 AC-1: cross-platform scripting task — a path builder hardcodes '/'
// instead of using node:path, which breaks on native Windows and mishandles
// trailing separators/empty segments everywhere.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AcceptanceOutcome, EvalTask } from '../types.ts';

const TARGET = 'build_asset_path.ts';

const BASE_SOURCE = `// Join a base directory and segments into an asset path.
// BUG: hardcodes '/' — wrong separator on native Windows, and produces
// doubled/missing separators when a segment already ends with one.
export const buildAssetPath = (base: string, ...segments: string[]): string =>
  base + '/' + segments.join('/');
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
  const fn = mod.buildAssetPath;
  if (typeof fn !== 'function') {
    return { accepted: false, diagnostics: 'buildAssetPath must remain an exported function.' };
  }
  const call = fn as (base: string, ...segments: string[]) => string;

  const cases: Array<{ args: string[]; expected: string }> = [
    { args: ['assets', 'sprites', 'hero.png'], expected: join('assets', 'sprites', 'hero.png') },
    // Trailing separator on the base must not produce a doubled separator.
    { args: ['assets/', 'hero.png'], expected: join('assets/', 'hero.png') },
    { args: ['assets'], expected: join('assets') },
  ];

  for (const { args, expected } of cases) {
    let result: unknown;
    try {
      const [base, ...segments] = args as [string, ...string[]];
      result = call(base, ...segments);
    } catch (err) {
      return { accepted: false, diagnostics: `Threw on ${JSON.stringify(args)}: ${String(err)}` };
    }
    if (result !== expected) {
      return {
        accepted: false,
        diagnostics: `buildAssetPath(${JSON.stringify(args)}) => ${JSON.stringify(result)}, expected ${JSON.stringify(expected)}`,
      };
    }
  }
  return { accepted: true, diagnostics: '' };
};

export const task: EvalTask = {
  id: 'cross_platform_scripting_v1',
  version: 1,
  category: 'cross_platform_scripting',
  description: 'Fix a hardcoded "/" path builder to use node:path so it is correct on every OS.',
  base: { [TARGET]: BASE_SOURCE },
  prompt: `buildAssetPath() in ${TARGET} hardcodes '/'. Rewrite it using node:path so separators, trailing slashes and empty segments are handled correctly on every OS.`,
  heldOut: false,
  acceptance,
};
