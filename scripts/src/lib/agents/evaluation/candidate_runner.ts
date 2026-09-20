// scripts/src/lib/agents/evaluation/candidate_runner.ts
//
// Candidate modules are untrusted. Execute them in a separate Node process
// with the permission model denying network, writes, subprocesses and workers.
// Only the candidate target file is readable, ambient credentials are omitted,
// and the host forcibly terminates checks that exceed the fixed deadline.
//
// ── Two deadlines, not one (cross-platform correctness) ──────────────────
//
// The budget that exists to stop a runaway candidate is a budget on the
// CANDIDATE's execution. It is not a budget on process creation, and the two
// must not share a number.
//
// Process creation is a platform cost that varies by two orders of magnitude.
// A child on macOS or Linux reaches its first statement in ~40ms. The same
// child on a cold Windows CI runner — `node.exe` load plus real-time AV
// scanning of a module the test wrote milliseconds earlier — routinely takes
// seconds. Charging that startup cost to a 2s candidate budget made the check
// report "candidate exceeded 2000ms" *before the candidate had executed a
// single statement*: a cross-platform false negative that failed the frozen
// acceptance oracle on Windows while the identical semantic task passed on
// macOS and Linux.
//
// So the child announces `candidate-started` once Node has booted and before
// any candidate code is imported, and the parent arms the candidate deadline
// only then. The frozen-acceptance guarantee is unchanged: the candidate still
// gets exactly CANDIDATE_TIMEOUT_MS of execution, measured from its own first
// line. A child that never reaches its first line is bounded by a separate,
// much larger startup deadline and still fails closed.

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { AcceptanceOutcome } from './types.ts';

/** The candidate's own execution budget — the bound on a runaway candidate. */
export const CANDIDATE_TIMEOUT_MS = 2_000;

/**
 * The budget for the OS to create the child and for Node to boot it to the
 * point where the candidate's first statement can run. Deliberately generous:
 * it bounds a hung process, it does not bound the candidate.
 */
export const CANDIDATE_STARTUP_TIMEOUT_MS = 30_000;

const MAX_STDERR_LENGTH = 16_384;

/** Child→parent: Node has booted; no candidate code has run yet. */
const CANDIDATE_STARTED_MESSAGE = 'candidate-started';
/** Child→parent: the frozen acceptance oracle produced an outcome. */
const ACCEPTANCE_RESULT_MESSAGE = 'acceptance-result';

const CHILD_SOURCE = String.raw`
import { pathToFileURL } from 'node:url';

const [targetPath, testSource] = process.argv.slice(1);
const send = process.send?.bind(process);
Object.defineProperty(process, 'send', { value: undefined });

const finish = (outcome) => {
  if (!send) {
    process.exit(0);
    return;
  }
  // Exit explicitly once the outcome is flushed. A child that lingers on a
  // still-open IPC handle would otherwise be killed by the parent's deadline
  // and reported as a timeout even though the oracle had already answered.
  send({ type: 'acceptance-result', outcome }, () => process.exit(0));
};

// Announce readiness BEFORE importing the candidate. The parent charges Node's
// own bootstrap to the startup budget, never to the candidate's execution.
send?.({ type: 'candidate-started' });

try {
  const candidate = await import(pathToFileURL(targetPath).href + '?isolated=' + Date.now());
  const test = new Function('candidate', '"use strict"; return (async () => {\n' + testSource + '\n})();');
  finish(await test(candidate));
} catch (error) {
  finish({
    accepted: false,
    diagnostics: 'Isolated candidate check failed: ' + (error instanceof Error ? error.message : String(error)),
  });
}
`;

const safeEnvironment = (): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = { AIKAMI_EVAL_SANDBOX: '1' };
  for (const key of ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR']) {
    const value = process.env[key];
    if (value) {
      environment[key] = value;
    }
  }
  return environment;
};

const isAcceptanceOutcome = (value: unknown): value is AcceptanceOutcome => {
  if (!(value && typeof value === 'object')) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.accepted === 'boolean' && typeof candidate.diagnostics === 'string';
};

const outcomeFromMessage = (message: unknown): AcceptanceOutcome | undefined => {
  if (!(message && typeof message === 'object')) {
    return undefined;
  }
  const candidate = message as Record<string, unknown>;
  if (candidate.type !== ACCEPTANCE_RESULT_MESSAGE || !isAcceptanceOutcome(candidate.outcome)) {
    return undefined;
  }
  return candidate.outcome;
};

const isCandidateStartedMessage = (message: unknown): boolean => {
  if (!(message && typeof message === 'object')) {
    return false;
  }
  return (message as Record<string, unknown>).type === CANDIDATE_STARTED_MESSAGE;
};

/**
 * The child-process surface the arbitration needs, so the deadline policy can
 * be driven directly by a fake child in tests instead of by a real `node`
 * process whose startup cost is exactly the platform-dependent quantity under
 * test.
 */
export type CandidateChild = {
  onMessage: (handler: (message: unknown) => void) => void;
  onClose: (handler: (code: number | null, signal: string | null) => void) => void;
  onError: (handler: (error: Error) => void) => void;
  kill: () => void;
  isRunning: () => boolean;
};

/** The startup budget and the candidate budget, kept separate on purpose. */
export type CandidateDeadlines = {
  readonly startupTimeoutMs: number;
  readonly candidateTimeoutMs: number;
};

export const DEFAULT_CANDIDATE_DEADLINES: CandidateDeadlines = {
  startupTimeoutMs: CANDIDATE_STARTUP_TIMEOUT_MS,
  candidateTimeoutMs: CANDIDATE_TIMEOUT_MS,
};

