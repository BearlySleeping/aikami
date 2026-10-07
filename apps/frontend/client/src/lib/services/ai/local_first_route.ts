// apps/frontend/client/src/lib/services/ai/local_first_route.ts
//
// The opportunistic on-device attempt, as one owned thing.
//
// The execution rules live in `local_first_execution.ts` and the per-route
// cooldown lives with them. What was missing was an OWNER: `TextGenerationService`
// held the cooldown map as a field and re-declared the delegation on every call
// site, so the service grew a second responsibility it had no tests of its own
// for. This is that owner.
//
// WHY IT IS NOT PART OF INFERENCE ADMISSION
//
// The on-device pool and a configured local runtime are DIFFERENT resources.
// Both are colloquially "local", and merging them would serialize a cheap
// in-browser generation behind a contended GPU for no reason at all — the exact
// "unnecessarily serialized independent domains" failure. The pool names itself
// with a different provider id, which resolves to a different contention domain,
// so admission governs the configured provider path and leaves this one alone.
// That boundary is deliberate and is asserted in `text_generation_service.test.ts`.
//
// Contract: issue #382 P0 (policy before spend), #382 admission (local-first
// left unchanged and out of the contended domain).

import type { TextTask } from '@aikami/constants';
import type { AiModeResolution } from '@aikami/types';
import type { AiRequestDeadline } from './ai_request_deadline.ts';
import {
  createLocalRouteCooldown,
  type LocalRouteCooldown,
  presetForTask,
  runLocalFirstStructured,
} from './local_first_execution.ts';
import { localTaskPoolService } from './local_task_pool_service.svelte.ts';
import { resolveLocalFirstPolicy } from './text_local_first_policy.ts';

/**
 * How long a local engine that just failed is skipped, tracked PER ROUTE so one
 * dead engine cannot suppress a healthy alternative.
 */
const LOCAL_COOLDOWN_MS = 60_000;

/** The opportunistic on-device attempt, plus its per-route cooldown. */
export type LocalFirstRoute = {
  /**
   * Runs the on-device attempt, or resolves `undefined` when the route is not
   * allowed to try locally at all — which is a POLICY decision the caller makes
   * (`allowLocal`), not a failure.
   */
  tryStructured(options: {
    prompt: string;
    schema: Record<string, unknown>;
    task?: TextTask;
    signal: AbortSignal;
    deadline: AiRequestDeadline;
    resolution: AiModeResolution;
    onAttempt: () => void;
    systemPrompt?: string;
    /**
     * The on-device model the caller pinned, when it pinned one.
     *
     * Readiness is checked against THIS, not against whatever the resolution
     * names: a caller that pinned a model is asking for that model, and
     * answering from a different on-device bundle would make the pin a lie.
     */
    explicitModel?: string;
  }): Promise<unknown | undefined>;
  /** Forgets every cooldown, on dispose. */
  clearAll(): void;
};

/** Creates the local-first route owner. */
export const createLocalFirstRoute = (): LocalFirstRoute => {
  const cooldown: LocalRouteCooldown = createLocalRouteCooldown(LOCAL_COOLDOWN_MS);

  return {
    clearAll(): void {
      cooldown.clearAll();
    },
    tryStructured(options: {
      prompt: string;
      schema: Record<string, unknown>;
      task?: TextTask;
      signal: AbortSignal;
      deadline: AiRequestDeadline;
      resolution: AiModeResolution;
      onAttempt: () => void;
      systemPrompt?: string;
      explicitModel?: string;
    }): Promise<unknown | undefined> {
      // The ALLOWANCE is decided here, next to the attempt it gates, so a
      // reader cannot see one without the other. The attempt is opportunistic,
      // so it may only run when the configured routing permits it: the task
      // must opt in, no model may be pinned, the route must be genuinely local,
      // and the engine must actually serve the model in hand.
      const allowLocal = resolveLocalFirstPolicy({
        resolution: options.resolution,
        preset: presetForTask(options.task),
        hasExplicitModel: options.explicitModel !== undefined && options.explicitModel.length > 0,
        readiness: localTaskPoolService.readiness,
      }).allowed;
      return runLocalFirstStructured({
        prompt: options.prompt,
        schema: options.schema,
        signal: options.signal,
        deadline: options.deadline,
        resolution: options.resolution,
        allowLocal,
        onAttempt: options.onAttempt,
        preset: presetForTask(options.task),
        cooldown,
        ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
      });
    },
  };
};
