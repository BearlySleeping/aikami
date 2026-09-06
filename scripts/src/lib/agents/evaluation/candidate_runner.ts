// scripts/src/lib/agents/evaluation/candidate_runner.ts
//
// Candidate modules are untrusted. Execute them in a separate Node process
// with the permission model denying network, writes, subprocesses and workers.
// Only the candidate target file is readable, ambient credentials are omitted,
// and the host forcibly terminates checks that exceed the fixed deadline.

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { AcceptanceOutcome } from './types.ts';

const CANDIDATE_TIMEOUT_MS = 2_000;
const MAX_STDERR_LENGTH = 16_384;

const CHILD_SOURCE = String.raw`
import { pathToFileURL } from 'node:url';

const [targetPath, testSource] = process.argv.slice(1);
const send = process.send?.bind(process);
Object.defineProperty(process, 'send', { value: undefined });

try {
  const candidate = await import(pathToFileURL(targetPath).href + '?isolated=' + Date.now());
  const test = new Function('candidate', '"use strict"; return (async () => {\n' + testSource + '\n})();');
  const outcome = await test(candidate);
  send?.({ type: 'acceptance-result', outcome });
} catch (error) {
  send?.({
    type: 'acceptance-result',
    outcome: {
      accepted: false,
      diagnostics: 'Isolated candidate check failed: ' + (error instanceof Error ? error.message : String(error)),
    },
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
  if (candidate.type !== 'acceptance-result' || !isAcceptanceOutcome(candidate.outcome)) {
    return undefined;
  }
  return candidate.outcome;
};

/**
 * Executes a trusted test body against one untrusted candidate module in a
 * capability-restricted subprocess with a killable fixed deadline.
 */
export const runCandidateTest = (options: {
  sandboxPath: string;
  target: string;
  testSource: string;
}): Promise<AcceptanceOutcome> =>
  new Promise((resolve) => {
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

    let settled = false;
    let stderr = '';
    const finish = (outcome: AcceptanceOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      resolve(outcome);
    };

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-MAX_STDERR_LENGTH);
    });
    child.on('message', (message) => {
      const outcome = outcomeFromMessage(message);
      if (outcome) {
        finish(outcome);
      }
    });
    child.once('error', (error) => {
      finish({ accepted: false, diagnostics: `Candidate subprocess failed: ${error.message}` });
    });
    child.once('close', (code, signal) => {
      if (!settled) {
        const detail = stderr.trim();
        finish({
          accepted: false,
          diagnostics: `Candidate subprocess exited before returning a result (code ${String(code)}, signal ${String(signal)}).${detail ? ` stderr: ${detail}` : ''}`,
        });
      }
    });

    const timeout = setTimeout(() => {
      finish({
        accepted: false,
        diagnostics: `Candidate acceptance check exceeded ${CANDIDATE_TIMEOUT_MS}ms and was terminated.`,
      });
    }, CANDIDATE_TIMEOUT_MS);
  });

/** Immutable source fingerprint included in task acceptance hashes. */
export const candidateRunnerFingerprint = (): string =>
  [
    CHILD_SOURCE,
    CANDIDATE_TIMEOUT_MS,
    MAX_STDERR_LENGTH,
    safeEnvironment.toString(),
    isAcceptanceOutcome.toString(),
    outcomeFromMessage.toString(),
    runCandidateTest.toString(),
  ].join('\n');