/**
 * Arbitrates one candidate child's outcome against the startup and candidate
 * deadlines. Exported so the policy is testable without spawning a process.
 */
export const awaitCandidateOutcome = (
  child: CandidateChild,
  options: { deadlines: CandidateDeadlines; readStderr: () => string },
): Promise<AcceptanceOutcome> => {
  const { deadlines, readStderr } = options;
  return new Promise<AcceptanceOutcome>((resolve) => {
    let outcome: AcceptanceOutcome | undefined;
    let resolved = false;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let candidateTimer: ReturnType<typeof setTimeout> | undefined;

    const stderrSuffix = (): string => {
      const detail = readStderr().trim();
      return detail ? ` stderr: ${detail}` : '';
    };
    const clearTimers = (): void => {
      if (startupTimer !== undefined) {
        clearTimeout(startupTimer);
        startupTimer = undefined;
      }
      if (candidateTimer !== undefined) {
        clearTimeout(candidateTimer);
        candidateTimer = undefined;
      }
    };
    const resolveOnce = (value: AcceptanceOutcome): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(value);
    };
    /**
     * Choose an outcome. If the child is still alive, kill it and defer
     * settlement to `close`: on Windows the sandbox directory is the child's
     * cwd, so the caller's cleanup fails with EBUSY until it is fully reaped.
     */
    const finish = (value: AcceptanceOutcome): void => {
      if (outcome) {
        return;
      }
      outcome = value;
      clearTimers();
      if (child.isRunning()) {
        child.kill();
        return;
      }
      resolveOnce(value);
    };
    const armCandidateDeadline = (): void => {
      if (startupTimer !== undefined) {
        clearTimeout(startupTimer);
        startupTimer = undefined;
      }
      // A hostile child cannot extend its own budget by replaying the
      // readiness message: the candidate deadline is armed exactly once.
      if (candidateTimer !== undefined) {
        return;
      }
      candidateTimer = setTimeout(() => {
        finish({
          accepted: false,
          diagnostics: `Candidate acceptance check exceeded ${deadlines.candidateTimeoutMs}ms and was terminated.${stderrSuffix()}`,
        });
      }, deadlines.candidateTimeoutMs);
    };

    startupTimer = setTimeout(() => {
      finish({
        accepted: false,
        diagnostics: `Candidate subprocess did not reach its first statement within ${deadlines.startupTimeoutMs}ms and was terminated.${stderrSuffix()}`,
      });
    }, deadlines.startupTimeoutMs);

    child.onMessage((message) => {
      if (isCandidateStartedMessage(message)) {
        armCandidateDeadline();
        return;
      }
      const result = outcomeFromMessage(message);
      if (result) {
        finish(result);
      }
    });
    child.onError((error) => {
      // Spawn failure: no process ever held the sandbox directory, settle directly.
      clearTimers();
      resolveOnce({
        accepted: false,
        diagnostics: `Candidate subprocess failed: ${error.message}`,
      });
    });
    child.onClose((code, signal) => {
      if (outcome) {
        resolveOnce(outcome);
        return;
      }
      const detail = readStderr().trim();
      finish({
        accepted: false,
        diagnostics: `Candidate subprocess exited before returning a result (code ${String(code)}, signal ${String(signal)}).${detail ? ` stderr: ${detail}` : ''}`,
      });
    });
  });
};

/**
 * Executes a trusted test body against one untrusted candidate module in a
 * capability-restricted subprocess with a killable fixed deadline.
 */
export const runCandidateTest = (options: {
  sandboxPath: string;
  target: string;
  testSource: string;
}): Promise<AcceptanceOutcome> => {
  const targetPath = join(options.sandboxPath, options.target);
  // Node's permission model matches against the REAL (symlink-resolved)
  // path, not necessarily the string we pass around: macOS's os.tmpdir()
  // is a symlink (/tmp -> /private/tmp) and Windows can hand back an 8.3
  // short-name form (`RUNNER~1`) that differs from the long path used to
  // build this string. Grant the resolved path so `--allow-fs-read`
  // actually matches what the permission check compares against.
  const resolvedTargetPath = realpathSync.native(targetPath);
  const child = spawn(
    'node',
    [
      '--no-warnings',
      '--permission',
      `--allow-fs-read=${resolvedTargetPath}`,
      '--eval',
      CHILD_SOURCE,
      resolvedTargetPath,
      options.testSource,
    ],
    {
      cwd: options.sandboxPath,
      env: safeEnvironment(),
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-MAX_STDERR_LENGTH);
  });

  return awaitCandidateOutcome(
    {
      onMessage: (handler) => child.on('message', handler),
      onClose: (handler) => child.once('close', handler),
      onError: (handler) => child.once('error', handler),
      kill: () => child.kill('SIGKILL'),
      isRunning: () => child.exitCode === null && child.signalCode === null,
    },
    { deadlines: DEFAULT_CANDIDATE_DEADLINES, readStderr: () => stderr },
  );
};

/** Immutable source fingerprint included in task acceptance hashes. */
export const candidateRunnerFingerprint = (): string =>
  [
    CHILD_SOURCE,
    CANDIDATE_TIMEOUT_MS,
    CANDIDATE_STARTUP_TIMEOUT_MS,
    MAX_STDERR_LENGTH,
    CANDIDATE_STARTED_MESSAGE,
    ACCEPTANCE_RESULT_MESSAGE,
    safeEnvironment.toString(),
    isAcceptanceOutcome.toString(),
    isCandidateStartedMessage.toString(),
    outcomeFromMessage.toString(),
    awaitCandidateOutcome.toString(),
    runCandidateTest.toString(),
  ].join('\n');
