// scripts/src/lib/agents/evaluation/task_registry.ts
//
// C-480 AC-1: the frozen task set — small versioned fixtures spanning
// instruction repair, pure TypeScript, validation/error handling, process
// concurrency, Svelte reactivity and cross-platform scripting, plus a
// held-out subset. Hashes bind evidence to the exact frozen task/base/
// acceptance/config so a report can never be attributed to a task that has
// since changed underneath it.

import { createHash } from 'node:crypto';
import { task as crossPlatformScriptingV1 } from './tasks/cross_platform_scripting_v1.ts';
import { task as instructionRepairV1 } from './tasks/instruction_repair_v1.ts';
import { task as processConcurrencyV1 } from './tasks/process_concurrency_v1.ts';
import { task as pureTypescriptV1 } from './tasks/pure_typescript_v1.ts';
import { task as pureTypescriptV2 } from './tasks/pure_typescript_v2.ts';
import { task as svelteReactivityV1 } from './tasks/svelte_reactivity_v1.ts';
import { task as validationErrorHandlingV1 } from './tasks/validation_error_handling_v1.ts';
import { task as validationErrorHandlingV2 } from './tasks/validation_error_handling_v2.ts';
import type { EvalConfig, EvalTask, TaskHashes } from './types.ts';

const TASKS: readonly EvalTask[] = [
  instructionRepairV1,
  pureTypescriptV1,
  pureTypescriptV2,
  validationErrorHandlingV1,
  validationErrorHandlingV2,
  processConcurrencyV1,
  svelteReactivityV1,
  crossPlatformScriptingV1,
];

/** Return every registered evaluation task, visible and held-out alike. */
export const listTasks = (): readonly EvalTask[] => TASKS;

/** Return only tasks eligible to justify a routing recommendation. */
export const listVisibleTasks = (): readonly EvalTask[] => TASKS.filter((t) => !t.heldOut);

/** Return only the held-out subset, reserved for catching overfitting. */
export const listHeldOutTasks = (): readonly EvalTask[] => TASKS.filter((t) => t.heldOut);

/** Look up a single task by id. Returns undefined for an unknown id. */
export const getTask = (id: string): EvalTask | undefined => TASKS.find((t) => t.id === id);

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex');

/**
 * Compute the frozen hashes for one task under one config. `taskHash`
 * covers everything about the task's identity (id/version/category/
 * description/prompt/heldOut); `baseHash` covers only the seeded starting
 * files; `acceptanceHash` covers the checker function's own source plus
 * immutable fingerprints for its closed-over dependencies; `configHash`
 * covers the comparable-run inputs (AC-2).
 */
export const computeTaskHashes = (options: { task: EvalTask; config: EvalConfig }): TaskHashes => {
  const { task, config } = options;

  const taskIdentity = JSON.stringify({
    id: task.id,
    version: task.version,
    category: task.category,
    description: task.description,
    prompt: task.prompt,
    heldOut: task.heldOut,
  });

  const baseContent = JSON.stringify(task.base, Object.keys(task.base).sort());
  const acceptanceSource = JSON.stringify({
    implementation: task.acceptance.toString(),
    dependencies: task.acceptanceDependencies ?? [],
  });
  const configIdentity = JSON.stringify({
    family: config.family,
    provider: config.catalogue.provider,
    model: config.catalogue.model,
    thinking: config.thinking,
    cacheCondition: config.cacheCondition,
  });

  return {
    taskHash: sha256(taskIdentity),
    baseHash: sha256(baseContent),
    acceptanceHash: sha256(acceptanceSource),
    configHash: sha256(configIdentity),
  };
};
