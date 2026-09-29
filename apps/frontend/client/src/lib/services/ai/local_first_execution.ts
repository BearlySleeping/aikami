// apps/frontend/client/src/lib/services/ai/local_first_execution.ts
//
// Opportunistic on-device execution, and the per-route cooldown that decides
// whether it is worth attempting at all (issue #382 P0).
//
// Extracted from the text service so that module stays a routing/deadline
// decision surface. This is the execution half: given permission and a window,
// produce a schema-valid object from the on-device engine — or say, honestly,
// that it could not.
//
// Three rules this module owns, each of which was a defect before it was a rule:
//
//   - THE WINDOW IS DERIVED, NEVER ALLOCATED. The attempt may only use what is
//     left of the caller's deadline. A cold local load must never consume the
//     budget the configured gateway path still needs.
//   - A COOLDOWN BELONGS TO ONE ROUTE. Keyed by provider + model, so a local HTTP
//     engine that is down never suppresses the in-browser worker, and neither
//     suppresses a cloud route. A single global timestamp would let one dead
//     engine disable every local alternative for the whole cooldown window.
//   - AN EXPIRED WINDOW IS NOT AN ENGINE FAILURE. A local attempt that runs out
//     of time, or whose deadline has passed, proves nothing about the engine, so
//     it must not start a cooldown. Penalising it would disable a working engine
//     precisely when the device is slow.
//
// Contract: issue #382 P0 "readiness-aware local execution"

import { TEXT_TASK_PRESETS, type TextTask, type TextTaskPreset } from '@aikami/constants';
import { sanitizeJsonResponse, validateAgainstSchema } from '@aikami/frontend/ai-gateway';
import type { AiModeResolution } from '@aikami/types';
import type { AiRequestDeadline } from './ai_request_deadline.ts';
import { localTaskPoolService } from './local_task_pool_service.svelte.ts';

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

/** Per-route cooldowns after a local failure. */
export type LocalRouteCooldown = {
  /** Whether this route is still inside its cooldown. */
  isCoolingDown(routeKey: string): boolean;
  /** Starts this route's cooldown. Other routes are unaffected. */
  coolDown(routeKey: string): void;
  /** Clears this route's cooldown after a confirmed local success. */
  clear(routeKey: string): void;
  /** Drops every cooldown. */
  clearAll(): void;
};

/** Creates the per-route cooldown registry. */
export const createLocalRouteCooldown = (cooldownMs: number): LocalRouteCooldown => {
  const until = new Map<string, number>();
  return {
    isCoolingDown: (routeKey) => Date.now() < (until.get(routeKey) ?? 0),
    coolDown: (routeKey) => {
      until.set(routeKey, Date.now() + cooldownMs);
    },
    clear: (routeKey) => {
      until.delete(routeKey);
    },
    clearAll: () => {
      until.clear();
    },
  };
};

/**
 * Identifies one local route for cooldown purposes.
 *
 * The model is part of the key because readiness and failure are per model: an
 * engine that cannot serve `qwen3-32b` may still serve `qwen3-0.6b`, and a
 * cooldown for one must not suppress the other.
 *
 * Module-private: a caller that built its own route key would have to
 * re-derive this rule, and a divergence would let one engine's cooldown
 * silently suppress another's.
 */
const localRouteKey = (resolution: AiModeResolution): string =>
  `${resolution.provider}|${resolution.model ?? ''}|local-tasks`;

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Ceiling on the opportunistic local attempt, before the shared deadline trims
 * it. A micro-task that has not answered inside this is worse than a cloud
 * answer, so the local path is a bonus, never the critical path.
 */
const LOCAL_FIRST_TIMEOUT_MS = 5_000;

/** Convenience lookup for a task's preset, tolerating an absent task. */
export const presetForTask = (task: TextTask | undefined): TextTaskPreset | undefined =>
  task === undefined ? undefined : TEXT_TASK_PRESETS[task];

