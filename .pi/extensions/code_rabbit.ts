// .pi/extensions/code_rabbit.ts
//
// CodeRabbit native autofix integration — two-phase lifecycle:
//   Phase 1: Ensure a CodeRabbit review exists (trigger + poll + rate-limit handling)
//   Phase 2: Post @coderabbitai autofix (now that the review anchors it) + poll for commit
//
// Returns the autofix commit SHA so the caller can sync their local worktree.
//
// Call from the review session with: code_rabbit_autofix

import type { AgentToolUpdateCallback, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { abortableSleep } from './lib/async.ts';
import { resolvePrSelector } from './lib/gh.ts';
import { waitForCheckCompletion } from './lib/review_checks.ts';
import {
  describeAutofixOutcome,
  parseActionableCount,
  readReadyPrSnapshot,
} from './lib/review_evidence.ts';
import { getReviewState, gh, ghError, ghJson } from './lib/review_gh.ts';
import { mergeReviewedHead } from './lib/review_merge.ts';
import { pollReviewState } from './lib/review_polling.ts';
import { defineAction, registerNamespace } from './lib/tool_namespace.ts';

const POLL_INTERVAL = 15_000;
const MAX_WAIT_MS = 30 * 60 * 1000;
const TERMINAL_REVIEW_STATES = ['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED'] as const;
const CODERABBIT_LOGINS = ['coderabbitai', 'coderabbitai[bot]'];

// ── Progress reporting ──────────────────────────────────────────────
//
// 🔴 These loops used to console.log. Extensions run inside pi's TUI process,
// which owns the terminal — writing to stdout corrupts the render. Progress
// belongs in onUpdate, which pi renders in the tool's own result block.

/** Emits a progress line while a long CodeRabbit poll is running. */
export type Reporter = (line: string) => void;

const NO_REPORT: Reporter = () => {};

/** Progress lines kept in the live update; older ones scroll off. */
const PROGRESS_WINDOW = 12;

const makeReporter = (onUpdate: AgentToolUpdateCallback<unknown> | undefined): Reporter => {
  if (!onUpdate) {
    return NO_REPORT;
  }
  const lines: string[] = [];
  return (line: string) => {
    lines.push(line);
    onUpdate({
      content: [{ type: 'text', text: lines.slice(-PROGRESS_WINDOW).join('\n') }],
      details: { progressLines: lines.length },
    });
  };
};

/** Autofix cycle state — prevents duplicate `@coderabbitai autofix` commands. */
type AutofixCommentState =
  | 'none'
  | 'autofix_requested' // Last comment is `@coderabbitai autofix` — waiting for CodeRabbit reply
  | 'autofix_in_progress' // CodeRabbit replied — autofix is running
  | 'autofix_applied' // CodeRabbit autofix completed with changes
  | 'autofix_skipped' // CodeRabbit autofix skipped — no fixable findings
  | 'autofix_failed' // CodeRabbit autofix could not resolve findings
  | 'autofix_rate_limited'; // CodeRabbit is rate-limited or quota-exhausted

/** Graceful cancellation result — returned when the user aborts a poll loop. */
const cancelledResult = (
  num: string,
): {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
  isError: true;
} => ({
  content: [
    {
      type: 'text' as const,
      text: `⏹️ Cancelled — CodeRabbit operation on PR #${num} was aborted. Inspect the PR for any work already triggered.`,
    },
  ],
  isError: true,
  details: { pr: num, cancelled: true },
});

type Params = { pr: string; merge?: boolean };

const readActionableCount = async (
  num: string,
  signal?: AbortSignal,
): Promise<number | undefined> =>
  parseActionableCount(
    await gh(
      `pr view ${num} --json headRefOid,reviews --jq '.headRefOid as $head | [.reviews[] | select((.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") and .commit.oid==$head)] | sort_by(.submittedAt) | last | .body // ""'`,
      signal,
    ),
  );

/**
 * Parse rate-limit wait minutes from the NEWEST CodeRabbit comment only.
 * Scanning the full history would let one stale "available in N minutes"
 * comment pin the PR as rate-limited forever.
 */
const parseRateLimitMinutes = async (
  num: string,
  signal?: AbortSignal,
): Promise<number | undefined> => {
  const latest = await gh(
    `pr view ${num} --json comments --jq '([.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]")] | last | .body) // ""'`,
    signal,
  );
  // CodeRabbit formats: "Next review available in: **4 minutes**"
  // or "available in: 15 minutes". Match flexibly around markdown.
  const m = latest.match(/available in[\s\S]*(\d+)\s*min/);
  return m?.[1] ? Number.parseInt(m[1], 10) + 1 : undefined;
};

/**
 * Phase 1: Ensure a CodeRabbit review exists.
 * Returns the terminal review state (APPROVED / COMMENTED / CHANGES_REQUESTED)
 * or undefined if timed out.
 */
const ensureReview = async (
  num: string,
  report: Reporter,
  signal?: AbortSignal,
): Promise<string | undefined> => {
  // Check if review already exists.
  let deadline = Date.now() + MAX_WAIT_MS;
  const existing = await pollReviewState({ pr: num, report, signal, deadline });
  if (existing && TERMINAL_REVIEW_STATES.some((s) => existing.includes(s))) {
    report(`📋 Existing CodeRabbit review: ${existing}`);
    return existing;
  }

  // No review yet — trigger one.
  report('📋 No CodeRabbit review found. Requesting review...');
  await gh(`pr comment ${num} --body "@coderabbitai review"`, signal);

  while (Date.now() < deadline) {
    const state = await pollReviewState({ pr: num, report, signal, deadline });

    if (state && TERMINAL_REVIEW_STATES.some((s) => state.includes(s))) {
      report(`✅ CodeRabbit review complete: ${state}`);
      return state;
    }

    // Handle rate limits
    const waitMins = await parseRateLimitMinutes(num, signal);
    if (waitMins) {
      report(`  ⏳ Rate limited — waiting ${waitMins} min...`);
      if (!(await abortableSleep(waitMins * 60_000, signal))) {
        return undefined;
      }
      await gh(`pr comment ${num} --body "@coderabbitai review"`, signal);
      deadline = Date.now() + MAX_WAIT_MS;
      continue;
    }

    report('  ⏳ Waiting for review...');
    if (!(await abortableSleep(POLL_INTERVAL, signal))) {
      return undefined;
    }
  }

  return undefined;
};

/**
 * Get the state of the last autofix-related comment thread.
 * This prevents duplicate `@coderabbitai autofix` commands by checking
 * whether the last comment on the PR is already an autofix request that
 * hasn't been answered yet.
 */
const getAutofixCommentState = async (
  num: string,
  signal?: AbortSignal,
): Promise<AutofixCommentState> => {
  // Fetch ALL comments (not just coderabbit's) to see the full timeline.
  const lastCommentRaw = await gh(
    `pr view ${num} --json comments --jq '[.comments | sort_by(.createdAt) | .[-1] | {author: .author.login, body: .body}] | .[0]'`,
    signal,
  );
  if (!lastCommentRaw) {
    return 'none';
  }
  try {
    const last = JSON.parse(lastCommentRaw) as { author: string; body: string };
    const isAutofixRequest = last.body.includes('@coderabbitai autofix');
    const isCoderabbit = CODERABBIT_LOGINS.includes(last.author);

    // If the last comment is @coderabbitai autofix from a non-coderabbit user,
    // and CodeRabbit hasn't replied yet — we're waiting.
    if (isAutofixRequest && !isCoderabbit) {
      return 'autofix_requested';
    }

    // If last comment is from CodeRabbit, check what it says.
    if (isCoderabbit) {
      const body = last.body;
      // 🔴 Rate limit / quota detection — check FIRST so rate-limited
      // autofix doesn't get stuck in a polling loop.
      if (
        body.includes('available in') ||
        body.includes('quota') ||
        body.includes('rate limit') ||
        body.includes('rate-limited') ||
        body.includes('Next review available') ||
        body.includes('usage limit')
      ) {
        return 'autofix_rate_limited';
      }
      if (body.includes('Autofix in progress') || body.includes('autofix in progress')) {
        return 'autofix_in_progress';
      }
      if (
        body.includes('Autofix applied') ||
        body.includes('autofix applied') ||
        body.includes('Fixes Applied') ||
        body.includes('fixes applied') ||
        body.includes('autofix-run-id')
      ) {
        return 'autofix_applied';
      }
      if (body.includes('Autofix skipped') || body.includes('autofix skipped')) {
        return 'autofix_skipped';
      }
      if (
        body.includes('Actionable comments posted') ||
        body.includes('could not resolve') ||
        body.includes('No autofix changes were needed') ||
        body.includes('unexpected error') ||
        body.includes('Not Found')
      ) {
        return 'autofix_failed';
      }
      // CodeRabbit replied but not about autofix — review is in progress
      return 'none';
    }
  } catch {
    // Fall through
  }
  return 'none';
};

/**
 * Check CodeRabbit's autofix status from comments.
 * Returns 'in_progress', 'skipped', 'completed', or undefined (not started).
 */
const getAutofixStatus = async (num: string, signal?: AbortSignal): Promise<string | undefined> => {
  // Only the newest CodeRabbit comment — a stale "unexpected error" from an
  // earlier run must not pin this PR as failed forever.
  const comments = await gh(
    `pr view ${num} --json comments --jq '([.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]")] | last | .body) // ""'`,
    signal,
  );
  if (!comments) {
    return undefined;
  }
  // 🔴 Check for errors FIRST — a comment with autofix-run-id can be a FAILURE.
  if (
    comments.includes('unexpected error') ||
    comments.includes('Not Found') ||
    comments.includes('could not generate') ||
    comments.includes('failed to generate')
  ) {
    return 'failed';
  }
  if (comments.includes('Autofix in progress') || comments.includes('autofix in progress')) {
    return 'in_progress';
  }
  if (comments.includes('Autofix skipped') || comments.includes('autofix skipped')) {
    return 'skipped';
  }
  // Completion markers — only match if no error was detected above.
  // autofix-run-id alone is ambiguous (present in both success and failure),
  // so require an explicit success marker alongside it.
  if (
    comments.includes('Autofix applied') ||
    comments.includes('autofix applied') ||
    comments.includes('Fixes Applied') ||
    comments.includes('fixes applied')
  ) {
    return 'completed';
  }
  return undefined;
};

/**
 * Phase 2: Trigger autofix (review anchors it now)
 * Phase 3: Poll for autofix commit
 * Returns the new commit SHA or undefined.
 */
const pollForAutofixCommit = async (
  num: string,
  baseline: string,
  report: Reporter,
  signal?: AbortSignal,
): Promise<string | undefined> => {
  report('⏳ Waiting for CodeRabbit autofix commit...');
  let deadline = Date.now() + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    // Check for a new commit on the branch (autofix push)
    const currentHead = (
      await gh(`pr view ${num} --json headRefOid --jq '.headRefOid'`, signal)
    ).trim();
    if (currentHead && currentHead !== baseline) {
      report(`✅ Autofix commit detected: ${currentHead.slice(0, 7)}`);
      return currentHead;
    }

    // Check autofix status in comments
    const status = await getAutofixStatus(num, signal);
    if (status === 'skipped') {
      report('📋 Autofix skipped — no fixable findings (clean).');
      return undefined;
    }
    if (status === 'completed') {
      // Autofix claims completed — check if commit landed.
      const recheck = (
        await gh(`pr view ${num} --json headRefOid --jq '.headRefOid'`, signal)
      ).trim();
      if (recheck && recheck !== baseline) {
        report(`✅ Autofix commit detected (late): ${recheck.slice(0, 7)}`);
        return recheck;
      }
      report('  No autofix commit after completion — clean.');
      return undefined;
    }

    // Handle rate limits — short-circuit instead of waiting.
    // Rate-limited autofix triggers the circuit breaker.
    const commentState = await getAutofixCommentState(num, signal);
    if (commentState === 'autofix_rate_limited') {
      report('⚠️  CodeRabbit rate-limited during autofix poll — bailing out.');
      return undefined;
    }

    const waitMins = await parseRateLimitMinutes(num, signal);
    if (waitMins) {
      report(`  ⏳ Rate limited — waiting ${waitMins} min...`);
      if (!(await abortableSleep(waitMins * 60_000, signal))) {
        return undefined;
      }
      await gh(`pr comment ${num} --body "@coderabbitai autofix"`, signal);
      deadline = Date.now() + MAX_WAIT_MS;
      continue;
    }

    // Re-check review state
    const currentReview = await pollReviewState({ pr: num, report, signal, deadline });
    if (currentReview.includes('APPROVED')) {
      report('✅ Review approved during autofix wait.');
      return undefined;
    }

    report('  ⏳ Waiting for autofix...');
    if (!(await abortableSleep(POLL_INTERVAL, signal))) {
      return undefined;
    }
  }

  return undefined;
};

