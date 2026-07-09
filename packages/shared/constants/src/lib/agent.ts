// packages/shared/constants/src/lib/agent.ts
//
// Agent pipeline display constants. Consumed by the Agent HUD ViewModel.

import type { AgentPhase } from '@aikami/types';

/** Human-readable labels for each agent pipeline phase. */
export const PHASE_LABELS: Record<AgentPhase, string> = {
  pre: 'Pre-processing',
  main: 'Generating',
  post: 'Post-processing',
} as const;
