// .pi/extensions/lib/coderabbit_autofix.ts

import { setTimeout as delay } from 'node:timers/promises';
import {
  type CodeRabbitSnapshot,
  type CommentEvidence,
  codeRabbitFindings,
  codeRabbitLifecycle,
  isCodeRabbit,
  isReviewRecord,
} from './coderabbit_evidence.ts';
import { type ReviewQuery, reviewPrSelector } from './coderabbit_reader.ts';
import { validateReviewWait } from './coderabbit_wait.ts';

const AUTOFIX_WINDOW_MS = 30 * 60_000;
type BoundQuery = (args: string[]) => Promise<Awaited<ReturnType<ReviewQuery>>>;
type AutofixRequest = { since: number; duplicatePrevented: boolean; excludeIds?: Set<string> };
type ReplyStatus = 'rate-limited' | 'failed' | 'skipped' | 'no-change' | 'running' | 'unknown';

const freshReplies = (options: {
  snapshot: CodeRabbitSnapshot;
  request: AutofixRequest;
}): CommentEvidence[] =>
  options.snapshot.comments
    .filter(
      (item) =>
        isCodeRabbit(item.login) &&
        !options.request.excludeIds?.has(item.id) &&
        Date.parse(item.createdAt) >= options.request.since,
    )
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));

const replyStatus = (body: string): ReplyStatus => {
  if (!/autofix/i.test(body)) {
    return 'unknown';
  }
  if (/rate.?limit|quota|usage limit|available in/i.test(body)) {
    return 'rate-limited';
  }
  if (/unexpected error|not found|could not (?:generate|resolve)|failed to generate/i.test(body)) {
    return 'failed';
  }
  if (/autofix skipped/i.test(body)) {
    return 'skipped';
  }
  if (
    /no autofix changes (?:were )?needed|no (?:changes|fixes|actionable)|nothing to (?:fix|change)/i.test(
      body,
    )
  ) {
    return 'no-change';
  }
  if (/autofix (?:in progress|applied)|fixes applied/i.test(body)) {
    return 'running';
  }
  return 'unknown';
};

const latestReplyStatus = (options: {
  snapshot: CodeRabbitSnapshot;
  request: AutofixRequest;
}): ReplyStatus => {
  for (const reply of freshReplies(options)) {
    const state = replyStatus(reply.body);
    if (state !== 'unknown') {
      return state;
    }
  }
  return 'unknown';
};

/** Reuse only a recent unanswered command after the current head's completed review. */
export const activeAutofixRequest = (snapshot: CodeRabbitSnapshot): number | undefined => {
  const reviewedAt = Date.parse(codeRabbitLifecycle(snapshot).completedAt ?? '');
  const now = Date.now();
  const request = snapshot.comments
    .filter(
      (item) =>
        !isCodeRabbit(item.login) &&
        item.body.trim() === '@coderabbitai autofix' &&
        Date.parse(item.createdAt) >= reviewedAt &&
        now - Date.parse(item.createdAt) >= 0 &&
        now - Date.parse(item.createdAt) < AUTOFIX_WINDOW_MS,
    )
    .sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt))
    .at(-1);
  if (!request) {
    return undefined;
  }
  const since = Date.parse(request.createdAt);
  const state = latestReplyStatus({ snapshot, request: { since, duplicatePrevented: true } });
  return state === 'unknown' || state === 'running' ? since : undefined;
};

const isVerifiedSignature = (value: unknown): boolean => {
  if (!isReviewRecord(value) || !isReviewRecord(value.verification)) {
    return false;
  }
  const verification = value.verification;
  return (
    verification.verified === true &&
    verification.reason === 'valid' &&
    typeof verification.signature === 'string' &&
    verification.signature.length > 0 &&
    typeof verification.payload === 'string' &&
    verification.payload.length > 0
  );
};

/** Signed bot-attributed ancestry is necessary, but NOT sufficient without provider attestation. */
export const isAutofixCommit = (options: {
  value: unknown;
  baseline: string;
  head: string;
}): boolean => {
  if (
    !isReviewRecord(options.value) ||
    options.value.sha !== options.head ||
    !isReviewRecord(options.value.author) ||
    !isCodeRabbit(options.value.author.login) ||
    !isVerifiedSignature(options.value.commit) ||
    !Array.isArray(options.value.parents) ||
    options.value.parents.length !== 1
  ) {
    return false;
  }
  const parent: unknown = options.value.parents[0];
  return isReviewRecord(parent) && parent.sha === options.baseline;
};

/** Commit author metadata can be forged; an authenticated fresh provider reply must name this exact SHA. */
export const hasAutofixAttestation = (options: {
  snapshot: CodeRabbitSnapshot;
  request: AutofixRequest;
  head: string;
}): boolean => {
  const reply = freshReplies(options).find((item) => /autofix/i.test(item.body));
  if (
    !reply ||
    replyStatus(reply.body) !== 'running' ||
    !/autofix applied|fixes applied/i.test(reply.body)
  ) {
    return false;
  }
  return (reply.body.match(/\b[a-f0-9]{40}\b/gi) ?? []).some(
    (sha) => sha.toLowerCase() === options.head.toLowerCase(),
  );
};

