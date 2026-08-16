// scripts/src/lib/env/mode.ts
//
// Single source of truth for Aikami deployment-mode resolution.
//
// Aikami runs in three modes — emulator, staging, production — selected by
// the `AIKAMI_MODE` env var (set by direnv/.env.local, or passed explicitly).
// Every script and extension that needs a mode should resolve it through
// `resolveAikamiMode()` here, which:
//
//   1. reads `process.env.AIKAMI_MODE`
//   2. validates it against the known modes
//   3. defaults to `emulator` when unset/invalid
//
// The emulator is the safe default: staging/production require credentials
// that fail fast anyway, so an accidental default can never silently hit the
// cloud, and `emulator` is what a fresh local checkout should run.
//
// 🔴 This module must stay dependency-free (node: only) — it is imported by
//    both Bun scripts and pi extensions (which run under Node), and must not
//    create import cycles with higher-level modules.

/** Valid Aikami deployment modes. */
export const AIKAMI_MODES = ['emulator', 'staging', 'production'] as const;

export type AikamiMode = (typeof AIKAMI_MODES)[number];

/** True when `value` is one of the known modes. */
export const isAikamiMode = (value: string | undefined): value is AikamiMode =>
  value !== undefined && (AIKAMI_MODES as readonly string[]).includes(value);

/**
 * Resolve the current mode from the environment, defaulting to emulator.
 * Never throws — an unset or invalid `AIKAMI_MODE` yields `'emulator'`.
 */
export const resolveAikamiMode = (): AikamiMode => {
  const envMode = process.env.AIKAMI_MODE;
  return isAikamiMode(envMode) ? envMode : 'emulator';
};

/** Convenience: true when the resolved mode is the local emulator. */
export const isEmulatorMode = (): boolean => resolveAikamiMode() === 'emulator';
