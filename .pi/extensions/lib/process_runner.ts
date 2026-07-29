// .pi/extensions/lib/process_runner.ts
//
// Deadlock-proof child process execution using Bun.spawn.
// Replaces pi.exec() for long-running or test/build commands where
// the built-in executor can hang due to inherited stdio handles.
//
// Using Bun.spawn avoids Node.js child_process deadlock issues entirely.

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
  stream: ReadableStream<Uint8Array> | null,
  onChunk: (text: string) => void,
): Promise<void> {
  if (!stream) {
    return;
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      onChunk(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
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

  const child = Bun.spawn([command, ...args], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Close stdin immediately — prevents CLI tools from hanging on prompts
  child.stdin?.end();

  // Read stdout/stderr in background
  const readPromise = Promise.all([
    readStream(child.stdout, appendStdout),
    readStream(child.stderr, appendStderr),
  ]);

  // ── Timeout handling ──────────────────────────────────────────
  let timeoutHandle: Timer | undefined;
  let escalateHandle: Timer | undefined;
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
  const exitCode = await child.exited;
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
  code: number;
};

/**
 * Run a command synchronously using Bun.spawnSync.
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

  const result = Bun.spawnSync([command, ...args], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const stdout = Buffer.from(result.stdout).toString('utf8').trim();
  const stderr = Buffer.from(result.stderr).toString('utf8').trim();
  const code = result.exitCode;

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
