/**
 * apps/backend/local-stack/stack/probe_executor.ts
 *
 * Bun/CLI ProbeExecutor adapter (C-391). Implements the contract seam from
 * @aikami/local-ai with node:child_process / node:fs — the ONLY adapter in
 * this repo allowed to spawn processes. See the contract table in the C-391
 * design reference:
 *
 *   - No shell: fixed argv, never a shell string built from probe output.
 *   - Never throws: missing binary, non-zero exit, timeout, permission
 *     denial all resolve to a ProbeResult with ok:false and a discriminated
 *     reason. Rejection is reserved for adapter bugs.
 *   - Honours the timeout: the child is killed, not abandoned.
 *   - Byte-faithful: stdout/stderr returned undecorated.
 *   - Side-effect free: probes are read-only.
 */

import { spawn } from 'node:child_process';
import { readFile, statfs } from 'node:fs/promises';
import type { ProbeExecutor, ProbeResult, StatfsResult } from '@aikami/local-ai';

const classifySpawnError = (error: unknown): ProbeResult => {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT/.test(message) || /not found in \$PATH|executable not found/i.test(message)) {
    return { ok: false, reason: 'not-found', detail: message };
  }
  if (/EACCES|EPERM/.test(message)) {
    return { ok: false, reason: 'denied', detail: message };
  }
  return { ok: false, reason: 'failed', detail: message };
};

/**
 * Spawns a fixed-argv child, collects stdout/stderr byte-faithfully, and
 * resolves within timeoutMs — killing the child on timeout.
 */
const runProbe = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<ProbeResult> =>
  new Promise<ProbeResult>((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const settle = (result: ProbeResult): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      // Settle immediately — do not wait for the close event, which may lag
      // behind the kill (or never fire if the child is a zombie). The settled
      // guard in the close handler below makes this the single resolution.
      settle({ ok: false, reason: 'timeout', detail: `killed by SIGKILL after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      settle(classifySpawnError(error));
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      const timedOut = signal === 'SIGKILL' || signal === 'SIGTERM';
      if (timedOut) {
        settle({ ok: false, reason: 'timeout', detail: `killed by ${String(signal)}` });
        return;
      }
      if (code !== 0) {
        settle({ ok: false, reason: 'failed', detail: `exit code ${String(code)}` });
        return;
      }
      settle({ ok: true, stdout, stderr, exitCode: code ?? 0 });
    });
  });

const readTextFileProbe = async (path: string): Promise<ProbeResult> => {
  try {
    const contents = await readFile(path, 'utf8');
    return { ok: true, stdout: contents, stderr: '', exitCode: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/.test(message)) {
      return { ok: false, reason: 'not-found', detail: message };
    }
    if (/EACCES|EPERM/.test(message)) {
      return { ok: false, reason: 'denied', detail: message };
    }
    return { ok: false, reason: 'failed', detail: message };
  }
};

const statfsProbe = async (path: string): Promise<StatfsResult> => {
  try {
    const stats = await statfs(path);
    return { freeBytes: stats.bavail * stats.bsize };
  } catch {
    return { ok: false };
  }
};

/** The single Bun/CLI executor instance. */
export const probeExecutor: ProbeExecutor = {
  run: (command, args, options) => runProbe(command, args, options.timeoutMs),
  readTextFile: readTextFileProbe,
  statfs: statfsProbe,
};
