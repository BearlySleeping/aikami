// .pi/extensions/lib/review_gh.ts

import { runGh, tokenizeArgs } from './gh.ts';
import { currentCodeRabbitReviewState } from './review_evidence.ts';

const TIMEOUT = 60_000;

// ── gh adapter ──────────────────────────────────────────────────────
//
// Thin wrapper over the shared runGh that also remembers the last stderr, so
// tool output can explain WHY a gh call came back empty.

/** stderr of the most recent failed gh call ('' when the last call succeeded). */
let _lastGhError = '';

/** Run an abortable CLI request and retain failure diagnostics. */
export const gh = async (args: string, signal?: AbortSignal): Promise<string> => {
  signal?.throwIfAborted();
  const result = await runGh(tokenizeArgs(args), { timeoutMs: TIMEOUT, signal });
  signal?.throwIfAborted();
  _lastGhError = result.success ? '' : result.text;
  return result.success ? result.text : '';
};

/** Read structured CLI output without treating failures as evidence. */
export const ghJson = async <T>(args: string, signal?: AbortSignal): Promise<T | undefined> => {
  signal?.throwIfAborted();
  const result = await runGh(tokenizeArgs(args), {
    timeoutMs: TIMEOUT,
    parseJson: true,
    signal,
  });
  signal?.throwIfAborted();
  _lastGhError = result.success ? '' : result.text;
  return result.success ? (result.json as T | undefined) : undefined;
};

/** Diagnostics for the most recent gh failure ('' when the last call succeeded). */
export const ghError = (): string => _lastGhError;

/** Get the current CodeRabbit review state, or empty string if no review yet. */
export const getReviewState = async (num: string, signal?: AbortSignal): Promise<string> =>
  currentCodeRabbitReviewState(
    await ghJson<unknown>(`pr view ${num} --json headRefOid,isDraft,reviews`, signal),
  );