/**
 * Attempts one local-first structured extraction.
 *
 * Returns `undefined` — meaning "fall back to the configured route" — for every
 * reason the attempt did not produce a usable answer: policy forbade it, the
 * route is cooling down, the engine cannot serve the routed model, the window is
 * already spent, the engine failed, or its output did not validate. Those are
 * deliberately not distinguished in the return value: every one of them has the
 * same correct response, and a caller that treated them differently would have
 * to re-derive the policy this module was written to hold.
 *
 * `onAttempt` fires as soon as the attempt is genuinely UNDERWAY — that is the
 * point where a later fallback becomes a real second route rather than a
 * non-event, and it is what lets the caller record that honestly.
 */
export const runLocalFirstStructured = async (options: {
  prompt: string;
  systemPrompt?: string;
  schema: Record<string, unknown>;
  preset: TextTaskPreset | undefined;
  /** The caller's own signal; an abort here is a cancellation, not a failure. */
  signal: AbortSignal;
  deadline: AiRequestDeadline;
  resolution: AiModeResolution;
  /** Whether policy permits a local attempt at all. */
  allowLocal: boolean;
  /**
   * Fired once the attempt is genuinely UNDERWAY.
   *
   * That is the point where a later gateway call becomes a real second route
   * rather than a non-event, and it is what lets the caller record the fallback
   * honestly instead of guessing at it afterwards.
   */
  onAttempt: () => void;
  cooldown: LocalRouteCooldown;
}): Promise<unknown | undefined> => {
  const { prompt, systemPrompt, schema, preset, signal, deadline, resolution, cooldown } = options;
  if (!options.allowLocal || preset?.localFirst !== true) {
    return undefined;
  }

  const routeKey = localRouteKey(resolution);
  if (cooldown.isCoolingDown(routeKey)) {
    return undefined;
  }

  // Readiness is per model: a served-model list that omits the model this route
  // would generate with is not proof the engine can serve it.
  if (!localTaskPoolService.canServeLocal(resolution.model)) {
    return undefined;
  }

  // DERIVED, not allocated: the attempt gets what is left, and none of it if
  // nothing is left.
  const window = deadline.windowMs(LOCAL_FIRST_TIMEOUT_MS);
  if (window === undefined) {
    return undefined;
  }

  options.onAttempt();

  const controller = new AbortController();
  let localTimedOut = false;
  const timeoutId = setTimeout(() => {
    localTimedOut = true;
    controller.abort();
  }, window);
  const onExternalAbort = (): void => controller.abort(signal.reason);
  signal.addEventListener('abort', onExternalAbort, { once: true });
  // The deadline is a second abort source: when the budget runs out, the local
  // attempt must stop too, or it keeps the GPU busy past the point the caller
  // stopped caring.
  const onDeadlineAbort = (): void => controller.abort(deadline.signal.reason);
  deadline.signal.addEventListener('abort', onDeadlineAbort, { once: true });
  if (signal.aborted) {
    onExternalAbort();
  } else if (deadline.signal.aborted) {
    onDeadlineAbort();
  }

  try {
    options.onAttempt?.();
    await localTaskPoolService.pool.ensureLoaded(controller.signal);
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const result = await localTaskPoolService.pool.submit(
      {
        type: 'text',
        payload: {
          prompt: fullPrompt,
          maxTokens: preset.maxTokens,
          temperature: preset.temperature,
        },
      },
      controller.signal,
    );
    const parsed: unknown = JSON.parse(sanitizeJsonResponse(result.output));
    if (!validateAgainstSchema({ schema, parsed })) {
      // Structurally wrong local output — cool this route down and let the
      // configured route answer.
      cooldown.coolDown(routeKey);
      return undefined;
    }
    cooldown.clear(routeKey);
    return parsed;
  } catch {
    // A cancelled attempt and an exhausted window are NOT engine failures. Only
    // a genuine failure while there was still time left starts a cooldown —
    // otherwise a slow device would disable a working engine.
    if (!signal.aborted && !deadline.signal.aborted && !deadline.expired() && !localTimedOut) {
      cooldown.coolDown(routeKey);
    }
    return undefined;
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onExternalAbort);
    deadline.signal.removeEventListener('abort', onDeadlineAbort);
  }
};
