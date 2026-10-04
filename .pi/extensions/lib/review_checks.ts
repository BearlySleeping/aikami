// .pi/extensions/lib/review_checks.ts

import { abortableSleep } from './async.ts';
import { type GhResult, runGh } from './gh.ts';
import { summarizeCheckCompletion } from './review_evidence.ts';

/** Wait for actual CI completion; missing or failed queries are not completed CI. */
export const waitForCheckCompletion = async (options: {
  pr: string;
  report: (line: string) => void;
  signal?: AbortSignal;
  maxWaitMs?: number;
  intervalMs?: number;
  queryChecks?: () => Promise<GhResult>;
}): Promise<boolean> => {
  const deadline = Date.now() + (options.maxWaitMs ?? 90_000);
  const queryChecks =
    options.queryChecks ??
    (() =>
      runGh(['pr', 'checks', options.pr, '--json', 'name,bucket,state'], {
        timeoutMs: 60_000,
        signal: options.signal,
        parseJson: true,
        allowExitCodes: [1, 8],
      }));
  options.report('⏳ Waiting for CI checks to complete (not an approval or passing-CI verdict)...');
  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      return false;
    }
    const result = await queryChecks();
    if (options.signal?.aborted) {
      return false;
    }
    const { pendingCount } = summarizeCheckCompletion(result);
    if (pendingCount === 0) {
      options.report('📋 All CI checks completed (pass or fail); inspect results before merging.');
      return true;
    }
    options.report(`  ⏳ ${pendingCount} check(s) pending...`);
    if (!(await abortableSleep(options.intervalMs ?? 10_000, options.signal))) {
      return false;
    }
  }
  options.report('⚠️ CI checks still running at the wait deadline.');
  return false;
};
