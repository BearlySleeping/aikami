// packages/shared/constants/src/lib/text_task.ts
//
// Text-task taxonomy and per-task generation presets (C-507). Every LLM call
// site declares a `TextTask`; the gateway resolves it to a connection via the
// task's `role` and applies the preset's `maxTokens` / `temperature` on top of
// the connection params. This is the single source of truth for "how should
// this kind of call be configured".

import type { AiRole, TextParams } from '@aikami/types';

/**
 * Baseline generation params used when a task resolves to a connection that
 * carries no text params. Mirrors the Balanced built-in preset.
 */
export const DEFAULT_TEXT_PARAMS: TextParams = {
  contextSize: 4096,
  maxTokens: 1024,
  presencePenalty: 0,
  repetitionPenalty: 1.1,
  temperature: 0.7,
  topK: 40,
  topP: 0.9,
};

/** Every distinct kind of text generation the game performs. */
export const TEXT_TASKS = [
  // Critical-path narrative
  'narration',
  'dialogue',
  // Interactive structured (latency-sensitive)
  'combat-intent',
  'envelope',
  // Background / cheap
  'summarization',
  // Agent micro-tasks
  'agent-expression',
  'agent-world',
  'agent-quest',
  'agent-cyoa',
  'agent-prose',
  'agent-battle-trigger',
  'agent-relationship',
  'agent-music',
  'agent-schedule',
  // Batched combined analysis (one call, many agents)
  'agent-batch',
  // Onboarding
  'persona-create',
] as const;

/** A text-generation task type. */
export type TextTask = (typeof TEXT_TASKS)[number];

/** Scheduling class — interactive work preempts background work. */
export type TextTaskPriority = 'interactive' | 'background';

/** The behavior contract for a text task. */
export type TextTaskPreset = {
  /** Which `AiRole` connection assignment serves this task. */
  role: AiRole;
  /** Output-token ceiling. Applied unless the connection already sets a lower one. */
  maxTokens: number;
  /** Sampling temperature for this task. */
  temperature: number;
  /** Scheduling priority — interactive tasks preempt background ones. */
  priority: TextTaskPriority;
  /** Whether this task benefits from token streaming. */
  streamable: boolean;
  /** Whether an on-device engine is preferred when one is available. */
  localFirst: boolean;
  /** Whether this task is a candidate for a batched combined analysis call. */
  batchable: boolean;
};

/**
 * Per-task presets. The `role` maps each task onto the existing role
 * assignments (`narration` / `dialogue` / `summarization` / `structured`),
 * so assigning a connection to a role in Settings immediately reroutes every
 * task that role serves.
 */
