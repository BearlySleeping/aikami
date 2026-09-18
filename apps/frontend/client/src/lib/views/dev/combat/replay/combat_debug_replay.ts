// apps/frontend/client/src/lib/views/dev/combat/replay/combat_debug_replay.ts
//
// Replay/export adapter for the combat debug workspace. Bridges the shared
// portable-reproduction helpers (`@aikami/utils`) to two browser-facing
// concerns: a file download UX for exported reproductions, and the workspace's
// replay mode (import → replay → divergence comparison).
//
// Every function that touches the DOM is isolated behind `downloadReproduction`
// and guarded with a `typeof window === 'undefined'` check so the pure helpers
// stay callable in tests and in the SSR/Node build. The remaining functions are
// pure and deterministic — no network, no `eval`, no dynamic imports.
//
// Contract: combat debug workspace (execution prompt §8)

import type {
  CombatDivergence,
  CombatReplay,
  CombatReproduction,
  CombatReproductionReplayResult,
} from '@aikami/types';
import {
  type CombatReproductionImportResult,
  findFirstCombatDivergence,
  parseCombatReproductionJson,
  replayCombatReproduction,
} from '@aikami/utils';

export type { CombatReproductionImportResult } from '@aikami/utils';

/**
 * Outcome of comparing a freshly replayed log against the recorded one.
 * `matched` is true only when no divergence was found and the final states are
 * byte-for-byte equivalent through the canonical JSON serializer.
 */
export type CombatDebugReplayComparison = {
  readonly matched: boolean;
  readonly firstDivergence: CombatDivergence | undefined;
  readonly expectedEventCount: number;
  readonly actualEventCount: number;
};

/** Default download name when the caller does not supply one. */
const DEFAULT_REPRODUCTION_FILE_NAME = 'combat-reproduction.json';

/**
 * Serializes a reproduction to its export JSON string. Pure and stable: the
 * same bundle always yields the same bytes so a hash of the export is
 * comparable across machines.
 */
export const exportReproductionToJson = (reproduction: CombatReproduction): string =>
  JSON.stringify(reproduction);

/**
 * Triggers a browser download of a Blob via an object URL and an anchor.
 *
 * The repo has no shared, exported blob-download helper: `_downloadBlob` in
 * `export_service.svelte.ts` is module-private (service files may not export
 * helpers), and `downloadFile` in `@aikami/frontend/utils` takes an already
 * minted URL and dereferences `document` unguarded. This is the minimal local
 * equivalent, and it revokes the object URL so the blob is not retained.
 */
const triggerDownload = (options: { blob: Blob; fileName: string }): void => {
  const { blob, fileName } = options;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

/**
 * Downloads a reproduction as a JSON file. Browser-only: returns early (no-op)
 * when there is no DOM, so the helper is safe to call from tests and from code
 * paths that may run before mount.
 */
export const downloadReproduction = (options: {
  reproduction: CombatReproduction;
  fileName?: string;
}): void => {
  if (typeof window === 'undefined') {
    return;
  }
  const fileName = options.fileName ?? DEFAULT_REPRODUCTION_FILE_NAME;
  const json = exportReproductionToJson(options.reproduction);
  const blob = new Blob([json], { type: 'application/json' });
  triggerDownload({ blob, fileName });
};

/**
 * Validates a raw reproduction string (e.g. a dropped file's text) without
 * executing it. Delegates to the shared size-checked parser; the caller decides
 * whether to replay the returned bundle.
 */
export const importReproductionFromText = (raw: string): CombatReproductionImportResult =>
  parseCombatReproductionJson(raw);

/**
 * Replays an imported reproduction through the production pure kernel. Never
 * calls AI, content lookup or network — the reproduction is the sole authority.
 */
export const replayImportedReproduction = (
  reproduction: CombatReproduction,
): CombatReproductionReplayResult => replayCombatReproduction(reproduction);

/**
 * Compares an expected replay against an actual one. Divergence is the first
 * event mismatch reported by the shared canonical-JSON comparison; if none is
 * found, the final states are compared directly so a difference that only shows
 * up in the terminal state is still reported as a mismatch.
 */
export const compareReproduction = (options: {
  expected: CombatReplay;
  actual: CombatReplay;
}): CombatDebugReplayComparison => {
  const { expected, actual } = options;
  const divergence = findFirstCombatDivergence(expected, actual);
  const firstDivergence = divergence ?? undefined;
  const finalStatesEqual =
    JSON.stringify(expected.finalState) === JSON.stringify(actual.finalState);

  return {
    matched: firstDivergence === undefined && finalStatesEqual,
    firstDivergence,
    expectedEventCount: expected.events.length,
    actualEventCount: actual.events.length,
  };
};

/**
 * Human-readable summary of a divergence, e.g. `Divergence at event #3
 * (revision 7)`. Intended for the replay-mode banner; keeps the UI free of
 * index/revision formatting logic.
 */
export const describeDivergence = (divergence: CombatDivergence): string =>
  `Divergence at event #${divergence.eventIndex} (revision ${divergence.stateRevision})`;
