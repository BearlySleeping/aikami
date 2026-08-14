// .pi/extensions/lib/process_runner.ts
//
// Deadlock-proof child process execution using node:child_process.
// Replaces pi.exec() for long-running or test/build commands where
// the built-in executor can hang due to inherited stdio handles.
//
// 🔴 Extensions run inside the `pi` CLI process itself, which is always
// launched via its `#!/usr/bin/env node` shebang — never under the Bun
// runtime, regardless of what's on PATH or which package manager the repo
// uses elsewhere. So this file must stick to node:child_process; a `Bun.*`
// call here throws "Bun is not defined" every time, deterministically.
// Deadlock-safety comes from manually draining stdout/stderr and killing
// the whole process group on timeout, not from which runtime spawns it.

import { spawn, spawnSync } from 'node:child_process';

export type RunCommandOptions = {
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
};

export type RunCommandResult = {
  stdout: string;
  stderr: string;
  /** Exit code, or null if killed by signal. */
  code: number | null;
  /** True when the process was killed due to timeout. */
  killed: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
};

// ── Default environment injected into every child ──────────────────

const CI_ENV: Record<string, string> = {
  CI: 'true',
  FORCE_COLOR: '1',
  GIT_TERMINAL_PROMPT: '0',
};

const DEFAULT_TIMEOUT_MS = 180_000; // 3 min
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MiB
const SIGTERM_GRACE_MS = 3000; // wait 3 s after SIGTERM before SIGKILL

// ── Helpers ────────────────────────────────────────────────────────

function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already dead
    }
  }
}

function killProcessTreeForce(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already dead
    }
  }
}

async function readStream(
  stream: NodeJS.ReadableStream | null,
  onChunk: (text: string) => void,
): Promise<void> {
  if (!stream) {
    return;
  }
  const decoder = new TextDecoder();
  try {
    for await (const chunk of stream) {
      onChunk(decoder.decode(chunk as Buffer, { stream: true }));
    }
  } catch {
    // A spawn failure (ENOENT) or a killed process group tears the pipes down
    // mid-read, surfacing as ERR_STREAM_PREMATURE_CLOSE. That is not a caller
    // error: it just means there is no more output. Swallow it so the
    // completion promise still RESOLVES with the exit code — callers treat
    // runCommand as non-throwing and do not wrap it in try/catch.
  }
}

// ── Streaming run ─────────────────────────────────────────────────

/**
 * Live handle on a running child process.
 *
 * `runCommand` waits for the exit code; a handle instead lets the caller
 * observe output as it arrives — which is what long-running tools need in
 * order to stream progress through pi's `onUpdate` callback rather than
 * blocking a turn silently for minutes.
 */
export type CommandHandle = {
  readonly pid: number | undefined;
  /** Resolves when the process exits, is killed, or times out. Never rejects. */
  readonly completion: Promise<RunCommandResult>;
  /** Interleaved stdout+stderr captured so far. */
  output(): string;
  stdout(): string;
  stderr(): string;
  /** True until the process exits. */
  running(): boolean;
  /** Exit code once exited; undefined while still running. */
  exitCode(): number | null | undefined;
  /** SIGTERM the process group, escalating to SIGKILL after the grace period. */
  kill(force?: boolean): void;
};

/**
 * Spawns a command and returns immediately with a live handle.
 *
 * Same deadlock-safety as runCommand: own process group, stdin closed, both
 * pipes drained continuously, whole tree killed on timeout.
 */
