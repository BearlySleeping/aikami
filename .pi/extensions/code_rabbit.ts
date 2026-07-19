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
const TERMINAL_REVIEW_STATES = ['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED', 'DISMISSED'] as const;

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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
      await sleep(waitMins * 60_000);
      gh(`pr comment ${num} --body "@coderabbitai review"`);
      deadline = Date.now() + MAX_WAIT_MS;
      continue;
    }

    console.log('  ⏳ Waiting for review...');
    await sleep(POLL_INTERVAL);
  }

  return undefined;
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
  if (comments.includes('Autofix in progress') || comments.includes('autofix in progress')) {
    return 'in_progress';
  }
  if (comments.includes('Autofix skipped') || comments.includes('autofix skipped')) {
    return 'skipped';
  }
  if (comments.includes('Autofix applied') || comments.includes('autofix applied')) {
    return 'completed';
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
    async execute(_toolCallId, params: Params, _signal, _onUpdate, _ctx): Promise<any> {
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
      console.log(`🔍 Posting @coderabbitai autofix on PR #${num}...`);
      gh(`pr comment ${num} --body "@coderabbitai autofix"`);

      // ── Phase 3: Poll for autofix commit ────────────────
      console.log('⏳ Waiting for CodeRabbit autofix commit...');
      let deadline = Date.now() + MAX_WAIT_MS;
      let autofixCommit: string | undefined;

      while (Date.now() < deadline) {
        // Check for a new commit on the branch (autofix push)
        const currentHead = gh(`pr view ${num} --json headRefOid --jq '.headRefOid'`).trim();
        if (currentHead && currentHead !== baselineCommit) {
          autofixCommit = currentHead;
          console.log(`✅ Autofix commit detected: ${autofixCommit.slice(0, 7)}`);
          break;
        }

        // Check autofix status in comments
        const autofixStatus = getAutofixStatus(num);
        if (autofixStatus === 'skipped') {
          // Autofix skipped — no fixable findings. This is a clean outcome.
          console.log('📋 Autofix skipped — no fixable findings (clean).');
          break;
        }
        if (autofixStatus === 'completed' && !autofixCommit) {
          // Autofix claims completed but no commit detected yet — give it a moment.
          console.log('  Autofix completed, waiting for commit push...');
          await sleep(5_000);
          const recheck = gh(`pr view ${num} --json headRefOid --jq '.headRefOid'`).trim();
          if (recheck && recheck !== baselineCommit) {
            autofixCommit = recheck;
            console.log(`✅ Autofix commit detected (late): ${autofixCommit.slice(0, 7)}`);
            break;
          }
          // No commit after "completed" — treat as clean.
          console.log('  No autofix commit after completion — clean.');
          break;
        }

        // Handle rate limits
        const waitMins = parseRateLimitMinutes(num);
        if (waitMins) {
          console.log(`  ⏳ Rate limited — waiting ${waitMins} min...`);
          await sleep(waitMins * 60_000);
          gh(`pr comment ${num} --body "@coderabbitai autofix"`);
          deadline = Date.now() + MAX_WAIT_MS;
          continue;
        }

        // Re-check review state — if it transitioned to APPROVED, we're done.
        const currentReview = getReviewState(num);
        if (currentReview.includes('APPROVED')) {
          console.log('✅ Review approved during autofix wait.');
          break;
        }

        console.log('  ⏳ Waiting for autofix...');
        await sleep(POLL_INTERVAL);
      }

      if (!autofixCommit && !getAutofixStatus(num) && !getReviewState(num).includes('APPROVED')) {
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
          },
        };
      }

      // ── Evaluate outcome ────────────────────────────────
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
          },
        };
      }

      // No autofix commit — either skipped (clean) or approved mid-wait.
      // Check if CodeRabbit left actionable comments that autofix couldn't handle.
      const commentsBody = gh(
        `pr view ${num} --json comments --jq '[.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body] | join(" ")'`,
      );
      const hasActionable = commentsBody.includes('Actionable comments posted:');

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
              hasActionable
                ? `⚠️  ${commentsBody.match(/Actionable comments posted: (\d+)/)?.[1] ?? '?'} actionable comments — autofix could not resolve them.`
                : 'No autofix changes were needed (clean review).',
              findingsWarning,
            ].join('\n'),
          },
        ],
        details: {
          pr: num,
          branch: headRefName,
          baselineCommit,
          autofixCommit: null,
          reviewState,
          hasActionableFindings: hasActionable,
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
    async execute(_toolCallId, params: Params, _signal, _onUpdate, _ctx): Promise<any> {
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
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx): Promise<any> {
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
          await sleep(waitMins * 60_000);
          continue;
        }

        console.log(`  ⏳ Waiting... (${Math.round((deadline - Date.now()) / 1000)}s remaining)`);
        await sleep(intervalMs);
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
