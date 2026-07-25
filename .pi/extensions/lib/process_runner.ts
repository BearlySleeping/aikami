// .pi/extensions/lib/process_runner.ts
//
// Deadlock-proof child process execution. Replaces pi.exec() for long-running
// or test/build commands where the built-in executor's `close`-event wait can
// hang due to inherited stdio handles from worker threads / daemon children.
//
// Fixes applied:
//   1. `exit` event (not `close`) — resolves when the main process terminates
//   2. Forcible stdio destruction after exit — prevents background workers from
//      keeping the tool invocation alive
//   3. Process group cleanup — SIGTERM → 3s grace → SIGKILL on the whole group
//   4. CI=true, FORCE_COLOR=1, GIT_TERMINAL_PROMPT=0 — non-interactive mode
//   5. stdin closed immediately — prevents CLI tools from hanging on prompts
//   6. Configurable timeout + AbortSignal support for session cancellation

import { type ChildProcess, spawn } from 'node:child_process';

// ── Types ─────────────────────────────────────────────────────────

export interface RunCommandOptions {
  /** Working directory (default: process.cwd()) */
  cwd?: string;
  /** Extra env vars merged on top of process.env + CI defaults */
  env?: Record<string, string>;
  /** Timeout in milliseconds. Default: 180_000 (3 min). */
  timeoutMs?: number;
  /** Default timeout when timeoutMs is omitted. */
  defaultTimeoutMs?: number;
  /** Max stdout+stderr buffer size in bytes (default: 10 MiB). */
  maxBufferBytes?: number;
  /** AbortSignal from Pi cancellation context. */
  signal?: AbortSignal;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  /** Exit code, or null if killed by signal. */
  code: number | null;
  /** True when the process was killed due to timeout. */
  killed: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

// ── Default environment injected into every child ──────────────────

const CI_ENV: Record<string, string> = {
  CI: 'true',
  FORCE_COLOR: '1',
  GIT_TERMINAL_PROMPT: '0',
};

const DEFAULT_TIMEOUT_MS = 180_000; // 3 min
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MiB
const SIGTERM_GRACE_MS = 3000; // wait 3 s after SIGTERM before SIGKILL

// ── Implementation ─────────────────────────────────────────────────

export async function runCommand(
  command: string,
  args: string[] = [],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? MAX_BUFFER_BYTES;

  let stdout = '';
  let stderr = '';
  let killed = false;
  let isResolved = false;

  return new Promise<RunCommandResult>((resolve) => {
    // ── Merge environment: process.env → CI overrides → caller overrides ──
    const processEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...CI_ENV,
      ...options.env,
    };

    const child: ChildProcess = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: processEnv,
      // detached on Unix so we can kill the whole process group (-pid)
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // ── Close stdin immediately ─────────────────────────────────
    child.stdin?.end();

    // ── Drain stdout / stderr with buffer cap ────────────────────
    const appendBuffer = (chunk: Buffer, isStderr: boolean) => {
      const text = chunk.toString('utf8');
      if (isStderr) {
        if (stderr.length < maxBuffer) stderr += text;
      } else {
        if (stdout.length < maxBuffer) stdout += text;
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => appendBuffer(chunk, false));
    child.stderr?.on('data', (chunk: Buffer) => appendBuffer(chunk, true));

    // ── Single-shot resolution guard ────────────────────────────
    const cleanupAndResolve = (code: number | null, _signal: string | null) => {
      if (isResolved) return;
      isResolved = true;

      clearTimeout(timer);
      if (options.signal) {
        options.signal.removeEventListener('abort', handleAbort);
      }

      // 🔴 CRITICAL: destroy stdio streams so background worker threads
      // that inherited the pipe handles cannot keep us alive.
      child.stdout?.destroy();
      child.stderr?.destroy();

      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
        killed,
        durationMs: Date.now() - startTime,
      });
    };

    // ── Process tree kill (graceful → forceful) ──────────────────
    const killProcessTree = (sig: 'SIGTERM' | 'SIGKILL') => {
      if (child.pid === undefined) return;
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
        } else {
          // Negative PID kills the entire process group
          process.kill(-child.pid, sig);
        }
      } catch {
        // Fallback: kill just the direct child
        try {
          child.kill(sig);
        } catch {
          // Already dead — nothing to do
        }
      }
    };

    // ── Timeout handler ──────────────────────────────────────────
    const timer = setTimeout(() => {
      killed = true;
      appendBuffer(Buffer.from(`\n[Process timed out after ${timeoutMs / 1000}s]`), true);
      killProcessTree('SIGTERM');

      // Escalate to SIGKILL if SIGTERM is ignored
      setTimeout(() => {
        if (!isResolved) {
          killProcessTree('SIGKILL');
          cleanupAndResolve(null, 'SIGKILL');
        }
      }, SIGTERM_GRACE_MS);
    }, timeoutMs);

    // ── AbortSignal / Pi session cancellation ────────────────────
    const handleAbort = () => {
      appendBuffer(Buffer.from('\n[Operation cancelled by user]'), true);
      killProcessTree('SIGKILL');
      cleanupAndResolve(null, 'SIGABRT');
    };

    if (options.signal) {
      if (options.signal.aborted) {
        handleAbort();
        return;
      }
      options.signal.addEventListener('abort', handleAbort, { once: true });
    }

    // ── 🔴 Listen to `exit` (NOT `close`) ───────────────────────
    // `exit` fires when the main process terminates. `close` waits until
    // ALL inherited stdio handles are released, which may never happen
    // if worker threads / daemons hold them open.
    child.on('exit', (code, exitSignal) => {
      cleanupAndResolve(code, exitSignal);
    });

    // ── Process error (spawn failure) ────────────────────────────
    child.on('error', (err: NodeJS.ErrnoException) => {
      appendBuffer(Buffer.from(`\n[Failed to start process: ${err.message}]`), true);
      cleanupAndResolve(1, null);
    });
  });
}
