// packages/shared/constants/src/lib/agent.ts
//
// Agent pipeline display constants. Consumed by the Agent HUD ViewModel
// and agent registry service.

import type { AgentPhase } from '@aikami/types';

/** Human-readable labels for each agent pipeline phase. */
export const PHASE_LABELS: Record<AgentPhase, string> = {
  pre: 'Pre-processing',
  main: 'Generating',
  post: 'Post-processing',
} as const;

/** Phase dropdown options for the agent editor UI. */
export const PHASE_OPTIONS = [
  {
    id: 'pre' as const,
    label: 'Pre-processing',
    hint: 'Runs before the main generation. Results are injected into the system prompt.',
  },
  {
    id: 'post' as const,
    label: 'Post-processing',
    hint: 'Runs after the main generation. Results can update game state.',
  },
] as const;

/** Result type dropdown options for the agent editor UI. */
export const RESULT_TYPE_OPTIONS = [
  { id: 'tracker_state', label: 'Tracker State' },
  { id: 'memory', label: 'Memory' },
  { id: 'command', label: 'Command' },
  { id: 'custom', label: 'Custom' },
] as const;

/** Set of built-in agent IDs — custom agents cannot use these. */
export const BUILT_IN_AGENT_IDS = new Set([
  'narrative-director',
  'world-state',
  'quest-tracker',
  'expression',
  'cyoa',
  'prose-guardian',
  'music-dj',
]);

/** Firestore collection name for agent definitions. */
export const AGENT_DEFINITIONS_COLLECTION = 'agent_definitions';

/** Maximum length for agent name. */
export const AGENT_MAX_NAME_LENGTH = 60;

/** Maximum length for agent description. */
export const AGENT_MAX_DESCRIPTION_LENGTH = 500;

/** Minimum agent timeout in milliseconds. */
export const AGENT_MIN_TIMEOUT = 3000;

/** Maximum agent timeout in milliseconds. */
export const AGENT_MAX_TIMEOUT = 60_000;
