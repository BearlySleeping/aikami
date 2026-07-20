// .pi/extensions/code_rabbit.ts
//
// CodeRabbit native autofix integration — two-phase lifecycle:
//   Phase 1: Ensure a CodeRabbit review exists (trigger + poll + rate-limit handling)
//   Phase 2: Post @coderabbitai autofix (now that the review anchors it) + poll for commit
//
// Returns the autofix commit SHA so the caller can sync their local worktree.
//
// Call from the review session with: code_rabbit_autofix

import { execSync } from 'node:child_process';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const TIMEOUT = 60_000;
const POLL_INTERVAL = 15_000;
const MAX_WAIT_MS = 30 * 60 * 1000;
const CHECKS_POLL_INTERVAL = 10_000;
const MAX_CHECKS_WAIT_MS = 90 * 1000; // 90s — LLM connection timeout safe
const TERMINAL_REVIEW_STATES = ['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED', 'DISMISSED'] as const;
const CODERABBIT_LOGINS = ['coderabbitai', 'coderabbitai[bot]'];

/** Autofix cycle state — prevents duplicate `@coderabbitai autofix` commands. */
type AutofixCommentState =
  | 'none'
  | 'autofix_requested' // Last comment is `@coderabbitai autofix` — waiting for CodeRabbit reply
  | 'autofix_in_progress' // CodeRabbit replied — autofix is running
  | 'autofix_applied' // CodeRabbit autofix completed with changes
  | 'autofix_skipped' // CodeRabbit autofix skipped — no fixable findings
  | 'autofix_failed' // CodeRabbit autofix could not resolve findings
  | 'autofix_rate_limited'; // CodeRabbit is rate-limited or quota-exhausted

const gh = (args: string): string => {
  try {
    return execSync(`gh ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: TIMEOUT,
    }).trim();
  } catch {
    return '';
  }
};

const ghJson = <T>(args: string): T | undefined => {
  try {
    const raw = execSync(`gh ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: TIMEOUT,
    }).trim();
    if (!raw) {
      return undefined;
    }
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

const prNumber = (pr: string): string => {
  const m = pr.match(/(\d+)$/);
  return m?.[1] ?? pr;
};

/** Sleep that throws if the signal is aborted (user pressed Esc/Ctrl+C). */
const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    throw new Error('Aborted');
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

/** Module-level abort signal set at tool entry. Checked by ensureReview + pollForAutofixCommit. */
let _signal: AbortSignal | undefined;

type PrViewResult = {
  headRefOid: string;
  headRefName: string;
  reviews: Array<{ author: { login: string }; state: string }>;
};

type Params = { pr: string; merge?: boolean };

/** Get the current CodeRabbit review state, or empty string if no review yet. */
const getReviewState = (num: string): string =>
  gh(
    `pr view ${num} --json reviews --jq '[.reviews[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .state] | join(",")'`,
  ).trim();

/** Parse rate-limit wait minutes from CodeRabbit comments. Returns undefined if no limit. */
const parseRateLimitMinutes = (num: string): number | undefined => {
  const comments = gh(
    `pr view ${num} --json comments --jq '[.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body] | join(" ")'`,
  );
  // CodeRabbit formats: "Next review available in: **4 minutes**"
  // or "available in: 15 minutes". Match flexibly around markdown.
  const m = comments.match(/available in[\s\S]*?(\d+)\s*min/);
  return m?.[1] ? Number.parseInt(m[1], 10) + 1 : undefined;
};

/**
 * Phase 1: Ensure a CodeRabbit review exists.
 * Returns the terminal review state (APPROVED / COMMENTED / CHANGES_REQUESTED / DISMISSED)
 * or undefined if timed out.
 */
const ensureReview = async (num: string): Promise<string | undefined> => {
  // Check if review already exists.
  const existing = getReviewState(num);
  if (existing && TERMINAL_REVIEW_STATES.some((s) => existing.includes(s))) {
    console.log(`📋 Existing CodeRabbit review: ${existing}`);
    return existing;
  }

  // No review yet — trigger one.
  console.log('📋 No CodeRabbit review found. Requesting review...');
  gh(`pr comment ${num} --body "@coderabbitai review"`);

  let deadline = Date.now() + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const state = getReviewState(num);

    if (state && TERMINAL_REVIEW_STATES.some((s) => state.includes(s))) {
      console.log(`✅ CodeRabbit review complete: ${state}`);
      return state;
    }

    // Handle rate limits
    const waitMins = parseRateLimitMinutes(num);
    if (waitMins) {
      console.log(`  ⏳ Rate limited — waiting ${waitMins} min...`);
      await abortableSleep(waitMins * 60_000, _signal);
      gh(`pr comment ${num} --body "@coderabbitai review"`);
      deadline = Date.now() + MAX_WAIT_MS;
      continue;
    }

    console.log('  ⏳ Waiting for review...');
    await abortableSleep(POLL_INTERVAL, _signal);
  }

  return undefined;
};

