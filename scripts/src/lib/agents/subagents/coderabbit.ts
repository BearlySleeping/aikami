// scripts/src/lib/agents/subagents/coderabbit.ts

import { execFile } from 'node:child_process';
import { applyCodeRabbitAutofix } from '../../../../../.pi/extensions/lib/coderabbit_autofix.ts';
import {
  codeRabbitFindings,
  codeRabbitLifecycle,
} from '../../../../../.pi/extensions/lib/coderabbit_evidence.ts';
import {
  type ReviewQuery,
  readCodeRabbitSnapshot,
} from '../../../../../.pi/extensions/lib/coderabbit_reader.ts';
import { waitForCodeRabbit } from '../../../../../.pi/extensions/lib/coderabbit_wait.ts';
import type { ReviewOutcome } from './types.ts';

type Report = (line: string) => void;

// The detached supervisor has no Pi runtime; keep only this transport adapter
// different. Lifecycle, pagination, head pinning and finding disposition are shared.
const query: ReviewQuery = (args, options) =>
  new Promise((resolve) => {
    execFile(
      'gh',
      args,
      {
        encoding: 'utf8',
        timeout: options.timeoutMs,
        signal: options.signal,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, text: stderr.trim() || error.message });
          return;
        }
        let json: unknown;
        try {
          json = JSON.parse(stdout);
        } catch {
          // Posting a command has non-JSON output; readers separately require JSON.
        }
        resolve({ success: true, text: stdout.trim(), json });
      },
    );
  });

/** Wait for authenticated completion on one head, including incremental sticky-summary reviews. */
export const waitForReview = async (options: {
  pr: string;
  since: number;
  timeoutMs: number;
  report: Report;
  signal?: AbortSignal;
}): Promise<{ head?: string; state?: string; findings?: number; unresolvedFindings?: number }> => {
  const deadline = Date.now() + options.timeoutMs;
  const result = await waitForCodeRabbit({
    timeoutMs: options.timeoutMs,
    intervalMs: 30_000,
    since: options.since,
    signal: options.signal,
    report: options.report,
    readSnapshot: () =>
      readCodeRabbitSnapshot({ pr: options.pr, query, signal: options.signal, deadline }),
  });
  if (result.reason !== 'completed') {
    options.report('Timed out waiting for CodeRabbit; findings remain unknown');
    return {};
  }
  options.report(
    `CodeRabbit completed (${result.findings.unresolvedCount} unresolved threads); verdict ${result.evidence.verdict ?? 'none'}`,
  );
  return {
    head: result.snapshot.head,
    state: result.evidence.verdict ?? 'COMPLETED',
    findings: result.findings.actionableCount,
    unresolvedFindings: result.findings.unresolvedCount,
  };
};

/** Request autofix only after current-head completion; reject unrelated pushes as bot commits. */
export const runAutofix = async (options: {
  pr: string;
  report: Report;
  signal?: AbortSignal;
}): Promise<Pick<ReviewOutcome, 'autofix' | 'autofixCommit'>> => {
  const deadline = Date.now() + 30 * 60_000;
  const readSnapshot = () =>
    readCodeRabbitSnapshot({ pr: options.pr, query, signal: options.signal, deadline });
  const initial = await readSnapshot();
  if (codeRabbitLifecycle(initial).lifecycle !== 'completed') {
    throw new Error(
      'CodeRabbit review is not completed on the current head; autofix not requested',
    );
  }
  if (codeRabbitFindings(initial).actionableCount === 0) {
    return { autofix: 'skipped' };
  }
  const result = await applyCodeRabbitAutofix({
    initial,
    readSnapshot,
    query,
    report: options.report,
    signal: options.signal,
  });
  if (result.status === 'committed') {
    return { autofix: 'committed', autofixCommit: result.commit };
  }
  if (result.status === 'no-change') {
    return { autofix: 'no-change' };
  }
  return { autofix: result.status === 'timeout' ? 'timeout' : 'skipped' };
};