export function startCommand(
  command: string,
  args: string[] = [],
  options: RunCommandOptions = {},
): CommandHandle {
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? MAX_BUFFER_BYTES;
  const cwd = options.cwd ?? process.cwd();
  const env = {
    ...(process.env as Record<string, string>),
    ...CI_ENV,
    ...options.env,
  };

  let stdout = '';
  let stderr = '';
  let combined = '';
  let killed = false;
  let finished = false;
  let exitCode: number | null | undefined;

  const appendStdout = (text: string) => {
    if (stdout.length < maxBuffer) {
      stdout += text;
    }
    if (combined.length < maxBuffer) {
      combined += text;
    }
  };
  const appendStderr = (text: string) => {
    if (stderr.length < maxBuffer) {
      stderr += text;
    }
    if (combined.length < maxBuffer) {
      combined += text;
    }
  };

  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    // Own process group (via setsid) so the whole tree can be killed by -pid.
    detached: true,
  });

  // Close stdin immediately — prevents CLI tools from hanging on prompts.
  child.stdin?.end();

  const readPromise = Promise.all([
    readStream(child.stdout, appendStdout),
    readStream(child.stderr, appendStderr),
  ]);

  let timeoutHandle: NodeJS.Timeout | undefined;
  let escalateHandle: NodeJS.Timeout | undefined;

  const terminate = (reason?: string) => {
    if (finished) {
      return;
    }
    killed = true;
    if (reason) {
      appendStderr(`\n[${reason}]`);
    }
    killProcessTree(child.pid);
    escalateHandle = setTimeout(() => {
      if (!finished) {
        killProcessTreeForce(child.pid);
      }
    }, SIGTERM_GRACE_MS);
  };

  const onTimeout = () => terminate(`Process timed out after ${timeoutMs / 1000}s`);
  const onAbort = () => terminate('Process cancelled');

  if (options.signal) {
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  if (!killed) {
    timeoutHandle = setTimeout(onTimeout, timeoutMs);
  }

  const completion = (async (): Promise<RunCommandResult> => {
    const code = await new Promise<number | null>((resolve) => {
      child.once('exit', (exit) => resolve(exit));
      child.once('error', (err) => {
        appendStderr(`\n[Failed to start process: ${err.message}]`);
        resolve(null);
      });
    });
    finished = true;
    exitCode = code;

    clearTimeout(timeoutHandle);
    clearTimeout(escalateHandle);
    options.signal?.removeEventListener('abort', onAbort);

    // Let the pipes finish draining so no trailing output is lost.
    await readPromise;

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      code,
      killed,
      durationMs: Date.now() - startTime,
    };
  })();

  return {
    pid: child.pid,
    completion,
    output: () => combined,
    stdout: () => stdout,
    stderr: () => stderr,
    running: () => !finished,
    exitCode: () => exitCode,
    kill: (force = false) => {
      if (force) {
        killProcessTreeForce(child.pid);
        return;
      }
      terminate('Killed by request');
    },
  };
}

// ── Async run ─────────────────────────────────────────────────────

/**
 * Runs a command to completion.
 *
 * Thin wrapper over startCommand — the spawn, drain, timeout and kill logic
 * lives in exactly one place so the blocking and streaming paths cannot drift.
 */
export async function runCommand(
  command: string,
  args: string[] = [],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  return startCommand(command, args, options).completion;
}

// ── Sync run (for simple gh/git calls) ────────────────────────────

export type RunSyncOptions = {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type RunSyncResult = {
  stdout: string;
  stderr: string;
  /** Exit code, or null when the process was killed (timeout/signal). */
  code: number | null;
};

/**
 * Run a command synchronously using node:child_process's spawnSync.
 * Drop-in replacement for `execSync` from node:child_process.
 */
export function runSync(
  command: string,
  args: string[] = [],
  options: RunSyncOptions = {},
): RunSyncResult {
  const cwd = options.cwd ?? process.cwd();
  const env = {
    ...(process.env as Record<string, string>),
    ...CI_ENV,
    ...options.env,
  };

  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    encoding: 'utf8',
  });

  const stdout = (result.stdout ?? '').toString().trim();
  const stderr =
    (result.stderr ?? '').toString().trim() || (result.error ? result.error.message : '');
  const code: number | null = result.status;

  return { stdout, stderr, code };
}

/**
 * Run a command synchronously, returning trimmed stdout.
 * Throws on non-zero exit code (like execSync with stdio: 'pipe').
 */
export function runSyncOrThrow(
  command: string,
  args: string[] = [],
  options: RunSyncOptions = {},
): string {
  const result = runSync(command, args, options);
  if (result.code !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')} (exit ${result.code})\n${result.stderr}`,
    );
  }
  return result.stdout;
}
