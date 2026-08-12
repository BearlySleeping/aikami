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
  for await (const chunk of stream) {
    onChunk(decoder.decode(chunk as Buffer, { stream: true }));
  }
}

// ── Async run ─────────────────────────────────────────────────────

export async function runCommand(
  command: string,
  args: string[] = [],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
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
  let killed = false;

  const appendStdout = (text: string) => {
    if (stdout.length < maxBuffer) {
      stdout += text;
    }
  };
  const appendStderr = (text: string) => {
    if (stderr.length < maxBuffer) {
      stderr += text;
    }
  };

  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    // Run in its own process group (via setsid) so killProcessTree /
    // killProcessTreeForce can terminate the whole tree via `-pid`.
    detached: true,
  });

  // Close stdin immediately — prevents CLI tools from hanging on prompts
  child.stdin?.end();

  // Read stdout/stderr in background
  const readPromise = Promise.all([
    readStream(child.stdout, appendStdout),
    readStream(child.stderr, appendStderr),
  ]);

  // ── Timeout handling ──────────────────────────────────────────
  let timeoutHandle: NodeJS.Timeout | undefined;
  let escalateHandle: NodeJS.Timeout | undefined;
  let finished = false;

  const onTimeout = () => {
    if (finished) {
      return;
    }
    killed = true;
    appendStderr(`\n[Process timed out after ${timeoutMs / 1000}s]`);
    killProcessTree(child.pid);

    // Escalate to SIGKILL after grace period
    escalateHandle = setTimeout(() => {
      if (!finished) {
        killProcessTreeForce(child.pid);
      }
    }, SIGTERM_GRACE_MS);
  };

  // ── AbortSignal / Pi cancellation ────────────────────────────
  if (options.signal) {
    if (options.signal.aborted) {
      onTimeout();
    } else {
      options.signal.addEventListener('abort', onTimeout, { once: true });
    }
  }

  // ── Timeout timer ────────────────────────────────────────────
  if (!killed) {
    timeoutHandle = setTimeout(onTimeout, timeoutMs);
  }

  // ── Wait for exit ────────────────────────────────────────────
  const exitCode = await new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', (err) => {
      appendStderr(`\n[Failed to start process: ${err.message}]`);
      resolve(null);
    });
  });
  finished = true;

  // Clean up timers
  clearTimeout(timeoutHandle);
  clearTimeout(escalateHandle);
  if (options.signal) {
    options.signal.removeEventListener('abort', onTimeout);
  }

  // Ensure stream reading completes
  await readPromise;

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    code: exitCode,
    killed,
    durationMs: Date.now() - startTime,
  };
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