const startAutofixRequest = async (options: {
  ready: CodeRabbitSnapshot;
  query: BoundQuery;
  report: (line: string) => void;
}): Promise<AutofixRequest> => {
  const since = activeAutofixRequest(options.ready);
  if (since !== undefined) {
    options.report('Autofix already requested; watching the existing request');
    return { since, duplicatePrevented: true };
  }
  // Anchor freshness to GitHub's clock. Exclude pre-existing IDs so replies
  // in the same second remain fresh without adopting older evidence.
  const request: AutofixRequest = {
    since: options.ready.comments.reduce((latest, comment) => {
      const createdAt = Date.parse(comment.createdAt);
      return Number.isFinite(createdAt) ? Math.max(latest, createdAt) : latest;
    }, 0),
    duplicatePrevented: false,
    excludeIds: new Set(options.ready.comments.map((comment) => comment.id)),
  };
  await options.query([
    'pr',
    'comment',
    reviewPrSelector(options.ready),
    '--body',
    '@coderabbitai autofix',
  ]);
  options.report('Requested @coderabbitai autofix');
  return request;
};

const inspectChangedHead = async (options: {
  snapshot: CodeRabbitSnapshot;
  baseline: string;
  candidate?: string;
  request: AutofixRequest;
  query: BoundQuery;
  report: (line: string) => void;
}) => {
  if (options.snapshot.head === options.baseline) {
    if (options.candidate) {
      throw new Error('PR head reverted during autofix; inspect the concurrent push');
    }
    return { candidate: undefined, commit: undefined };
  }
  if (options.candidate && options.candidate !== options.snapshot.head) {
    throw new Error('PR head changed again during autofix; inspect the concurrent push');
  }
  if (!options.candidate) {
    const commit = await options.query([
      'api',
      `repos/${options.snapshot.repository}/commits/${options.snapshot.head}`,
    ]);
    if (
      !isAutofixCommit({
        value: commit.json,
        baseline: options.baseline,
        head: options.snapshot.head,
      })
    ) {
      throw new Error(
        'PR head changed without verified CodeRabbit autofix provenance (signed ancestry missing); inspect the push',
      );
    }
    options.report(
      'Signed bot-attributed head observed; waiting for exact-SHA provider attestation',
    );
  }
  const attested = hasAutofixAttestation({
    snapshot: options.snapshot,
    request: options.request,
    head: options.snapshot.head,
  });
  return { candidate: options.snapshot.head, commit: attested ? options.snapshot.head : undefined };
};

const watchAutofix = async (options: {
  baseline: string;
  request: AutofixRequest;
  readSnapshot: () => Promise<CodeRabbitSnapshot>;
  query: BoundQuery;
  report: (line: string) => void;
  deadline: number;
  intervalMs: number;
  signal?: AbortSignal;
}) => {
  let candidate: string | undefined;
  const duplicatePrevented = options.request.duplicatePrevented;
  while (Date.now() < options.deadline) {
    options.signal?.throwIfAborted();
    let snapshot: CodeRabbitSnapshot;
    try {
      snapshot = await options.readSnapshot();
    } catch (error) {
      options.signal?.throwIfAborted();
      options.report(`GitHub evidence unavailable; retrying: ${String(error).slice(0, 300)}`);
      await delay(
        Math.max(0, Math.min(options.intervalMs, options.deadline - Date.now())),
        undefined,
        { signal: options.signal },
      );
      continue;
    }
    options.signal?.throwIfAborted();
    if (Date.now() >= options.deadline) {
      break;
    }
    if (snapshot.draft) {
      throw new Error('PR became draft during autofix');
    }
    const observed = await inspectChangedHead({ ...options, snapshot, candidate });
    candidate = observed.candidate;
    if (observed.commit) {
      return { status: 'committed' as const, commit: observed.commit, duplicatePrevented };
    }
    const state = latestReplyStatus({ snapshot, request: options.request });
    if (state !== 'unknown' && state !== 'running') {
      return { status: state, duplicatePrevented };
    }
    await delay(
      Math.max(0, Math.min(options.intervalMs, options.deadline - Date.now())),
      undefined,
      { signal: options.signal },
    );
  }
  options.signal?.throwIfAborted();
  return { status: 'timeout' as const, duplicatePrevented };
};

/** Never call a branch push an autofix based only on forgeable Git author metadata. */
export const applyCodeRabbitAutofix = async (options: {
  initial: CodeRabbitSnapshot;
  readSnapshot: () => Promise<CodeRabbitSnapshot>;
  query: ReviewQuery;
  report: (line: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  intervalMs?: number;
}) => {
  options.signal?.throwIfAborted();
  const timeoutMs = options.timeoutMs ?? AUTOFIX_WINDOW_MS;
  const intervalMs = options.intervalMs ?? 15_000;
  validateReviewWait({ timeoutMs, intervalMs });
  const baseline = options.initial.head;
  const deadline = Date.now() + timeoutMs;
  const query: BoundQuery = async (args) => {
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline) {
      throw new Error('CodeRabbit autofix deadline exceeded');
    }
    const result = await options.query(args, {
      signal: options.signal,
      timeoutMs: Math.min(60_000, Math.max(1, deadline - Date.now())),
    });
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline) {
      throw new Error('CodeRabbit autofix deadline exceeded');
    }
    if (!result.success) {
      throw new Error(`CodeRabbit autofix GitHub request failed: ${result.text.slice(0, 300)}`);
    }
    return result;
  };
  const ready = await options.readSnapshot();
  options.signal?.throwIfAborted();
  if (
    ready.head !== baseline ||
    ready.draft ||
    codeRabbitLifecycle(ready).lifecycle !== 'completed'
  ) {
    throw new Error('PR review/head changed before autofix; restart with fresh evidence');
  }
  if (codeRabbitFindings(ready).actionableCount === 0) {
    return { status: 'no-current-findings' as const, commit: undefined, duplicatePrevented: false };
  }
  const request = await startAutofixRequest({ ready, query, report: options.report });
  return watchAutofix({ ...options, baseline, query, request, deadline, intervalMs });
};
