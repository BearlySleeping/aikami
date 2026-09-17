// scripts/src/lib/env/process_info.ts
/**
 * Cross-platform process + port primitives.
 *
 * POSIX reaches for `lsof`/`ps`/`kill`; Windows has none of them and instead
 * ships `netstat`/`tasklist`/`taskkill`. Every helper here picks the right
 * one for `process.platform` and returns the same shape either way, so
 * callers hold no OS branches of their own.
 *
 * Policy (which PIDs are safe to kill, how old is "still booting") lives with
 * the caller — this module only reports facts and does what it's told.
 *
 * 🔴 Runtime-agnostic on purpose: pi extensions import the herdr code that
 * calls this, and pi runs under Node. Stick to node:child_process — see
 * scripts/src/lib/env/which.ts for the full explanation.
 */

import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';

/**
 * Run a command and resolve its stdout, or `null` if it could not run or
 * exited non-zero. Never rejects — a missing binary is an expected outcome
 * on a platform that doesn't ship it.
 */
const run = (command: string, args: string[], timeoutMs = 5000): Promise<string | null> =>
  new Promise((resolveRun) => {
    let settled = false;
    const settle = (value: string | null): void => {
      if (!settled) {
        settled = true;
        resolveRun(value);
      }
    };

    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });

    const timer = setTimeout(() => {
      child.kill();
      settle(null);
    }, timeoutMs);
    timer.unref?.();

    child.on('close', (code) => {
      clearTimeout(timer);
      settle(code === 0 ? stdout : null);
    });
    child.on('error', () => {
      clearTimeout(timer);
      settle(null);
    });
  });

/** Parse `netstat -ano -p tcp` output for PIDs LISTENING on `port`. */
export const parseNetstatPids = (output: string, port: number): number[] => {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    // "TCP  0.0.0.0:5173  0.0.0.0:0  LISTENING  12345"
    if (parts.length < 5 || parts[3] !== 'LISTENING') {
      continue;
    }
    const local = parts[1] ?? '';
    // Match the port after the FINAL colon so IPv6 ("[::]:5173") works too.
    const localPort = Number.parseInt(local.slice(local.lastIndexOf(':') + 1), 10);
    const pid = Number.parseInt(parts[4] ?? '', 10);
    if (localPort === port && Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }
  return [...pids];
};

/** Parse a `tasklist /NH /FO CSV` row into the image name (`node.exe`). */
export const parseTasklistName = (output: string): string | undefined =>
  output.trim().match(/^"([^"]+)"/)?.[1];

/**
 * Parse `ss -tlnpH` output for listening PIDs.
 * Row: `LISTEN 0 512 127.0.0.1:45999 0.0.0.0:* users:(("bun",pid=762939,fd=11))`
 * A socket shared by forked workers lists several `pid=` entries — take all.
 */
export const parseSsPids = (output: string): number[] => {
  const pids = new Set<number>();
  for (const match of output.matchAll(/pid=(\d+)/g)) {
    const pid = Number.parseInt(match[1] as string, 10);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }
  return [...pids];
};

/**
 * PIDs listening on `port`, newest lookup each call (never cached).
 * Empty when nothing listens or no lookup tool is available.
 */
export const pidsOnPort = async (port: number): Promise<number[]> => {
  if (isWindows) {
    const out = await run('netstat', ['-ano', '-p', 'tcp']);
    return out ? parseNetstatPids(out, port) : [];
  }

  // `ss` (iproute2) first: it ships with essentially every modern Linux and,
  // notably, IS in this repo's Nix devShell where `lsof` is NOT — so the lsof
  // path silently found nothing here and fell through to the unsafe
  // `fuser -k`, skipping the identity check entirely.
  const ss = await run('ss', ['-tlnpH', `sport = :${port}`]);
  if (ss !== null && ss.trim() !== '') {
    const pids = parseSsPids(ss);
    if (pids.length > 0) {
      return pids;
    }
  }

  // macOS has no `ss`; lsof is the native answer there.
  const lsof = await run('lsof', ['-ti', `tcp:${port}`]);
  if (lsof !== null) {
    return lsof
      .split('\n')
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  }
  return [];
};

/** Executable name for `pid` (lowercased, `.exe` kept), or undefined. */
export const processName = async (pid: number): Promise<string | undefined> => {
  if (isWindows) {
    const out = await run('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV']);
    return out ? parseTasklistName(out)?.toLowerCase() : undefined;
  }
  const out = await run('ps', ['-p', String(pid), '-o', 'comm=']);
  return out?.trim().toLowerCase() || undefined;
};

/** Whether the OS still reports a process for `pid`. */
const isProcessAlive = async (pid: number): Promise<boolean> => {
  if (isWindows) {
    const output = await run('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV']);
    return output !== null && parseTasklistName(output) !== undefined;
  }
  return (await run('kill', ['-0', String(pid)])) !== null;
};

/**
 * Terminate `pid` (and its children on Windows), confirming it is no longer alive.
 *
 * 🔴 This is a PID-only primitive: it signals whatever currently holds the
 * number. It is the right tool for a process the caller OWNS as a handle (a
 * `ChildProcess` it spawned). For a process identified by a persisted record it
 * must NOT be called directly — go through `herdr/process_termination.ts`'s
 * `terminateValidatedProcess`, which re-proves the PID's creation identity
 * immediately before this signal. A future escalation (SIGKILL after SIGTERM)
 * belongs in the same place for the same reason.
 */
