// apps/frontend/client/src/lib/services/ai/text_local_first_policy.ts
//
// Whether an opportunistic local attempt is allowed, as a pure rule.
//
// Kept out of the service so the policy can be unit tested without constructing
// the singleton, reading ConfigService or touching the local pool — the rule is
// the part worth pinning, and it is the part that was previously implicit and
// wrong (issue #382 P0: "attempts local-first structured extraction before
// gateway routing… That helper does not receive the explicit model override").
//
// A local attempt is a BONUS, never a requirement. It is allowed only when every
// one of these holds:
//
//   - the task preset opts into `localFirst`;
//   - the caller pinned no explicit model — an override is a decision about
//     WHICH model answers, and silently substituting a different one would make
//     that decision a lie;
//   - the effective routing is itself local/offline. A task whose connection is
//     a cloud provider did not ask for an on-device detour, and paying one would
//     add latency to every such call for no configured benefit;
//   - the engine is not inside a post-failure cooldown (checked by the caller,
//     which owns the cooldown state);
//
// Readiness is deliberately NOT re-derived here. The caller passes the live
// readiness snapshot so this module stays a pure function of its inputs.

import type { TextTaskPreset } from '@aikami/constants';
import type { AiModeResolution } from '@aikami/types';
import { type LocalReadiness, matchesModel } from './local_readiness.ts';

/** Whether a route is served by an on-device engine. */
const isLocalRoute = (resolution: AiModeResolution): boolean =>
  resolution.mode === 'offline' ||
  resolution.provider.startsWith('local') ||
  resolution.provider === 'llamacpp' ||
  resolution.provider === 'ooba';

/** True when the engine has no evidence that it CANNOT serve `model`. */
const isNotRefuted = (readiness: LocalReadiness, model: string | undefined): boolean => {
  if (readiness.state === 'unavailable') {
    return false;
  }
  if (model === undefined || model.trim().length === 0) {
    return true;
  }
  // A model the engine itself listed, or one a generation already confirmed, is
  // servable. An empty list is absence of proof, not a refusal.
  if (readiness.confirmedModelIds.some((id) => matchesModel(id, model))) {
    return true;
  }
  if (readiness.servedModelIds.length === 0) {
    return true;
  }
  // A non-empty served list that omits the model IS a refusal: the engine told
  // us what it serves, and this is not on the list.
  return readiness.servedModelIds.some((id) => matchesModel(id, model));
};

/**
 * Decides whether to attempt local execution before the configured route.
 *
 * `reason` is recorded for telemetry so a skipped local attempt is
 * distinguishable from one that was never considered.
 */
export const resolveLocalFirstPolicy = (options: {
  resolution: AiModeResolution;
  preset?: TextTaskPreset;
  /** Whether the caller pinned an explicit model for this call. */
  hasExplicitModel: boolean;
  readiness: LocalReadiness;
}): {
  allowed: boolean;
  reason: 'opted-in' | 'not-local-first' | 'explicit-model' | 'remote-route' | 'not-ready';
} => {
  const { resolution, preset, hasExplicitModel, readiness } = options;

  if (preset?.localFirst !== true) {
    return { allowed: false, reason: 'not-local-first' };
  }
  if (hasExplicitModel) {
    return { allowed: false, reason: 'explicit-model' };
  }
  if (!isLocalRoute(resolution)) {
    return { allowed: false, reason: 'remote-route' };
  }
  if (!isNotRefuted(readiness, resolution.model)) {
    return { allowed: false, reason: 'not-ready' };
  }
  return { allowed: true, reason: 'opted-in' };
};
