// .pi/extensions/code_rabbit.ts

import type { AgentToolUpdateCallback, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { applyCodeRabbitAutofix } from './lib/coderabbit_autofix.ts';
import {
  type CodeRabbitSnapshot,
  codeRabbitFindings,
  codeRabbitLifecycle,
} from './lib/coderabbit_evidence.ts';
import { reviewPrSelector, validateReviewSelector } from './lib/coderabbit_reader.ts';
import { waitForCodeRabbit } from './lib/coderabbit_wait.ts';
import { runGh } from './lib/gh.ts';
import { waitForCheckCompletion } from './lib/review_checks.ts';
import { reviewFindingsReport } from './lib/review_findings_report.ts';
import { mergeReviewedHead } from './lib/review_merge.ts';
import { queryPinnedChecks } from './lib/review_pinned_checks.ts';
import { pollReviewState } from './lib/review_polling.ts';
import { readReviewSnapshot } from './lib/review_snapshot.ts';
import { defineAction, registerNamespace } from './lib/tool_namespace.ts';

const MAX_WAIT_MS = 30 * 60_000;
const POLL_INTERVAL_MS = 15_000;

/** Progress belongs in tool updates, never the TUI's stdout. */
export type Reporter = (line: string) => void;

const makeReporter = (onUpdate?: AgentToolUpdateCallback<unknown>): Reporter => {
  const lines: string[] = [];
  return (line) => {
    lines.push(line);
    if (lines.length > 12) {
      lines.shift();
    }
    onUpdate?.({ content: [{ type: 'text', text: lines.join('\n') }], details: undefined });
  };
};

const readySnapshot = async (options: {
  pr: string;
  signal?: AbortSignal;
  head?: string;
  deadline?: number;
}) => {
  const snapshot = await readReviewSnapshot(options);
  if (snapshot.draft || (options.head && snapshot.head !== options.head)) {
    throw new Error('PR is draft or its head changed; restart CodeRabbit with fresh evidence');
  }
  return snapshot;
};

const ensureReview = async (options: {
  initial: CodeRabbitSnapshot;
  signal?: AbortSignal;
  report: Reporter;
}) => {
  const lifecycle = codeRabbitLifecycle(options.initial).lifecycle;
  if (lifecycle === 'completed') {
    return options.initial;
  }
  const pr = reviewPrSelector(options.initial);
  const deadline = Date.now() + MAX_WAIT_MS;
  if (lifecycle !== 'running' && lifecycle !== 'rate-limited') {
    await readySnapshot({ pr, head: options.initial.head, signal: options.signal, deadline });
    const posted = await runGh(['pr', 'comment', pr, '--body', '@coderabbitai review'], {
      signal: options.signal,
    });
    options.signal?.throwIfAborted();
    if (!posted.success) {
      throw new Error(`CodeRabbit review request failed: ${posted.text.slice(0, 300)}`);
    }
    options.report('Requested CodeRabbit review once; waiting within a fixed deadline');
  }
  const result = await waitForCodeRabbit({
    head: options.initial.head,
    timeoutMs: Math.max(1, deadline - Date.now()),
    intervalMs: POLL_INTERVAL_MS,
    signal: options.signal,
    report: options.report,
    readSnapshot: () => readReviewSnapshot({ pr, signal: options.signal, deadline }),
  });
  if (result.reason !== 'completed') {
    throw new Error(`Timed out waiting for CodeRabbit review on PR #${pr}`);
  }
  return result.snapshot;
};

const mergeIfApproved = async (options: {
  requested?: boolean;
  snapshot: CodeRabbitSnapshot;
  report: Reporter;
  signal?: AbortSignal;
}) => {
  const pr = reviewPrSelector(options.snapshot);
  return mergeReviewedHead({
    requested: options.requested,
    pr,
    head: options.snapshot.head,
    actionableCount: codeRabbitFindings(options.snapshot).unresolvedCount,
    report: options.report,
    signal: options.signal,
    readReviewState: () => pollReviewState({ pr, signal: options.signal }),
    queryChecks: () =>
      queryPinnedChecks({
        repository: options.snapshot.repository,
        head: options.snapshot.head,
        signal: options.signal,
      }),
    // Refresh findings together with current approval, never only a stale summary count.
    readDisposition: async () => {
      const fresh = await readySnapshot({
        pr,
        head: options.snapshot.head,
        signal: options.signal,
      });
      return fresh;
    },
  });
};

/** Interactive tools and detached automation share one lifecycle/findings model. */
export default (pi: ExtensionAPI): void => {
  registerNamespace(pi, {
    name: 'code_rabbit',
    label: 'CodeRabbit',
    description:
      'Drive head-specific CodeRabbit reviews and autofixes. Completion is not approval.',
    actions: [
      defineAction({
        action: 'autofix',
        summary: 'Ensure a review exists, then run autofix and await a verified bot commit',
        parameters: Type.Object({
          pr: Type.String({ description: 'PR number or selector' }),
          merge: Type.Optional(
            Type.Boolean({
              default: false,
              description:
                'Merge only with formal approval, no unresolved findings, passing CI and a pinned head',
            }),
          ),
        }),
        async execute(_toolCallId, params, signal, onUpdate) {
          const report = makeReporter(onUpdate);
          const num = validateReviewSelector(params.pr);
          const initial = await readySnapshot({ pr: num, signal });
          const pr = String(initial.number);
          const selector = reviewPrSelector(initial);
          report(`Pinned head ${initial.head.slice(0, 8)} (${initial.branch})`);
          if (!(await waitForCheckCompletion({ pr: selector, signal, report }))) {
            signal?.throwIfAborted();
            return {
              content: [
                {
                  type: 'text',
                  text: `CI is still running on PR #${pr}; autofix was not requested.`,
                },
              ],
              details: {
                pr,
                baselineCommit: initial.head,
                autofixSkipped: true,
                reason: 'ci_checks_running',
              },
            };
          }
          const ready = await readySnapshot({ pr: selector, head: initial.head, signal });
          const reviewed = await ensureReview({ initial: ready, signal, report });
          const evidence = codeRabbitLifecycle(reviewed);
          const disposition = codeRabbitFindings(reviewed);
          if (disposition.actionableCount === 0) {
            const merged = await mergeIfApproved({
              requested: params.merge,
              snapshot: reviewed,
              report,
              signal,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: `CodeRabbit review completed on PR #${pr}; no current actionable threads. Total unresolved: ${disposition.unresolvedCount} (historical/outdated threads still need disposition). GitHub verdict: ${evidence.verdict ?? 'none'}. ${merged ? 'Merged pinned head.' : 'No autofix or merge performed.'}`,
                },
              ],
              details: {
                pr,
                branch: initial.branch,
                baselineCommit: initial.head,
                reviewState: evidence.verdict ?? 'COMPLETED',
                evidence,
                actionableCount: 0,
                unresolvedCount: disposition.unresolvedCount,
                autofixApplied: false,
                merged,
              },
            };
          }
          const deadline = Date.now() + MAX_WAIT_MS;
          const result = await applyCodeRabbitAutofix({
            initial: reviewed,
            report,
            signal,
            readSnapshot: () => readReviewSnapshot({ pr: selector, signal, deadline }),
            query: (args, request) => runGh(args, { ...request, parseJson: true }),
          });
          const fresh = await readReviewSnapshot({ pr: selector, signal });
          const freshEvidence = codeRabbitLifecycle(fresh);
          const freshFindings = codeRabbitFindings(fresh);
          return {
            content: [
              {
                type: 'text',
                text: [
                  `CodeRabbit autofix on PR #${pr}: ${result.status}.`,
                  result.commit
                    ? `Signed, provider-attested autofix commit: ${result.commit}. Fetch and fast-forward your worktree, preserving local changes. A new review and CI are required before merge.`
                    : 'No verified autofix commit; this is not clean-review evidence.',
                  `Current actionable: ${freshFindings.actionableCount}; total unresolved: ${freshFindings.unresolvedCount}.`,
                  `Lifecycle on ${fresh.head.slice(0, 8)}: ${freshEvidence.lifecycle}; GitHub verdict: ${freshEvidence.verdict ?? 'none'}.`,
                ].join('\n'),
              },
            ],
            details: {
              pr,
              branch: initial.branch,
              baselineCommit: initial.head,
              head: fresh.head,
              autofixCommit: result.commit,
              autofixApplied: result.status === 'committed',
              autofixSkipped: ['skipped', 'rate-limited', 'no-current-findings'].includes(
                result.status,
              ),
              reason: result.status,
              duplicatePrevented: result.duplicatePrevented,
              actionableCount:
                freshEvidence.lifecycle === 'completed' ? freshFindings.actionableCount : undefined,
              unresolvedCount: freshFindings.unresolvedCount,
              reviewState: freshEvidence.verdict,
              evidence: freshEvidence,
            },
          };
        },
      }),
      defineAction({
        action: 'findings',
        summary: 'Fetch paginated current, historical, resolved and outdated review threads',
        parameters: Type.Object({ pr: Type.String({ description: 'PR number or selector' }) }),
        async execute(_toolCallId, params, signal) {
          return reviewFindingsReport(
            await readReviewSnapshot({ pr: validateReviewSelector(params.pr), signal }),
          );
        },
      }),
      defineAction({
        action: 'wait',
        summary: 'Wait for verified head-specific completion or new current actionable threads',
        parameters: Type.Object({
          pr: Type.String({ description: 'PR number or selector' }),
          maxWaitMs: Type.Optional(
            Type.Integer({ default: MAX_WAIT_MS, minimum: 1, maximum: 3_600_000 }),
          ),
          intervalMs: Type.Optional(
            Type.Integer({ default: POLL_INTERVAL_MS, minimum: 1, maximum: 60_000 }),
          ),
        }),
        async execute(_toolCallId, params, signal, onUpdate) {
          const pr = validateReviewSelector(params.pr);
          const timeoutMs = params.maxWaitMs ?? MAX_WAIT_MS;
          const deadline = Date.now() + timeoutMs;
          const result = await waitForCodeRabbit({
            timeoutMs,
            intervalMs: params.intervalMs ?? POLL_INTERVAL_MS,
            signal,
            returnOnFindings: true,
            report: makeReporter(onUpdate),
            readSnapshot: () => readReviewSnapshot({ pr, signal, deadline }),
          });
          if (result.reason === 'timeout') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Timed out waiting for CodeRabbit on PR #${pr}; no verified completion. Last lifecycle: ${result.snapshot ? codeRabbitLifecycle(result.snapshot).lifecycle : 'unknown'}.`,
                },
              ],
              details: { pr, head: result.snapshot?.head, timedOut: true },
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: `CodeRabbit ${result.reason} on PR #${result.snapshot.number}, head ${result.snapshot.head.slice(0, 8)}. Lifecycle: ${result.evidence.lifecycle}; GitHub verdict: ${result.evidence.verdict ?? 'none'}. Current actionable: ${result.findings.actionableCount}; historical unresolved: ${result.findings.historicalCount}. Completion is not approval.`,
              },
            ],
            details: {
              pr: String(result.snapshot.number),
              head: result.snapshot.head,
              evidence: result.evidence,
              reviewState:
                result.evidence.verdict ??
                (result.evidence.lifecycle === 'completed' ? 'COMPLETED' : undefined),
              actionableCount: result.findings.actionableCount,
              historicalCount: result.findings.historicalCount,
              newComments: result.reason === 'findings',
              reason: result.reason,
            },
          };
        },
      }),
    ],
  });
};
