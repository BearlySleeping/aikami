// scripts/src/lib/pi/env.ts
//
// Bun-side implementations of the environment bridge commands (mode
// resolution, executable lookup, direnv detection).

import { hasDirenv, isDirenvLoaded, resolveAikamiEnv } from '../env/direnv_detect.ts';
import { resolveAikamiMode } from '../env/mode.ts';
import { findBash, which } from '../env/which.ts';
import { requireString, toArgs } from './args.ts';
import type { PiHandlers } from './types.ts';

export const handlers: PiHandlers = {
  'env.resolveMode': () => resolveAikamiMode(),

  'env.which': (payload) => which(requireString(toArgs(payload), 'bin')),

  'env.findBash': () => findBash(),

  'env.direnv.has': () => hasDirenv(),

  'env.direnv.isLoaded': () => isDirenvLoaded(),

  'env.direnv.resolve': (payload) => resolveAikamiEnv(requireString(toArgs(payload), 'root')),

  /** One round-trip for every direnv/environment fact an extension needs. */
  'env.direnv.info': (payload) => {
    const root = requireString(toArgs(payload), 'root');
    return {
      hasDirenv: hasDirenv(),
      isLoaded: isDirenvLoaded(),
      ...resolveAikamiEnv(root),
    };
  },
};
