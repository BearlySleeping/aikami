// apps/frontend/client/src/lib/services/npc/npc_memory_diagnostics.ts
//
// The content-free `globalThis` diagnostics surface for NPC memory background
// work (issue #382).
//
// WHY A GLOBAL
//
// The same reason `text_service_diagnostics.ts` uses one: the #382 measurement
// harness and dev tooling read these from OUTSIDE the service and outside any
// import graph it controls. A global has no type, no owner and no
// discoverability, so every producer would otherwise be one more invisible way
// for a producer and a consumer to disagree. It is collected in ONE place
// instead.
//
// WHAT IS PUBLISHED
//
// Counts and ages only: requested, superseded-before-dispatch, overloaded,
// cancelled, invalidated-after-completion, applied, failed, pending, pending
// high-water mark, oldest pending age. NPC ids are stable save keys, not player
// content, and are not published here — only the aggregate.
//
// 🔴 WHY EVERY TERMINAL STATE IS A SEPARATE FIELD
//
// A discarded refresh folded into `applied` makes a bug invisible: the system
// reports success for work it threw away, and the cost of a stale opener is
// never attributable. `supersededBeforeDispatch` in particular is the field
// that proves obsolete QUEUED work made zero provider calls — a claim that is
// otherwise unfalsifiable from the outside.
//
// Contract: issue #382

import type { NpcMemoryLifecycleResult } from './npc_memory_lifecycle.ts';

/**
 * The key the measurement harness and dev tooling read.
 *
 * Module-private on purpose: a consumer outside the service reads the GLOBAL,
 * exactly as the #382 harness does. Exporting the constant would be a second,
 * easier-to-break way to reach the same value.
 */
const DIAGNOSTICS_KEY = '__npc_memory_background_diagnostics';

/** The published shape. Every field is content-free. */
export type PublishedNpcMemoryDiagnostics = NpcMemoryLifecycleResult;

/**
 * Publishes a lifecycle snapshot.
 *
 * Called on every transition rather than only at the end, so a snapshot taken
 * while work is in flight is meaningful — the same reasoning that puts the
 * admission publication BEFORE the await.
 */
export const publishNpcMemoryBackgroundDiagnostics = (result: NpcMemoryLifecycleResult): void => {
  (globalThis as Record<string, unknown>)[DIAGNOSTICS_KEY] = { ...result };
};