/**
 * Get the state of the last autofix-related comment thread.
 * This prevents duplicate `@coderabbitai autofix` commands by checking
 * whether the last comment on the PR is already an autofix request that
 * hasn't been answered yet.
 */
const getAutofixCommentState = (num: string): AutofixCommentState => {
  // Fetch ALL comments (not just coderabbit's) to see the full timeline.
  const lastCommentRaw = gh(
    `pr view ${num} --json comments --jq '[.comments | sort_by(.createdAt) | .[-1] | {author: .author.login, body: .body}] | .[0]'`,
  );
  if (!lastCommentRaw) {
    return 'none';
  }
  try {
    const last = JSON.parse(lastCommentRaw) as { author: string; body: string };
    const isAutofixRequest =
      last.body.includes('@coderabbitai autofix') || last.body.includes('@coderabbitai autofix');
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
const getAutofixStatus = (num: string): string | undefined => {
  const comments = gh(
    `pr view ${num} --json comments --jq '[.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body] | join("\\n")'`,
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
 * Check if any CI checks are pending on the PR.
 * Returns { pending: boolean, pendingCount: number }.
 */
const getChecksPending = (num: string): { pending: boolean; pendingCount: number } => {
  const checksRaw = gh(`pr checks ${num}`);
  if (!checksRaw) {
    return { pending: false, pendingCount: 0 };
  }
  // Parse `gh pr checks` output — lines containing "pending" or "in_progress"
  const lines = checksRaw.split('\n');
  let pendingCount = 0;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes('pending') || lower.includes('in_progress') || lower.includes('⏳')) {
      pendingCount++;
    }
  }
  return { pending: pendingCount > 0, pendingCount };
};

/**
 * Wait for all CI checks to complete (pass or fail), not just pending.
 * Returns true if all checks completed (none pending), false if timed out.
 */
const waitForChecks = async (num: string): Promise<boolean> => {
  const deadline = Date.now() + MAX_CHECKS_WAIT_MS;
  console.log('⏳ Waiting for CI checks to complete (max 90s)...');
  while (Date.now() < deadline) {
    const { pending, pendingCount } = getChecksPending(num);
    if (!pending) {
      console.log('✅ All CI checks completed.');
      return true;
    }
    console.log(`  ⏳ ${pendingCount} check(s) pending...`);
    await abortableSleep(CHECKS_POLL_INTERVAL, _signal);
  }
  console.log('⚠️  CI checks still running after 90s — bailing out gracefully.');
  return false;
};

/**
 * Phase 2: Trigger autofix (review anchors it now)
 * Phase 3: Poll for autofix commit
 * Returns the new commit SHA or undefined.
 */
const pollForAutofixCommit = async (num: string, baseline: string): Promise<string | undefined> => {
  console.log('⏳ Waiting for CodeRabbit autofix commit...');
  let deadline = Date.now() + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    // Check for a new commit on the branch (autofix push)
    const currentHead = gh(`pr view ${num} --json headRefOid --jq '.headRefOid'`).trim();
    if (currentHead && currentHead !== baseline) {
      console.log(`✅ Autofix commit detected: ${currentHead.slice(0, 7)}`);
      return currentHead;
    }

    // Check autofix status in comments
    const status = getAutofixStatus(num);
    if (status === 'skipped') {
      console.log('📋 Autofix skipped — no fixable findings (clean).');
      return undefined;
    }
    if (status === 'completed') {
      // Autofix claims completed — check if commit landed.
      const recheck = gh(`pr view ${num} --json headRefOid --jq '.headRefOid'`).trim();
      if (recheck && recheck !== baseline) {
        console.log(`✅ Autofix commit detected (late): ${recheck.slice(0, 7)}`);
        return recheck;
      }
      console.log('  No autofix commit after completion — clean.');
      return undefined;
    }

    // Handle rate limits — short-circuit instead of waiting.
    // Rate-limited autofix triggers the circuit breaker.
    const commentState = getAutofixCommentState(num);
    if (commentState === 'autofix_rate_limited') {
      console.log('⚠️  CodeRabbit rate-limited during autofix poll — bailing out.');
      return undefined;
    }

    const waitMins = parseRateLimitMinutes(num);
    if (waitMins) {
      console.log(`  ⏳ Rate limited — waiting ${waitMins} min...`);
      await abortableSleep(waitMins * 60_000, _signal);
      gh(`pr comment ${num} --body "@coderabbitai autofix"`);
      deadline = Date.now() + MAX_WAIT_MS;
      continue;
    }

    // Re-check review state
    const currentReview = getReviewState(num);
    if (currentReview.includes('APPROVED')) {
      console.log('✅ Review approved during autofix wait.');
      return undefined;
    }

    console.log('  ⏳ Waiting for autofix...');
    await abortableSleep(POLL_INTERVAL, _signal);
  }

  return undefined;
};

export default function codeRabbitExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'code_rabbit_autofix',
    label: 'CodeRabbit Autofix',
    description:
      'Two-phase CodeRabbit autofix: (1) ensure a review exists (trigger + wait + handle rate limits), ' +
      '(2) post @coderabbitai autofix after the review anchors it, then poll for the autofix commit. ' +
      'Caller must git fetch + reset --hard to sync the local worktree.',
    parameters: Type.Object({
      pr: Type.String({ description: 'PR number' }),
      merge: Type.Optional(
        Type.Boolean({ default: false, description: 'Auto-merge only if no findings' }),
      ),
    }),
    // biome-ignore lint/suspicious/noExplicitAny: Pi SDK AgentToolResult is deep-generic
    async execute(_toolCallId, params: Params, signal, _onUpdate, _ctx): Promise<any> {
      _signal = signal;
      const num = prNumber(params.pr);

      // ── Capture baseline ────────────────────────────────
      const prInfo = ghJson<PrViewResult>(`pr view ${num} --json headRefOid,headRefName,reviews`);
      if (!prInfo) {
        return {
          content: [{ type: 'text', text: `❌ Could not read PR #${num}. Check gh auth.` }],
        };
      }
      const baselineCommit = prInfo.headRefOid;
      const headRefName = prInfo.headRefName;
      console.log(`📌 Baseline commit: ${baselineCommit.slice(0, 7)} (${headRefName})`);
      let autofixCommit: string | undefined;

      // ── Phase 0: Wait for CI checks ───────────────────
      // Don't trigger CodeRabbit while CI is still running — the review
      // needs the full code context including build/lint results.
      const checksReady = await waitForChecks(num);
      if (!checksReady) {
        return {
          content: [
            {
              type: 'text',
              text: [
                `⏳ CI checks are still running on PR #${num}.`,
                'Please wait 2 minutes and call `code_rabbit_autofix` again.',
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
      const reviewState = await ensureReview(num);
      if (!reviewState) {
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
        console.log('✅ CodeRabbit approved — no autofix needed.');
        if (params.merge) {
          console.log('🚀 Merging...');
          const result = gh(`pr merge ${num} --squash --delete-branch`);
          console.log(result ? `✅ Merged PR #${num}` : '❌ Merge failed.');
        }
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
      const preAutofixState = getAutofixCommentState(num);
      let duplicatePrevented = false;

      if (preAutofixState === 'autofix_requested' || preAutofixState === 'autofix_in_progress') {
        console.log(
          `🔍 Autofix already ${preAutofixState === 'autofix_in_progress' ? 'in progress' : 'requested'} — polling instead of re-triggering.`,
        );
        duplicatePrevented = true;
      } else if (preAutofixState === 'autofix_rate_limited') {
        console.log('⚠️  CodeRabbit is rate-limited or quota-exhausted — short-circuiting.');
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
        console.log('📋 Previous autofix completed — re-triggering for fresh code.');
        gh(`pr comment ${num} --body "@coderabbitai autofix"`);
      } else if (preAutofixState === 'autofix_skipped') {
        console.log('📋 Previous autofix skipped — re-triggering for fresh code.');
        gh(`pr comment ${num} --body "@coderabbitai autofix"`);
      } else if (preAutofixState === 'autofix_failed') {
        console.log('⚠️  Previous autofix failed — re-triggering.');
        gh(`pr comment ${num} --body "@coderabbitai autofix"`);
        console.log(`🔍 Posting @coderabbitai autofix on PR #${num}...`);
        gh(`pr comment ${num} --body "@coderabbitai autofix"`);
      }

      // 🔴 Re-capture baseline AFTER posting autofix. If autofix already
      // ran (from a previous session or manual trigger), the head commit
      // may have already advanced. We need the post-trigger baseline to
      // correctly detect the NEXT autofix commit.
      await abortableSleep(2000, _signal);
      const postTriggerHead = gh(`pr view ${num} --json headRefOid --jq '.headRefOid'`).trim();
      if (postTriggerHead && postTriggerHead !== baselineCommit) {
        // Autofix already completed before our trigger — adopt the existing commit.
        autofixCommit = postTriggerHead;
        console.log(`✅ Autofix already completed: ${autofixCommit.slice(0, 7)}`);
      } else if (getAutofixStatus(num) === 'completed') {
        // Autofix completed but the commit didn't change from baseline —
        // the tool was called after autofix already ran. Adopt the existing head.
        autofixCommit = postTriggerHead || baselineCommit;
        console.log(
          `✅ Autofix completed (commit already on branch): ${autofixCommit.slice(0, 7)}`,
        );
      } else {
        // Use the post-trigger head as the new baseline for polling.
        const activeBaseline = postTriggerHead || baselineCommit;
        autofixCommit = await pollForAutofixCommit(num, activeBaseline);
      }

      // 🔴 POST-AUTOFIX SYNC: Verify remote HEAD matches local worktree.
      // If CodeRabbit pushed an autofix commit, the local worktree is stale.
      // The caller MUST git fetch + reset --hard before proceeding.
      const finalAutofixState = getAutofixCommentState(num);
      const autofixApplied = autofixCommit !== undefined || finalAutofixState === 'autofix_applied';
      const autofixSkipped =
        finalAutofixState === 'autofix_skipped' ||
        finalAutofixState === 'autofix_rate_limited' ||
        (!autofixCommit && getAutofixStatus(num) === 'skipped');
      const rateLimited = finalAutofixState === 'autofix_rate_limited';

      if (
        !autofixCommit &&
        !getAutofixStatus(num) &&
        !getReviewState(num).includes('APPROVED') &&
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
      const commentsBody = gh(
        `pr view ${num} --json comments --jq '[.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body] | join(" ")'`,
      );
      const hasActionable = commentsBody.includes('Actionable comments posted:');
      const actionableCount = hasActionable
        ? Number.parseInt(commentsBody.match(/Actionable comments posted: (\d+)/)?.[1] ?? '0', 10)
        : 0;

      if (autofixCommit) {
        console.log(`🎯 Autofix commit: ${autofixCommit.slice(0, 7)}`);

        return {
          content: [
            {
              type: 'text',
              text: [
                `✅ CodeRabbit autofix applied on PR #${num}.`,
                `**Autofix commit:** \`${autofixCommit.slice(0, 7)}\``,
                `**Branch:** \`${headRefName}\``,
                `**Review state:** \`${reviewState}\``,
                `**Actionable findings remaining:** ${actionableCount}`,
                '',
                '🔴 **REQUIRED: Sync your local worktree:**',
                '```bash',
                `git fetch origin ${headRefName}`,
                `git reset --hard origin/${headRefName}`,
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

      // No autofix commit — either skipped (clean) or approved mid-wait.
      if (params.merge && reviewState.includes('APPROVED') && !hasActionable) {
        console.log('🚀 No autofix needed — merging...');
        const result = gh(`pr merge ${num} --squash --delete-branch`);
        console.log(result ? `✅ Merged PR #${num}` : '❌ Merge failed.');
      }

      const findingsWarning = hasActionable
        ? [
            '',
            '⚠️  **CodeRabbit found actionable comments that autofix could not resolve.**',
            'Call `code_rabbit_findings` to inspect them. The Captain should decide',
            'whether these are blocking before merging.',
          ].join('\n')
        : '';

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ CodeRabbit review complete on PR #${num}: ${reviewState}.`,
              rateLimited
                ? '⚠️  CodeRabbit is rate-limited — autofix could not run.'
                : autofixSkipped
                  ? 'No autofix changes were needed (clean review).'
                  : hasActionable
                    ? `⚠️  ${actionableCount} actionable comments — autofix could not resolve them.`
                    : 'No autofix changes were needed (clean review).',
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
  });

  // ─────────────────────────────────────────────────────────
  // Tool 2: code_rabbit_findings — fetch structured findings
  // ─────────────────────────────────────────────────────────
  pi.registerTool({
    name: 'code_rabbit_findings',
    label: 'CodeRabbit Findings',
    description:
      'Fetch structured CodeRabbit review findings via gh CLI (no API token needed). ' +
      'Returns review state, actionable comment count, and individual findings with ' +
      'severity, file path, line range, description, and AI fix prompt.',
    parameters: Type.Object({
      pr: Type.String({ description: 'PR number' }),
    }),
    // biome-ignore lint/suspicious/noExplicitAny: Pi SDK AgentToolResult is deep-generic
    async execute(_toolCallId, params: Params, signal, _onUpdate, _ctx): Promise<any> {
      _signal = signal;
      const num = prNumber(params.pr);

      // Fetch PR metadata (owner/repo from gh)
      const prData = ghJson<{
        headRepositoryOwner: { login: string };
        headRepository: { name: string };
      }>(
        `pr view ${num} --json headRepositoryOwner,headRepository --jq '{headRepositoryOwner: .headRepositoryOwner, headRepository: .headRepository}'`,
      );
      if (!prData) {
        return {
          content: [{ type: 'text', text: `❌ Could not read PR #${num}.` }],
        };
      }
      const owner = prData.headRepositoryOwner.login;
      const repo = prData.headRepository.name;

      // Fetch review state
      const reviewState = getReviewState(num);

      // Fetch inline review comments via GitHub API (snake_case from API)
      const commentsJson = gh(
        `api /repos/${owner}/${repo}/pulls/${num}/comments --jq '[.[] | select(.user.login=="coderabbitai" or .user.login=="coderabbitai[bot]") | {id: .id, path: .path, line: .line, body: .body, commitId: .commit_id, createdAt: .created_at}]'`,
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
        const severityMatch = c.body.match(/🟢|🟠|🔴|_🟢|_🟠|_🔴/);
        const severity = severityMatch
          ? severityMatch[0].includes('🔴')
            ? 'critical'
            : severityMatch[0].includes('🟠')
              ? 'major'
              : 'minor'
          : 'unknown';

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
                    ...findings.map((f) =>
                      [
                        `#### ${f.severity === 'critical' ? '🔴' : f.severity === 'major' ? '🟠' : '🟢'} \`${f.path}:${f.line ?? '?'}\``,
                        f.description,
                        f.fixPrompt
                          ? `\n<details><summary>🤖 Fix prompt</summary>\n\n\`\`\`\n${f.fixPrompt}\n\`\`\`\n</details>`
                          : '',
                        '---',
                      ].join('\n'),
                    ),
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
  });

  // ─────────────────────────────────────────────────────────
  // Tool 3: code_rabbit_wait — poll for new comments
  // ─────────────────────────────────────────────────────────
  pi.registerTool({
    name: 'code_rabbit_wait',
    label: 'CodeRabbit Wait for Review',
    description:
      'Poll for CodeRabbit review completion on a PR. Waits up to maxWaitMs ' +
      '(default 30min), polling every intervalMs (default 30s). Returns when ' +
      'a terminal review state is reached or new actionable comments appear. ' +
      'Handles rate limits automatically.',
    parameters: Type.Object({
      pr: Type.String({ description: 'PR number' }),
      maxWaitMs: Type.Optional(
        Type.Number({ default: 30 * 60 * 1000, description: 'Max wait time in ms' }),
      ),
      intervalMs: Type.Optional(
        Type.Number({ default: 15_000, description: 'Poll interval in ms' }),
      ),
    }),
    // biome-ignore lint/suspicious/noExplicitAny: Pi SDK AgentToolResult is deep-generic
    async execute(_toolCallId, params, signal, _onUpdate, _ctx): Promise<any> {
      _signal = signal;
      const num = prNumber(params.pr);
      const maxWaitMs = params.maxWaitMs ?? 30 * 60 * 1000;
      const intervalMs = params.intervalMs ?? 15_000;
      const deadline = Date.now() + maxWaitMs;
      let lastCommentCount = -1;

      // Get initial comment count as baseline.
      const initialComments = gh(`pr view ${num} --json comments --jq '.comments | length'`).trim();
      lastCommentCount = initialComments ? Number.parseInt(initialComments, 10) : 0;
      console.log(`📊 Baseline: ${lastCommentCount} comments on PR #${num}`);

      while (Date.now() < deadline) {
        // Check review state
        const state = getReviewState(num);
        if (state && TERMINAL_REVIEW_STATES.some((s) => state.includes(s))) {
          console.log(`✅ Review complete: ${state}`);
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
        const currentComments = gh(
          `pr view ${num} --json comments --jq '.comments | length'`,
        ).trim();
        const currentCount = currentComments ? Number.parseInt(currentComments, 10) : 0;
        if (currentCount > lastCommentCount) {
          console.log(
            `📊 New comments: ${currentCount - lastCommentCount} (total: ${currentCount})`,
          );
          lastCommentCount = currentCount;
          // Fetch the new comments
          const newComments = gh(
            `pr view ${num} --json comments --jq '[.comments[${lastCommentCount - (currentCount - lastCommentCount)}:] | .[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body] | join("\\n---\\n")'`,
          );
          return {
            content: [
              {
                type: 'text',
                text: [
                  `📊 ${currentCount - (lastCommentCount - (currentCount - lastCommentCount))} new comments on PR #${num}.`,
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
        const waitMins = parseRateLimitMinutes(num);
        if (waitMins) {
          console.log(`  ⏳ Rate limited — waiting ${waitMins} min...`);
          await abortableSleep(waitMins * 60_000, _signal);
          continue;
        }

        console.log(`  ⏳ Waiting... (${Math.round((deadline - Date.now()) / 1000)}s remaining)`);
        await abortableSleep(intervalMs, _signal);
      }

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
  });
}