export const TEXT_TASK_PRESETS: Record<TextTask, TextTaskPreset> = {
  narration: {
    role: 'narration',
    maxTokens: 1024,
    temperature: 0.8,
    priority: 'interactive',
    streamable: true,
    localFirst: false,
    batchable: false,
  },
  dialogue: {
    role: 'dialogue',
    maxTokens: 800,
    temperature: 0.85,
    priority: 'interactive',
    streamable: true,
    localFirst: false,
    batchable: false,
  },
  'combat-intent': {
    role: 'structured',
    maxTokens: 400,
    temperature: 0.4,
    priority: 'interactive',
    streamable: false,
    localFirst: true,
    batchable: false,
  },
  envelope: {
    role: 'structured',
    maxTokens: 800,
    temperature: 0.3,
    priority: 'interactive',
    streamable: false,
    localFirst: true,
    batchable: false,
  },
  summarization: {
    role: 'summarization',
    maxTokens: 400,
    temperature: 0.3,
    priority: 'background',
    streamable: false,
    localFirst: true,
    batchable: false,
  },
  'agent-expression': {
    role: 'structured',
    maxTokens: 300,
    temperature: 0.2,
    priority: 'background',
    streamable: false,
    localFirst: true,
    batchable: true,
  },
  'agent-world': {
    role: 'structured',
    maxTokens: 400,
    temperature: 0.3,
    priority: 'background',
    streamable: false,
    localFirst: false,
    batchable: true,
  },
  'agent-quest': {
    role: 'structured',
    maxTokens: 500,
    temperature: 0.3,
    priority: 'background',
    streamable: false,
    localFirst: false,
    batchable: true,
  },
  'agent-cyoa': {
    role: 'structured',
    maxTokens: 500,
    temperature: 0.7,
    priority: 'background',
    streamable: false,
    localFirst: false,
    batchable: true,
  },
  'agent-prose': {
    role: 'structured',
    maxTokens: 500,
    temperature: 0.4,
    priority: 'background',
    streamable: false,
    localFirst: false,
    batchable: true,
  },
  'agent-battle-trigger': {
    role: 'structured',
    maxTokens: 200,
    temperature: 0.2,
    priority: 'background',
    streamable: false,
    localFirst: true,
    batchable: true,
  },
  'agent-relationship': {
    role: 'structured',
    maxTokens: 300,
    temperature: 0.3,
    priority: 'background',
    streamable: false,
    localFirst: true,
    batchable: true,
  },
  'agent-music': {
    role: 'structured',
    maxTokens: 300,
    temperature: 0.4,
    priority: 'background',
    streamable: false,
    localFirst: false,
    batchable: true,
  },
  'agent-schedule': {
    role: 'structured',
    maxTokens: 1200,
    temperature: 0.6,
    priority: 'background',
    streamable: false,
    localFirst: false,
    batchable: false,
  },
  'agent-batch': {
    role: 'structured',
    maxTokens: 1500,
    temperature: 0.3,
    priority: 'background',
    streamable: false,
    localFirst: false,
    batchable: false,
  },
  'persona-create': {
    role: 'structured',
    maxTokens: 800,
    temperature: 0.8,
    priority: 'interactive',
    streamable: false,
    localFirst: false,
    batchable: false,
  },
} as const;

/** Human-readable labels for task routing UI. */
export const TEXT_TASK_LABELS: Record<TextTask, string> = {
  narration: 'Narration',
  dialogue: 'Dialogue',
  'combat-intent': 'Combat actions',
  envelope: 'Choices & state',
  summarization: 'Summaries',
  'agent-expression': 'Expressions',
  'agent-world': 'World state',
  'agent-quest': 'Quests',
  'agent-cyoa': 'Choices (agent)',
  'agent-prose': 'Prose review',
  'agent-battle-trigger': 'Battle triggers',
  'agent-relationship': 'Relationships',
  'agent-music': 'Music cues',
  'agent-schedule': 'NPC schedules',
  'agent-batch': 'Batched analysis',
  'persona-create': 'Persona creation',
};

/** Maps built-in agent IDs to their text task. */
export const AGENT_TEXT_TASKS: Record<string, TextTask> = {
  'narrative-director': 'narration',
  'world-state': 'agent-world',
  'quest-tracker': 'agent-quest',
  expression: 'agent-expression',
  cyoa: 'agent-cyoa',
  'prose-guardian': 'agent-prose',
  'music-dj': 'agent-music',
  'schedule-planner': 'agent-schedule',
  'battle-trigger': 'agent-battle-trigger',
  relationship: 'agent-relationship',
};

/** Approximate characters-per-token used for cost-free token estimates. */
export const CHARS_PER_TOKEN = 4;

/** Estimates token count from a character count (≈4 chars/token). */
export const estimateTextTokens = (chars: number): number =>
  Math.max(0, Math.round(chars / CHARS_PER_TOKEN));

/** Default per-agent timeout (ms) for background post-agents. */
export const DEFAULT_AGENT_TIMEOUT_MS = 20_000;

/** Default per-agent timeout (ms) for pre-agents on the critical path. */
export const DEFAULT_PRE_AGENT_TIMEOUT_MS = 12_000;

/** Resolves the preset for a task, defaulting to narration. */
export const textTaskPreset = (task: TextTask | undefined): TextTaskPreset =>
  TEXT_TASK_PRESETS[task ?? 'narration'];
