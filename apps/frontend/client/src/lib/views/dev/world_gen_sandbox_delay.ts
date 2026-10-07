// apps/frontend/client/src/lib/views/dev/world_gen_sandbox_delay.ts
//
// G01 — how the dev sandbox turns a query string into a per-stage delay.
//
// Split out of `world_gen_sandbox_composition.ts` because this is a decision,
// not wiring: the composition imports the `$services` barrel (so a test would
// boot the whole service registry to import it), while this module is a pure
// function of (query, stage, cleared, fallback) and is tested directly.
//
// The semantics that matter, and why they are separated:
//
//   * `wgDelayStage` NARROWS `wgDelay`. With `wgDelay=800` alone every stage is
//     slow. With `wgDelay=3000&wgDelayStage=arcs` exactly ONE stage is slow and
//     the rest fall back to the sandbox default. Reading the same parameter for
//     both scopes — which this module replaces — made the stage knob a no-op:
//     naming a stage changed nothing, because the delay still applied to all of
//     them.
//   * "Clear Delay" really clears. The delay can come from the URL, and a
//     button that only emptied the ViewModel's own map left a query-driven
//     delay in place, so the control silently did nothing on the exact route
//     that documents it.
//
// Contract: G01 — safe private narrative-world drafts

/** A delay ceiling: long enough to observe a cancel, short enough to not stall. */
const MAX_DELAY_MS = 10_000;

/** The query-driven part of a sandbox delay. */
export type SandboxDelayQuery = {
  /** `wgDelay`, in ms. Clamped on read. */
  globalDelayMs: number;
  /** `wgDelayStage` — the single stage the delay applies to, or null. */
  focusedStage: string | null;
};

/** Reads `wgDelayStage` straight off a URLSearchParams-like object. */
export const readSandboxDelayQuery = (
  search: { get(name: string): string | null } | undefined,
): SandboxDelayQuery => ({
  globalDelayMs: clampSandboxDelay(search?.get('wgDelay')),
  focusedStage: readFocusedStage(search?.get('wgDelayStage')),
});

/**
 * Clamps a query-supplied delay into a sane, non-negative integer.
 *
 * Anything unparseable, negative or absurd becomes 0, so a hand-edited URL
 * cannot stall the sandbox for hours.
 */
export const clampSandboxDelay = (raw: string | null | undefined): number => {
  if (raw === null || raw === undefined) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.min(parsed, MAX_DELAY_MS);
};

/** A stage name is a focused-stage selector only if it names a real stage. */
const readFocusedStage = (raw: string | null | undefined): string | null => {
  const stage = raw?.trim() ?? '';
  return stage === '' ? null : stage;
};

/**
 * The delay the mock provider should apply to `stage`.
 *
 * @param cleared - "Clear Delay" was pressed. Query-driven delay is dropped
 * here too, because otherwise the button cannot clear the delay on the very
 * route that documents it.
 * @param fallback - what the ViewModel would apply with no query at all
 * (its own per-stage map, or the sandbox default).
 */
export const resolveSandboxDelay = (
  stage: string,
  query: SandboxDelayQuery,
  cleared: boolean,
  fallback: number,
): number => {
  if (cleared) {
    return 0;
  }
  // A named stage narrows the scope: the query delay applies to that stage and
  // to nothing else, and every other stage keeps the sandbox's own timing.
  if (query.focusedStage !== null) {
    return stage === query.focusedStage ? query.globalDelayMs : fallback;
  }
  return query.globalDelayMs > 0 ? query.globalDelayMs : fallback;
};
