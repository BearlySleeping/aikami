// packages/shared/utils/src/lib/rules/combat_reproduction.ts
//
// Reproduction export/import helpers for the dev combat debugging workspace.
// A reproduction is validated BEFORE it is executed, then replayed through the
// same pure `replayCombat` kernel the production replay path uses — the rules
// are never implemented a second time.
//
// Module graph: `combat_replay.ts` + `@aikami/schemas` ← this module. The
// kernel does not import it, so the graph stays acyclic.
//
// Contract: combat debug workspace (execution prompt §8)

import {
  COMBAT_REPRODUCTION_MAX_BYTES,
  COMBAT_REPRODUCTION_MAX_COMMANDS,
  COMBAT_REPRODUCTION_MAX_CHECKPOINTS,
  COMBAT_REPRODUCTION_VERSION,
  CombatReproductionSchema,
  schemaCheck,
} from '@aikami/schemas';
import type {
  CombatReproduction,
  CombatReproductionReplayResult,
} from '@aikami/types';
import { canonicalCombatJson } from './combat_canonical_json';
import { replayCombat } from './combat_replay';

/** Result of validating raw import input before any allocation/execution. */
export type CombatReproductionImportResult =
  | { ok: true; reproduction: CombatReproduction }
  | { ok: false; error: string };

const isValidReproductionObject = (value: unknown): value is CombatReproduction =>
  schemaCheck(CombatReproductionSchema, value);

/**
 * Validates raw import input (already-parsed JSON) against the reproduction
 * schema and the hard limits. Never throws and never executes anything: the
 * caller decides whether to replay the returned bundle.
 */
export const parseCombatReproduction = (value: unknown): CombatReproductionImportResult => {
  if (!isValidReproductionObject(value)) {
    return { ok: false, error: 'Reproduction does not match the expected schema.' };
  }
  if (value.reproductionVersion !== COMBAT_REPRODUCTION_VERSION) {
    return {
      ok: false,
      error: `Unsupported reproduction version ${value.reproductionVersion}; expected ${COMBAT_REPRODUCTION_VERSION}.`,
    };
  }
  if (value.commands.length > COMBAT_REPRODUCTION_MAX_COMMANDS) {
    return { ok: false, error: 'Reproduction exceeds the command limit.' };
  }
  if (value.checkpoints.length > COMBAT_REPRODUCTION_MAX_CHECKPOINTS) {
    return { ok: false, error: 'Reproduction exceeds the checkpoint limit.' };
  }
  if (!value.complete) {
    return {
      ok: false,
      error:
        'Reproduction is marked incomplete (truncated trace). It cannot be replayed exactly.',
    };
  }
  return { ok: true, reproduction: value };
};

/**
 * Validates a serialized reproduction string: size is checked BEFORE JSON
 * parsing so a hostile file cannot force a large allocation, then the parsed
 * object goes through {@link parseCombatReproduction}.
 */
export const parseCombatReproductionJson = (raw: string): CombatReproductionImportResult => {
  if (raw.length > COMBAT_REPRODUCTION_MAX_BYTES) {
    return { ok: false, error: 'Reproduction file exceeds the maximum size.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Reproduction is not valid JSON.' };
  }
  return parseCombatReproduction(parsed);
};

/**
 * Replays a reproduction with the production pure kernel. Reports the final
 * state, whether it matched the recorded hash, and the first divergent command
 * index. Never calls AI, content lookup or network.
 */
export const replayCombatReproduction = (
  reproduction: CombatReproduction,
): CombatReproductionReplayResult => {
  const { replay, finalState } = replayCombat({
    initialState: reproduction.recordedInitialState,
    rulesVersion: reproduction.rulesVersion,
    commands: reproduction.commands,
  });

  const expected = reproduction.expectedFinalHash;
  let matchedExpected: boolean | undefined;
  if (expected !== undefined) {
    matchedExpected = finalState !== null && hashFinalState(finalState) === expected;
  }

  const divergence =
    finalState === null && reproduction.commands.length > 0 ? replay.events.length : undefined;

  return {
    reproductionVersion: reproduction.reproductionVersion,
    scenarioId: reproduction.scenarioId,
    encounterRunId: reproduction.encounterRunId,
    replay,
    finalState,
    matchedExpected: matchedExpected ?? null,
    divergence: divergence ?? null,
  };
};

/**
 * Stable content hash of a final combat state. Used to detect divergence
 * without shipping a full expected state. Not cryptographic — this is an
 * integrity/diagnostic check, not a security boundary.
 */
export const hashFinalState = (state: unknown): string => {
  const json = canonicalCombatJson(state);
  let hash = 5381;
  for (let index = 0; index < json.length; index++) {
    hash = (hash * 33) ^ json.charCodeAt(index);
  }
  return `cjs1-${(hash >>> 0).toString(16)}`;
};