export const killPid = async (pid: number): Promise<boolean> => {
  let result: string | null;
  if (isWindows) {
    // /T kills the tree — a dev server started through a shim would otherwise
    // leave the real listener holding the port. /F because vite/firebase
    // ignore the polite WM_CLOSE that taskkill sends without it.
    result = await run('taskkill', ['/PID', String(pid), '/T', '/F']);
  } else {
    result = await run('kill', [String(pid)]);
  }
  if (result === null) {
    return false;
  }
  for (const delay of [0, 50, 100, 200]) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (!(await isProcessAlive(pid))) {
      return true;
    }
  }
  return false;
};

/**
 * Last-resort port free-er for POSIX when `lsof` is missing. `fuser -k` kills
 * whatever holds the port with no identity check, so callers should only
 * reach for it after `pidsOnPort` came back empty.
 */
export const killPortUnsafe = async (port: number): Promise<void> => {
  if (isWindows) {
    return;
  }
  await run('fuser', ['-k', '-n', 'tcp', String(port)]);
};

/** Parse `ps -o etime=` ([[dd-]hh:]mm:ss) into seconds. */ export const parseEtime = (
  value: string,
): number | undefined => {
  const trimmed = value.trim();
  // Guard the empty string explicitly: ''.split() yields [''], and Number('')
  // is 0 — so without this, "no output" would report as a 0-second age.
  if (trimmed === '') {
    return undefined;
  }
  const parts = trimmed.split(/[-:]/).map(Number);
  if (parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  // Right-to-left: ss, mm, hh, dd — each unit 60× the last, days 24×hours.
  const multipliers = [1, 60, 3600, 86_400];
  return parts
    .reverse()
    .reduce((total, part, index) => total + part * (multipliers[index] ?? 0), 0);
};

/** Seconds since `pid` started, or undefined if it can't be determined. */
export const processAgeSeconds = async (pid: number): Promise<number | undefined> => {
  if (isWindows) {
    // Get-Process exposes StartTime directly; compute the delta in-process so
    // we don't have to parse a locale-formatted date back out.
    const out = await run('powershell', [
      '-NoProfile',
      '-Command',
      `[int]((Get-Date) - (Get-Process -Id ${pid}).StartTime).TotalSeconds`,
    ]);
    const seconds = Number.parseInt((out ?? '').trim(), 10);
    return Number.isFinite(seconds) ? seconds : undefined;
  }

  // GNU/Linux: etimes gives seconds outright.
  const etimes = await run('ps', ['-o', 'etimes=', '-p', String(pid)]);
  const etimesValue = Number.parseInt((etimes ?? '').trim(), 10);
  if (Number.isFinite(etimesValue)) {
    return etimesValue;
  }

  // BSD/macOS: no etimes, parse the etime clock format instead.
  const etime = await run('ps', ['-o', 'etime=', '-p', String(pid)]);
  return etime === null ? undefined : parseEtime(etime);
};

/**
 * Absolute process start time for `pid`, as Unix epoch **milliseconds**, or
 * undefined when it cannot be determined.
 *
 * 🔴 PID creation identity. A PID is not a stable identifier — the OS reuses
 * it once the original process exits. Comparing a process's start time to the
 * one captured when a record was written is what distinguishes "the process
 * we started" from "a different process that happens to have reused the PID".
 * A stale record whose PID has been recycled must NOT authorize a kill.
 */
export const processStartTimeMs = async (pid: number): Promise<number | undefined> => {
  if (isWindows) {
    // Get-Process exposes StartTime directly; convert to epoch millis so the
    // value is comparable to Unix `etime`-derived values.
    const out = await run('powershell', [
      '-NoProfile',
      '-Command',
      `[long]((Get-Process -Id ${pid}).StartTime.ToUniversalTime() - (Get-Date '1970-01-01Z')).TotalMilliseconds`,
    ]);
    const millis = Number.parseInt((out ?? '').trim(), 10);
    return Number.isFinite(millis) ? millis : undefined;
  }

  // GNU/Linux: `lstart` is an absolute, locale-formatted wall clock. Parsing it
  // is fragile; `etimes` (seconds since start) composed with "now" is exact.
  const etimes = await run('ps', ['-o', 'etimes=', '-p', String(pid)]);
  const seconds = Number.parseInt((etimes ?? '').trim(), 10);
  if (Number.isFinite(seconds)) {
    return Date.now() - seconds * 1000;
  }

  // BSD/macOS: no etimes; derive from the etime clock format.
  const age = await processAgeSeconds(pid);
  return age === undefined ? undefined : Date.now() - age * 1000;
};

/**
 * Working directory of `pid`, or undefined when it cannot be determined.
 *
 * Used as one part of checkout identity: a process started from a different
 * worktree is not the instance a record claims to own, even if its name and
 * PID happen to match.
 */
export const processCwd = async (pid: number): Promise<string | undefined> => {
  if (isWindows) {
    // No native cwd query without WMI; return undefined so callers fall back
    // to the other identity fields rather than guessing.
    return undefined;
  }
  // GNU/Linux: /proc is authoritative and cheap.
  const proc = await run('readlink', [`/proc/${pid}/cwd`]);
  if (proc !== null && proc.trim() !== '') {
    return proc.trim();
  }
  // macOS: lsof reports the cwd via the `cwd` file descriptor.
  const lsof = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const line = lsof?.split('\n').find((entry) => entry.startsWith('n'));
  return line ? line.slice(1).trim() : undefined;
};
