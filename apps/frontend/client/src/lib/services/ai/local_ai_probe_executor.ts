// apps/frontend/client/src/lib/services/ai/local_ai_probe_executor.ts
//
// Tauri ProbeExecutor adapter — wraps Tauri IPC invoke() calls into the
// ProbeExecutor seam that @aikami/local-ai's detectHardware/recommend/tier
// expect. Only works inside a Tauri webview; use fixture_executor in tests.
//
// C-467 AC-1: must pass probe_executor.contract_suite.ts identically to
// the Bun adapter, proving the two hosts are interchangeable.

import type { ProbeExecutor, ProbeResult, StatfsResult } from '@aikami/local-ai';

type ProbeFailureReason = Extract<ProbeResult, { readonly ok: false }>['reason'];

/**
 * Key used to access Tauri's IPC internals on the global window object.
 * Tauri v2 exposes `window.__TAURI_INTERNALS__` when `withGlobalTauri: true`
 * is set in tauri.conf.json (already configured).
 */
const TAURI_INTERNALS_KEY = '__TAURI_INTERNALS__';

/**
 * Internal invoke helper — accesses Tauri's IPC bridge through the global
 * window object injected by `withGlobalTauri`.
 */
const tauriInvoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  const internals = (
    window as unknown as Record<
      string,
      { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<T> }
    >
  )[TAURI_INTERNALS_KEY]; // guard-ignore lint/type-safety/casting: Tauri v2 global IPC bridge
  return internals.invoke(cmd, args);
};

/** Result payload shape from the Rust-side probe_run/probe_read_text_file commands. */
type ProbeResultPayload = {
  ok: boolean;
  stdout: string;
  stderr: string;
  // biome-ignore lint/style/useNamingConvention: matches Rust serde serialization
  exit_code: number;
  reason?: string | null;
  detail?: string | null;
};

/**
 * Creates a ProbeExecutor backed by Tauri IPC commands.
 *
 * The returned adapter is stateless — each call goes through the Tauri invoke
 * bridge to the Rust backend. Use this in production (Tauri webview) and
 * fixture_executor in tests.
 */
export const createTauriProbeExecutor = (): ProbeExecutor => ({
  async run(
    command: string,
    args: readonly string[],
    options: { readonly timeoutMs: number },
  ): Promise<ProbeResult> {
    const payload = await tauriInvoke<ProbeResultPayload>('probe_run', {
      command,
      args: [...args],
      timeoutMs: options.timeoutMs,
    });

    if (payload.ok) {
      return {
        ok: true,
        stdout: payload.stdout,
        stderr: payload.stderr,
        exitCode: payload.exit_code,
      };
    }

    const reason = (payload.reason ?? 'failed') as ProbeFailureReason;
    return {
      ok: false,
      reason,
      detail: payload.detail ?? undefined,
    };
  },

  async readTextFile(path: string): Promise<ProbeResult> {
    const payload = await tauriInvoke<ProbeResultPayload>('probe_read_text_file', { path });

    if (payload.ok) {
      return {
        ok: true,
        stdout: payload.stdout,
        stderr: payload.stderr,
        exitCode: payload.exit_code,
      };
    }

    const reason = (payload.reason ?? 'failed') as ProbeFailureReason;
    return {
      ok: false,
      reason,
      detail: payload.detail ?? undefined,
    };
  },

  async statfs(path: string): Promise<StatfsResult> {
    const result = await tauriInvoke<StatfsResult | { ok: boolean }>('probe_statfs', { path });
    if ('freeBytes' in result && typeof result.freeBytes === 'number') {
      return { freeBytes: result.freeBytes };
    }
    return { ok: false };
  },
});
