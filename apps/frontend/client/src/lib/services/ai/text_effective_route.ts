// apps/frontend/client/src/lib/services/ai/text_effective_route.ts
//
// The content-free identity of the route a text request WILL take.
//
// WHY THIS EXISTS
//
// Two structured requests with byte-identical prompts, schemas and tasks are not
// necessarily the same request. If the connection configuration differs between
// them they resolve to different providers, endpoints, models and generation
// settings — and the coalescer runs ONE route, the initiator's. Without a route
// identity in the coalescing key, a settings change lets the second request join
// an attempt aimed at the OLD route and receive its answer.
//
// WHAT IT IS NOT
//
// Not a credential, not a fingerprint of one, and not anything a log line should
// ever print. It is assembled from the same fields the gateway dispatches with:
// the resolved mode, the provider id, the endpoint destination, the model, and the
// effective generation/reasoning settings. A connection whose API key changes
// while nothing else does is NOT distinguishable here, and that gap is stated
// rather than papered over — a caller with a settings owner that can supply a
// revision passes it as `configRevision`.
//
// Paths and queries distinguish destinations served by the same origin.
//
// Contract: issue #382 P1

import type { TextTask } from '@aikami/constants';
import type { AiModeResolution } from '@aikami/types';
import type { StructuredCallIdentity } from './structured_call_coalescer.ts';

/**
 * Scheme + host + port + normalized path + query, or the trimmed input when invalid, or
 * `in-process` for a route with no HTTP surface.
 */
const endpointOrigin = (endpoint: string | undefined): string => {
  const trimmed = (endpoint ?? '').trim();
  if (trimmed.length === 0) {
    return 'in-process';
  }
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}${url.pathname}${url.search}`;
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
};

/**
 * Serialises a nested settings value deterministically, with sorted keys.
 *
 * Generation params and reasoning settings are small plain objects, and their
 * KEY ORDER is not semantic — so two resolutions that differ only in ordering are
 * the same route and must share.
 */
const canonicalSettings = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'z';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalSettings(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key.length}:${key}=${canonicalSettings(record[key])}`)
      .join(',')}}`;
  }
  return `${typeof value}:${String(value)}`;
};

/**
 * The route identity for a resolved routing, as a single comparable string.
 *
 * `configRevision` is an opaque, non-secret marker from whatever owns the
 * connection configuration (a settings revision, a credentials revision). It is
 * passed through verbatim: this module cannot derive a credential identity that
 * does not exist in the resolution, and inventing one from the key would put a
 * secret into a coalescing key.
 */
const textEffectiveRoute = (
  resolution: AiModeResolution,
  options?: { configRevision?: string },
): string =>
  [
    `cap=${resolution.capability}`,
    `mode=${resolution.mode}`,
    `provider=${resolution.provider.trim().toLowerCase()}`,
    `origin=${endpointOrigin(resolution.endpoint)}`,
    `model=${resolution.model ?? ''}`,
    `params=${canonicalSettings(resolution.params)}`,
    `reasoning=${canonicalSettings(resolution.reasoning)}`,
    `rev=${options?.configRevision ?? ''}`,
  ].join('|');

/** The scope token for a caller that names no partition of its own. */
const UNSCOPED_REQUEST_SCOPE = 'unscoped';

/**
 * Builds the coalescing identity for one structured text request.
 *
 * Lives here rather than in the service because assembling it is the whole
 * correctness argument: every field is either "what is being asked" (task,
 * schema, prompts, explicit model) or "who is asking and where" (effective
 * route, scope). A field that is neither — and is therefore a field two
 * genuinely different requests can agree on — is a field that will one day
 * serve one caller another's answer.
 */
export const buildCoalescingIdentity = (options: {
  task: TextTask | undefined;
  schemaName: string;
  schema: Record<string, unknown>;
  systemPrompt: string | undefined;
  prompt: string;
  model: string | undefined;
  routing: AiModeResolution;
  scope: string | undefined;
  configRevision: string | undefined;
}): StructuredCallIdentity => ({
  task: options.task,
  schemaName: options.schemaName,
  schema: options.schema,
  systemPrompt: options.systemPrompt ?? '',
  prompt: options.prompt,
  model: options.model,
  // Computed from the routing captured ONCE, before any dispatch, and from the
  // caller's own scope. It is the only thing standing between a settings change
  // and a request silently joining an attempt aimed at the old route: the
  // shared work's route is the initiator's, so the key has to say WHICH
  // initiator's.
  effectiveRoute: textEffectiveRoute(options.routing, {
    ...(options.configRevision === undefined ? {} : { configRevision: options.configRevision }),
  }),
  scope: options.scope ?? UNSCOPED_REQUEST_SCOPE,
});
