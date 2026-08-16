// scripts/src/lib/env/direnv_detect.ts
/**
 * Direnv detection + non-direnv fallbacks.
 *
 * Aikami's .envrc (scripts/direnv/bootstrap.sh) is the happy path: it loads
 * the Nix flake devShell (bun, node, jdk, chromium, playwright browsers,
 * secrets) and exports AIKAMI_MODE / AIKAMI_PROJECT_ID / AIKAMI_IS_EMULATOR.
 * But direnv is only present when the developer installed it — `bun run setup`
 * treats it as the recommended-but-optional path, and Windows developers
 * (without WSL + Nix) typically run without direnv at all, installing tools
 * manually and relying on .env.local.
 *
 * Everything in scripts/src/lib that would otherwise hard-require direnv
 * should go through THIS module so non-direnv developers get a working
 * fallback instead of "command not found: direnv":
 *
 *   hasDirenv()        — is the `direnv` binary available on PATH? (cached)
 *   isDirenvLoaded()   — did .envrc already run in this process?
 *   resolveAikamiEnv() — non-direnv fallback: derive AIKAMI_MODE + project id
 *                        from .env.local, mirroring bootstrap.sh's contract
 *   direnvExecCommand()— wrap a shell command with `direnv exec <cwd>` ONLY
 *                        when direnv is actually available; otherwise return
 *                        the command unchanged so it runs with the user's own
 *                        PATH/env (manual tool installs, .env.local fallback).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AikamiMode, isAikamiMode } from './mode';
import { findBash, posixQuote, which } from './which';

// ── Mode → project map ──────────────────────────────────────────────────
// 🔴 Keep in sync with:
//   - packages/shared/constants/src/lib/project.ts (MODE_PROJECT_MAP)
//   - scripts/direnv/bootstrap.sh (_AIKAMI_PROJECT_MAP)
//   - scripts/src/lib/ops/switch_mode.ts (MODE_PROJECTS)
const MODE_PROJECT_MAP: Record<string, string> = {
  emulator: 'demo-aikami-emulator',
  staging: 'aikami-staging',
  production: 'aikami-production',
};

let _hasDirenv: boolean | undefined;

/**
 * True when the `direnv` binary is on PATH. Cached after the first call
 * (neither the binary nor the PATH is expected to change mid-process).
 * Runtime-agnostic — `which` works identically under Bun and Node, which
 * matters because pi extensions import this module and pi runs under Node.
 */
export const hasDirenv = (): boolean => {
  if (_hasDirenv === undefined) {
    _hasDirenv = which('direnv') !== null;
  }
  return _hasDirenv;
};

/** True when THIS process was already set up by .envrc (direnv + Nix). */
export const isDirenvLoaded = (): boolean =>
  process.env.AIKAMI_ENV_LOADED === '1' ||
  process.env.AIKAMI_NIX_READY === '1' ||
  process.env.IN_NIX_SHELL !== undefined;

export type AikamiEnv = {
  mode: AikamiMode;
  projectId: string;
  isEmulator: boolean;
};

/**
 * Non-direnv fallback: resolve the AIKAMI_* contract from .env.local —
 * the same file bootstrap.sh's `_aikami_load_mode` reads. Defaults to
 * emulator, matching .envrc behavior.
 */
export const resolveAikamiEnv = (root: string): AikamiEnv => {
  let mode: AikamiMode = 'emulator';
  const envLocal = join(root, '.env.local');
  if (existsSync(envLocal)) {
    const match = readFileSync(envLocal, 'utf8').match(/^AIKAMI_MODE=(\S+)\s*$/m);
    if (match?.[1] && isAikamiMode(match[1])) {
      mode = match[1];
    }
  }
  const projectId = MODE_PROJECT_MAP[mode] ?? 'demo-aikami-emulator';
  return { mode, projectId, isEmulator: mode === 'emulator' };
};

/**
 * Wrap a command so it runs inside the flake devShell via
 * `direnv exec <cwd> bash -c '<command>'` when direnv is available.
 * When it isn't — or when there is no bash to hand it to — return the command
 * unchanged; the caller's own PATH/env (manual tool installs, .env.local
 * fallback) is assumed.
 *
 * Mirrors herdr/session.ts `wrapCommand`, minus the interactive
 * echo/read trailer — safe for headless worker panes.
 */
export const direnvExecCommand = (command: string, cwd: string): string => {
  const bash = findBash();
  if (!hasDirenv() || !bash) {
    return command;
  }
  return `direnv exec ${posixQuote(cwd)} ${posixQuote(bash)} -c ${posixQuote(command)}`;
};
