// scripts/src/lib/agents/subagents/constants.ts
// Pure runtime values shared by the Bun store and the Pi watcher.

import type { SubagentStatus } from './types.ts';

/** Run statuses that no longer need supervision. */
export const TERMINAL_STATUSES: readonly SubagentStatus[] = [
  'succeeded',
  'failed',
  'killed',
  'lost',
];
