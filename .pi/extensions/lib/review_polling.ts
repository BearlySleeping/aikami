// .pi/extensions/lib/review_polling.ts

import { abortableSleep } from './async.ts';
import { type GhResult, runGh } from './gh.ts';
import { currentCodeRabbitReviewState } from './review_evidence.ts';

/** Retry unavailable CLI evidence without weakening the strict merge-state reader. */
export const pollReviewState = async (options: {
  pr: string;
  signal?: AbortSignal;
  report?: (line: string) => void;
  deadline?: number;
  intervalMs?: number;
  query?: () => Promise<GhResult>;
}): Promise<string> => {
  const deadline = options.deadline ?? Date.now() + 30 * 60_000;
  const query =
    options.query ??
    (() =>
      runGh(['pr', 'view', options.pr, '--json', 'headRefOid,isDraft,reviews'], {
        parseJson: true,
        signal: options.signal,
        timeoutMs: Math.min(60_000, Math.max(1, deadline - Date.now())),
      }));
  while (Date.now() < deadline && !options.signal?.aborted) {
    const result = await query();
    options.signal?.throwIfAborted();
    if (result.success) {
      return currentCodeRabbitReviewState(result.json);
    }
    options.report?.(`GitHub review query failed; retrying: ${result.text.slice(0, 300)}`);
    await abortableSleep(
      Math.min(options.intervalMs ?? 15_000, deadline - Date.now()),
      options.signal,
    );
  }
  options.signal?.throwIfAborted();
  throw new Error(`Timed out reading CodeRabbit review state for PR #${options.pr}`);
};
