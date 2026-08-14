// packages/shared/local-ai/src/lib/probe_executor.ts
//
// The injected boundary between the portable planning core and a host's
// process/filesystem access. The core NEVER spawns a process itself — it
// declares this interface and receives an implementation (Bun/CLI, Tauri,
// fixture-replay). See the contract table in the C-391 design reference:
//
//   - Signature: run(command, args, { timeoutMs }): Promise<ProbeResult>
//   - No shell: command and args are a fixed array; an adapter never builds
//     or evaluates a shell string.
//   - Never throws: missing binary, non-zero exit, timeout, permission
//     denial all resolve to a ProbeResult with ok:false and a discriminated
//     reason. Rejection is reserved for adapter bugs.
//   - Honours the timeout: the promise settles within timeoutMs; the child
//     is killed, not abandoned.
//   - Byte-faithful: stdout/stderr returned undecorated — no trimming,
//     locale translation, or colour stripping.
//   - Side-effect free: probes are read-only.
//   - Filesystem reads (readTextFile, statfs) are part of the same seam so
//     /proc/meminfo and free-disk checks are stubbable identically.

/**
 * Discriminated result of a single probe. `ok: false` never throws — the
 * caller decides how to degrade.
 */
export type ProbeResult =
  | {
      readonly ok: true;
      readonly stdout: string;
      readonly stderr: string;
      readonly exitCode: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'not-found' | 'timeout' | 'denied' | 'failed';
      readonly detail?: string;
    };

/**
 * Free-space result against the volume backing a path.
 */
export type StatfsResult = { readonly freeBytes: number } | { readonly ok: false };

/**
 * The injected boundary every host adapter must satisfy.
 */
export type ProbeExecutor = {
  run(
    command: string,
    args: readonly string[],
    options: { readonly timeoutMs: number },
  ): Promise<ProbeResult>;
  /** Probing /proc/meminfo and friends — stubbable on the same seam. */
  readTextFile(path: string): Promise<ProbeResult>;
  /** Free-space check against the volume backing a given path. */
  statfs(path: string): Promise<StatfsResult>;
};

/** Convenience: true when a probe succeeded. */
export const isOk = (result: ProbeResult): result is Extract<ProbeResult, { ok: true }> =>
  result.ok;
