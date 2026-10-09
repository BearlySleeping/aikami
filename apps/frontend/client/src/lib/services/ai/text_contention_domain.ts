// apps/frontend/client/src/lib/services/ai/text_contention_domain.ts
//
// The contention domain key for a resolved text route (issue #382).
//
// WHAT IS KNOWN, AND WHAT IS ASSUMED
//
// Same origin ⇒ assumed same process ⇒ assumed same compute. That is a
// heuristic, and it is stated rather than asserted: nothing in a resolved route
// identifies a physical device, so no key here can PROVE two requests contend
// or that they do not.
//
// 🔴 A DISTINCT PORT IS NOT A DISTINCT DEVICE. An earlier version of this file
// claimed the opposite — "two Ollama daemons on one host on different ports are
// two devices with two pools". That is not established. Two daemons on one host
// very commonly front ONE GPU, and splitting them into two contention domains
// lets background work on the second port run concurrently with interactive
// work on the first: exactly the collision #416 measured, reintroduced through
// a port number. Conversely, genuinely separate devices DO stay independent —
// that half of the heuristic is the one the key is entitled to, because two
// different hosts or schemes are a real boundary a caller can observe.
//
// The correction is the ASSUMPTION, not a new hardware settings UI: nothing here
// may claim a device mapping it cannot read. `resourceGroup` is the only merge
// performed on evidence — a caller that DOES have a device id, a managed
// runtime identity or a configured pool names it, and aliases sharing it are
// united.
//
// MEASUREMENT GAP (not closed here): no measurement in this repository
// separates "same GPU behind two ports" from "two GPUs behind two ports" on one
// host. The residual risk is recorded in
// `docs/research/audits/382-request-identity-background-report.md` rather than papered
// over with a guess.
//
// Contract: issue #382, "Add bounded concurrency and priority queues per
// provider/local device. Interactive work gets precedence".

import type { AiModeResolution } from '@aikami/types';

/**
 * Reduces an endpoint URL to its ORIGIN — scheme, host and port.
 *
 * Path and query are dropped on purpose. `/api/chat` and
 * `/v1/chat/completions` on the same host are two request shapes into ONE
 * server process, and one server process owns one set of accelerators. Treating
 * them as different domains would let a background request on one surface and
 * an interactive request on the other run concurrently against the same GPU —
 * which is precisely the collision #416 measured.
 *
 * The port is KEPT because it is the only per-daemon boundary the route
 * actually exposes, NOT because a different port proves a different device.
 * What keeping it buys is that two routes which genuinely are separate
 * processes are not needlessly serialized.
 */
const endpointOrigin = (endpoint: string | undefined): string => {
  const trimmed = (endpoint ?? '').trim();
  if (trimmed.length === 0) {
    // No HTTP surface: the route is the in-process/on-device pool, which names
    // itself through its provider id and has no origin to add.
    return 'in-process';
  }
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`;
  } catch {
    // An endpoint that is not a URL is still a stable identity string; using it
    // verbatim is better than collapsing it into everyone else's key.
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
};

/**
 * The contention domain key for a resolved text route.
 *
 * The SMALLEST stable key derived from the effective routing that still names
 * the contended resource. Content-free: a provider id, an origin, or a resource
 * group — never a prompt, a model, or any player data, and never a credential.
 *
 * `resourceGroup` overrides the derived key entirely: when a caller knows
 * several configured routes are aliases of ONE device or one managed runtime,
 * naming the same group unites them. Distinct groups stay distinct, so
 * genuinely independent devices remain independent — hosted traffic is not
 * globally serialized by this.
 */
export const textContentionDomain = (
  resolution: AiModeResolution,
  resourceGroup?: string,
): string => {
  const group = (resourceGroup ?? '').trim().toLowerCase();
  if (group.length > 0) {
    return `group:${group}`;
  }
  const provider = resolution.provider.trim().toLowerCase();
  return `${provider.length > 0 ? provider : 'unknown'}|${endpointOrigin(resolution.endpoint)}`;
};