export default function codeRabbitExtension(pi: ExtensionAPI): void {
  registerNamespace(pi, {
    name: 'code_rabbit',
    label: 'CodeRabbit',
    description: 'Drive CodeRabbit reviews and autofixes on a pull request.',
    actions: [
      defineAction({
        action: 'autofix',
        summary: 'Ensure a review exists, then run autofix and await the commit',

        parameters: Type.Object({
          pr: Type.String({ description: 'PR number' }),
          merge: Type.Optional(
            Type.Boolean({ default: false, description: 'Auto-merge only if no findings' }),
          ),
        }),
        async execute(_toolCallId, params: Params, signal, onUpdate, _ctx) {
          const report = makeReporter(onUpdate);
          const num = resolvePrSelector(params.pr);

          // ── Capture baseline ────────────────────────────────
          const prInfo = await readReadyPrSnapshot({ pr: num, signal });
          const baselineCommit = prInfo.headRefOid;
          const headRefName = prInfo.headRefName;
          report(`📌 Baseline commit: ${baselineCommit.slice(0, 7)} (${headRefName})`);
          let autofixCommit: string | undefined;

          // ── Phase 0: Wait for CI checks ───────────────────
          // Don't trigger CodeRabbit while CI is still running — the review
          // needs the full code context including build/lint results.
          const checksReady = await waitForCheckCompletion({ pr: num, report, signal });
          if (!checksReady) {
            if (signal?.aborted) {
              return cancelledResult(num);
            }
            return {
              content: [
                {
                  type: 'text',
                  text: [
                    `⏳ CI checks are still running on PR #${num}.`,
                    'Please wait 2 minutes and call the `code_rabbit` tool, action "autofix", again.',
                  ].join('\n'),
                },
              ],
              details: {
                pr: num,
                branch: headRefName,
                baselineCommit,
                autofixCommit: null,
                autofixApplied: false,
                autofixSkipped: true,
                reason: 'ci_checks_running',
              },
            };
          }

          // ── Phase 1: Ensure review exists ───────────────────
          const reviewState = await ensureReview(num, report, signal);
          if (!reviewState) {
            if (signal?.aborted) {
              return cancelledResult(num);
            }
            return {
              content: [
                {
                  type: 'text',
                  text: `⏰ Timed out waiting for CodeRabbit review on PR #${num}. Check PR manually.`,
                },
              ],
              details: { pr: num, branch: headRefName, baselineCommit, autofixCommit: null },
            };
          }

          // If already approved, no autofix needed.
          if (reviewState.includes('APPROVED')) {
            report('✅ CodeRabbit approved — no autofix needed.');
            await mergeReviewedHead({
              requested: params.merge,
              actionableCount: await readActionableCount(num, signal),
              pr: num,
              head: baselineCommit,
              report,
              signal,
              readReviewState: () => getReviewState(num, signal),
            });
            return {
              content: [
                {
                  type: 'text',
                  text: `✅ CodeRabbit approved PR #${num}. No autofix needed.`,
                },
              ],
              details: {
                pr: num,
                branch: headRefName,
                baselineCommit,
                autofixCommit: null,
                reviewState,
              },
            };
          }

          // ── Phase 2: Trigger autofix (review anchors it now) ─
          // 🔴 SYNC GUARD: Check if autofix is already in flight before posting.
          const preAutofixState = await getAutofixCommentState(num, signal);
          let duplicatePrevented = false;

          if (
            preAutofixState === 'autofix_requested' ||
            preAutofixState === 'autofix_in_progress'
          ) {
            report(
              `🔍 Autofix already ${preAutofixState === 'autofix_in_progress' ? 'in progress' : 'requested'} — polling instead of re-triggering.`,
            );
            duplicatePrevented = true;
          } else if (preAutofixState === 'autofix_rate_limited') {
            report('⚠️  CodeRabbit is rate-limited or quota-exhausted — short-circuiting.');
            // Skip autofix entirely — the circuit breaker will handle this.
            return {
              content: [
                {
                  type: 'text',
                  text: [
                    `⚠️  CodeRabbit is rate-limited on PR #${num}.`,
                    `**Review state:** \`${reviewState}\``,
                    '',
                    'Autofix was skipped because CodeRabbit reported rate limiting',
                    'or quota exhaustion. The circuit breaker should trigger YOLO',
                    'degradation to manual review on the next cycle.',
                  ].join('\n'),
                },
              ],
              details: {
                pr: num,
                branch: headRefName,
                baselineCommit,
                autofixCommit: null,
                reviewState,
                autofixApplied: false,
                autofixSkipped: true,
                reason: 'rate_limited',
                actionableCount: 0,
                duplicatePrevented: false,
              },
            };
          } else if (preAutofixState === 'autofix_applied') {
            // Previous autofix completed, but new commits may have been pushed
            // since then. Re-trigger to get fresh autofix on the new code.
            report('📋 Previous autofix completed — re-triggering for fresh code.');
            await gh(`pr comment ${num} --body "@coderabbitai autofix"`, signal);
          } else if (preAutofixState === 'autofix_skipped') {
            report('📋 Previous autofix skipped — re-triggering for fresh code.');
            await gh(`pr comment ${num} --body "@coderabbitai autofix"`, signal);
          } else if (preAutofixState === 'autofix_failed') {
            report('⚠️  Previous autofix failed — re-triggering.');
            await gh(`pr comment ${num} --body "@coderabbitai autofix"`, signal);
          } else {
            // Fresh PR with no autofix history — post the command exactly once.
            // 🔴 CRITICAL: without this else branch, state 'none' (the dominant
            // path on a fresh PR) falls through and autofix is never requested,
            // leaving the poll loop waiting for a commit that will never come.
            report(`🔍 Posting @coderabbitai autofix on PR #${num}...`);
            await gh(`pr comment ${num} --body "@coderabbitai autofix"`, signal);
          }

          // 🔴 Re-capture baseline AFTER posting autofix. If autofix already
          // ran (from a previous session or manual trigger), the head commit
          // may have already advanced. We need the post-trigger baseline to
          // correctly detect the NEXT autofix commit.
          if (!(await abortableSleep(2000, signal))) {
            return cancelledResult(num);
          }
          const postTriggerHead = (
            await gh(`pr view ${num} --json headRefOid --jq '.headRefOid'`, signal)
          ).trim();
          if (postTriggerHead && postTriggerHead !== baselineCommit) {
            // Autofix already completed before our trigger — adopt the existing commit.
            autofixCommit = postTriggerHead;
            report(`✅ Autofix already completed: ${autofixCommit.slice(0, 7)}`);
          } else if ((await getAutofixStatus(num, signal)) === 'completed') {
            // Autofix completed but the commit didn't change from baseline —
            // the tool was called after autofix already ran. Adopt the existing head.
            autofixCommit = postTriggerHead || baselineCommit;
            report(`✅ Autofix completed (commit already on branch): ${autofixCommit.slice(0, 7)}`);
          } else {
            // Use the post-trigger head as the new baseline for polling.
            const activeBaseline = postTriggerHead || baselineCommit;
            autofixCommit = await pollForAutofixCommit(num, activeBaseline, report, signal);
          }

          signal?.throwIfAborted();

          // 🔴 POST-AUTOFIX SYNC: Verify remote HEAD matches local worktree.
          // If CodeRabbit pushed an autofix commit, the local worktree is stale.
          // The caller must fetch and fast-forward; preserve any local changes.
          const finalAutofixState = await getAutofixCommentState(num, signal);
          const autofixApplied =
            autofixCommit !== undefined || finalAutofixState === 'autofix_applied';
          const autofixSkipped =
            finalAutofixState === 'autofix_skipped' ||
            finalAutofixState === 'autofix_rate_limited' ||
            (!autofixCommit && (await getAutofixStatus(num, signal)) === 'skipped');
          const rateLimited = finalAutofixState === 'autofix_rate_limited';

          if (
            !autofixCommit &&
            !(await getAutofixStatus(num, signal)) &&
            !(await pollReviewState({ pr: num, report, signal })).includes('APPROVED') &&
            !autofixSkipped
          ) {
            return {
              content: [
                {
                  type: 'text',
                  text: `⏰ Timed out waiting for autofix on PR #${num}. Check PR manually.`,
                },
              ],
              details: {
                pr: num,
                branch: headRefName,
                baselineCommit,
                autofixCommit: null,
                reviewState,
                autofixApplied: false,
                autofixSkipped: false,
                duplicatePrevented,
              },
            };
          }

          // ── Evaluate outcome ────────────────────────────────
          // Count actionable findings for metadata
          const actionableCount = await readActionableCount(num, signal);
          const hasActionable = actionableCount !== 0;

          if (autofixCommit) {
            report(`🎯 Autofix commit: ${autofixCommit.slice(0, 7)}`);

            return {
              content: [
                {
                  type: 'text',
                  text: [
                    `✅ CodeRabbit autofix applied on PR #${num}.`,
                    `**Autofix commit:** \`${autofixCommit.slice(0, 7)}\``,
                    `**Branch:** \`${headRefName}\``,
                    `**Review state:** \`${reviewState}\``,
                    `**Actionable findings remaining:** ${actionableCount ?? 'unknown'}`,
                    '',
                    '🔴 **REQUIRED: Sync your local worktree:**',
                    '```bash',
                    `git fetch origin ${headRefName}`,
                    `git merge --ff-only origin/${headRefName}`,
                    '```',
                  ].join('\n'),
                },
              ],
              details: {
                pr: num,
                branch: headRefName,
                baselineCommit,
                autofixCommit,
                reviewState,
                autofixApplied: true,
                autofixSkipped: false,
                actionableCount,
                duplicatePrevented,
              },
            };
          }

          await mergeReviewedHead({
            requested: params.merge,
            actionableCount,
            pr: num,
            head: baselineCommit,
            report,
            signal,
            readReviewState: () => getReviewState(num, signal),
          });

          const findingsWarning = hasActionable
            ? [
                '',
                '⚠️ **Findings remain or their remaining count is unverified.**',
                'Call the `code_rabbit` tool, action "findings", to inspect them. The Captain should decide',
                'whether these are blocking before merging.',
              ].join('\n')
            : '';

          return {
            content: [
              {
                type: 'text',
                text: [
                  `✅ CodeRabbit review complete on PR #${num}: ${reviewState}.`,
                  describeAutofixOutcome({ rateLimited, skipped: autofixSkipped, actionableCount }),
                  findingsWarning,
                  duplicatePrevented
                    ? '🔍 Duplicate autofix command was prevented (was already in flight).'
                    : '',
                ]
                  .filter(Boolean)
                  .join('\n'),
              },
            ],
            details: {
              pr: num,
              branch: headRefName,
              baselineCommit,
              autofixCommit: null,
              reviewState,
              autofixApplied,
              autofixSkipped,
              reason: rateLimited ? 'rate_limited' : undefined,
              hasActionableFindings: hasActionable,
              actionableCount,
              duplicatePrevented,
            },
          };
        },
      }),
      defineAction({
        action: 'findings',
        summary: 'Fetch structured review findings for a PR',

        parameters: Type.Object({
          pr: Type.String({ description: 'PR number' }),
        }),
        async execute(_toolCallId, params: Params, signal, onUpdate, _ctx) {
          const num = resolvePrSelector(params.pr);

          // Fetch PR metadata (owner/repo from gh)
          const prData = await ghJson<{
            headRepositoryOwner: { login: string };
            headRepository: { name: string };
          }>(
            `pr view ${num} --json headRepositoryOwner,headRepository --jq '{headRepositoryOwner: .headRepositoryOwner, headRepository: .headRepository}'`,
            signal,
          );
          if (!prData) {
            const diag = ghError();
            return {
              content: [
                {
                  type: 'text',
                  text: [
                    `❌ Could not read PR #${num}.`,
                    diag
                      ? `gh error: ${diag.slice(0, 300)}`
                      : 'Check `gh auth status` — the gh CLI returned no data.',
                  ].join('\n'),
                },
              ],
              isError: true,
              details: { pr: num },
            };
          }
          const owner = prData.headRepositoryOwner.login;
          const repo = prData.headRepository.name;

          // Fetch review state
          const reviewState = await pollReviewState({
            pr: num,
            signal,
            report: makeReporter(onUpdate),
          });

          // Fetch inline review comments via GitHub API (snake_case from API)
          const commentsJson = await gh(
            `api /repos/${owner}/${repo}/pulls/${num}/comments --jq '[.[] | select(.user.login=="coderabbitai" or .user.login=="coderabbitai[bot]") | {id: .id, path: .path, line: .line, body: .body, commitId: .commit_id, createdAt: .created_at}]'`,
            signal,
          );
          type GhComment = {
            id: number;
            path: string;
            line: number | null;
            body: string;
            commitId: string;
            createdAt: string;
          };
          let comments: GhComment[] = [];
          try {
            comments = commentsJson ? JSON.parse(commentsJson) : [];
          } catch {
            comments = [];
          }

          // Parse severity and fix prompts from comment bodies
          const findings = comments.map((c) => {
            // CodeRabbit marks severities with an optional leading underscore in
            // markdown (_🔴 Critical_, _🟠 Major_, _🟢 Minor_, _🔵 Trivial_).
            const severityMatch = c.body.match(/🔴|🟠|🟢|🔵/);
            let severity: string;
            if (!severityMatch) {
              severity = 'unknown';
            } else if (severityMatch[0] === '🔴') {
              severity = 'critical';
            } else if (severityMatch[0] === '🟠') {
              severity = 'major';
            } else if (severityMatch[0] === '🔵') {
              severity = 'trivial';
            } else {
              severity = 'minor';
            }

            // Extract the AI fix prompt from CodeRabbit's template
            const promptMatch = c.body.match(
              /<summary>🤖 Prompt for AI Agents<\/summary>\s*```\s*([\s\S]*?)```/,
            );
            const fixPrompt = promptMatch?.[1]?.trim();

            // Extract description (text before the prompt block)
            const descMatch = c.body.match(/^([\s\S]*?)(?:<details>|<summary>🤖)/);
            const description = descMatch?.[1]
              ?.trim()
              .replace(/\*\*/g, '')
              .replace(/_/g, '')
              .slice(0, 200);

            return {
              id: c.id,
              path: c.path,
              line: c.line,
              severity,
              description: description || '(no description)',
              fixPrompt: fixPrompt || undefined,
            };
          });

          const actionableCount = findings.length;
          const criticalCount = findings.filter((f) => f.severity === 'critical').length;

          return {
            content: [
              {
                type: 'text',
                text: [
                  `## CodeRabbit Review — PR #${num}`,
                  '',
                  `**State:** \`${reviewState || 'pending'}\``,
                  `**Actionable comments:** ${actionableCount} (${criticalCount} critical)`,
                  '',
                  findings.length === 0
                    ? 'No findings — review is clean.'
                    : [
                        '### Findings',
                        '',
                        ...findings.map((f) => {
                          let emoji: string;
                          if (f.severity === 'critical') {
                            emoji = '🔴';
                          } else if (f.severity === 'major') {
                            emoji = '🟠';
                          } else if (f.severity === 'trivial') {
                            emoji = '🔵';
                          } else {
                            emoji = '🟢';
                          }
                          return [
                            `#### ${emoji} \`${f.path}:${f.line ?? '?'}\``,
                            f.description,
                            f.fixPrompt
                              ? `\n<details><summary>🤖 Fix prompt</summary>\n\n\`\`\`\n${f.fixPrompt}\n\`\`\`\n</details>`
                              : '',
                            '---',
                          ].join('\n');
                        }),
                      ].join('\n'),
                ].join('\n'),
              },
            ],
            details: {
              pr: num,
              reviewState,
              actionableCount,
              criticalCount,
              findings,
            },
          };
        },
      }),
      defineAction({
        action: 'wait',
        summary: 'Wait for review completion or new actionable comments',

        parameters: Type.Object({
          pr: Type.String({ description: 'PR number' }),
          maxWaitMs: Type.Optional(
            Type.Number({ default: 30 * 60 * 1000, description: 'Max wait time in ms' }),
          ),
          intervalMs: Type.Optional(
            Type.Number({ default: 15_000, description: 'Poll interval in ms' }),
          ),
        }),
        async execute(_toolCallId, params, signal, onUpdate, _ctx) {
          const report = makeReporter(onUpdate);
          const num = resolvePrSelector(params.pr);
          const maxWaitMs = params.maxWaitMs ?? 30 * 60 * 1000;
          const intervalMs = params.intervalMs ?? 15_000;
          const deadline = Date.now() + maxWaitMs;
          let lastCommentCount = -1;

          // Get initial comment count as baseline.
          const initialComments = (
            await gh(`pr view ${num} --json comments --jq '.comments | length'`, signal)
          ).trim();
          lastCommentCount = initialComments ? Number.parseInt(initialComments, 10) : 0;
          report(`📊 Baseline: ${lastCommentCount} comments on PR #${num}`);

          while (Date.now() < deadline) {
            // Check review state
            const state = await pollReviewState({ pr: num, signal, report, deadline, intervalMs });
            if (state && TERMINAL_REVIEW_STATES.some((s) => state.includes(s))) {
              report(`✅ Review complete: ${state}`);
              return {
                content: [
                  {
                    type: 'text',
                    text: `✅ CodeRabbit review complete on PR #${num}: ${state}.`,
                  },
                ],
                details: { pr: num, reviewState: state, newComments: false },
              };
            }

            // Check for new comments
            const currentComments = (
              await gh(`pr view ${num} --json comments --jq '.comments | length'`, signal)
            ).trim();
            const currentCount = currentComments ? Number.parseInt(currentComments, 10) : 0;
            if (currentCount > lastCommentCount) {
              const newCount = currentCount - lastCommentCount;
              report(`📊 New comments: ${newCount} (total: ${currentCount})`);
              // Fetch the new comments — slice from the previous baseline count.
              const newComments = await gh(
                `pr view ${num} --json comments --jq '[.comments[${lastCommentCount}:] | .[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body] | join("\\n---\\n")'`,
                signal,
              );
              lastCommentCount = currentCount;
              return {
                content: [
                  {
                    type: 'text',
                    text: [
                      `📊 ${newCount} new comment(s) on PR #${num}.`,
                      newComments
                        ? `\n### Latest CodeRabbit comment:\n${newComments.slice(0, 800)}`
                        : '',
                    ].join('\n'),
                  },
                ],
                details: { pr: num, newComments: true, totalComments: currentCount },
              };
            }

            // Handle rate limits
            const waitMins = await parseRateLimitMinutes(num, signal);
            if (waitMins) {
              report(`  ⏳ Rate limited — waiting ${waitMins} min...`);
              if (!(await abortableSleep(waitMins * 60_000, signal))) {
                return cancelledResult(num);
              }
              continue;
            }

            report(`  ⏳ Waiting... (${Math.round((deadline - Date.now()) / 1000)}s remaining)`);
            if (!(await abortableSleep(intervalMs, signal))) {
              return cancelledResult(num);
            }
          }

          signal?.throwIfAborted();

          return {
            content: [
              {
                type: 'text',
                text: `⏰ Timed out waiting for CodeRabbit on PR #${num} after ${Math.round(maxWaitMs / 60_000)} min.`,
              },
            ],
            details: { pr: num, timedOut: true },
          };
        },
      }),
    ],
  });

  // ─────────────────────────────────────────────────────────
  // Tool 2: code_rabbit_findings — fetch structured findings
  // ─────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────
  // Tool 3: code_rabbit_wait — poll for new comments
  // ─────────────────────────────────────────────────────────
}
