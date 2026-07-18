// .pi/extensions/code_rabbit.ts
//
// CodeRabbit native autofix integration — trigger `@coderabbitai autofix`,
// wait for the platform to push its autofix commit to the remote branch,
// then return the new commit SHA so the caller can sync their local worktree.
//
// Call from the review session with: code_rabbit_autofix

import { execSync } from 'node:child_process';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const TIMEOUT = 60_000;
const POLL_INTERVAL = 30_000;
const MAX_WAIT_MS = 30 * 60 * 1000;
const CODERABBIT_LOGINS = ['coderabbitai', 'coderabbitai[bot]'];

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

export default function codeRabbitExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'code_rabbit_autofix',
    label: 'CodeRabbit Autofix',
    description:
      'Trigger CodeRabbit native autofix (@coderabbitai autofix), wait for the autofix ' +
      'commit to land on the remote branch, return the commit SHA. Caller ' +
      'must git fetch + reset --hard to sync the local worktree.',
    parameters: Type.Object({
      pr: Type.String({ description: 'PR number' }),
      merge: Type.Optional(
        Type.Boolean({ default: false, description: 'Auto-merge only if no findings' }),
      ),
    }),
    // biome-ignore lint/suspicious/noExplicitAny: Pi SDK AgentToolResult is deep-generic
    async execute(_toolCallId, params: Params, _signal, _onUpdate, _ctx): Promise<any> {
      const num = prNumber(params.pr);

      // ── 1. Capture pre-autofix baseline ──────────────────
      const prInfo = ghJson<PrViewResult>(`pr view ${num} --json headRefOid,headRefName,reviews`);
      if (!prInfo) {
        return {
          content: [{ type: 'text', text: `❌ Could not read PR #${num}. Check gh auth.` }],
        };
      }
      const baselineCommit = prInfo.headRefOid;
      const headRefName = prInfo.headRefName;
      console.log(`📌 Baseline commit: ${baselineCommit.slice(0, 7)} (${headRefName})`);

      // ── 2. Check for existing CodeRabbit review ──────────
      const existingReview = prInfo.reviews.find((r) => CODERABBIT_LOGINS.includes(r.author.login));
      if (existingReview?.state === 'APPROVED') {
        console.log('✅ CodeRabbit already approved this PR.');
        return {
          content: [
            {
              type: 'text',
              text: `CodeRabbit already approved PR #${num}. No autofix needed.`,
            },
          ],
          details: { pr: num, branch: headRefName, baselineCommit, autofixCommit: null },
        };
      }

      // ── 3. Trigger native autofix ────────────────────────
      console.log(`🔍 Requesting CodeRabbit Native Autofix on PR #${num}...`);
      gh(`pr comment ${num} --body "@coderabbitai autofix"`);

      // ── 4. Poll for autofix commit ───────────────────────
      // CodeRabbit's autofix pipeline: reads the PR, generates fixes,
      // pushes a commit directly to the head branch. We detect completion
      // by watching for a NEW commit on the branch (different from baseline).
      console.log('⏳ Waiting for CodeRabbit autofix commit...');
      let deadline = Date.now() + MAX_WAIT_MS;
      let reviewState = '';
      let autofixCommit: string | undefined;

      while (Date.now() < deadline) {
        // Check review state
        const currentReviews = gh(
          `pr view ${num} --json reviews --jq '.reviews[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .state'`,
        ).trim();
        reviewState = currentReviews;

        // Check for a new commit on the branch
        const currentHead = gh(`pr view ${num} --json headRefOid --jq '.headRefOid'`).trim();

        if (currentHead && currentHead !== baselineCommit) {
          // CodeRabbit pushed a commit!
          autofixCommit = currentHead;
          console.log(`✅ Autofix commit detected: ${autofixCommit.slice(0, 7)}`);
          break;
        }

        // Check rate limits in CodeRabbit comments
        const rateLimit = gh(
          `pr view ${num} --json comments --jq '[.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body] | join(" ")'`,
        );
        const waitMatch = rateLimit.match(/available in:?\s*(\d+)/);
        if (waitMatch?.[1]) {
          const mins = Number.parseInt(waitMatch[1], 10) + 1;
          console.log(`  ⏳ Rate limited — waiting ${mins} min...`);
          await sleep(mins * 60_000);
          // Re-trigger after rate limit expires
          gh(`pr comment ${num} --body "@coderabbitai autofix"`);
          deadline = Date.now() + MAX_WAIT_MS;
          continue;
        }

        // If CodeRabbit has finished reviewing (APPROVED/COMMENTED/CHANGES_REQUESTED)
        // but no commit was pushed, the review is clean or autofix had nothing to do.
        if (reviewState === 'APPROVED' || reviewState === 'COMMENTED') {
          console.log(`✅ Review complete: ${reviewState} (no autofix commit needed)`);
          break;
        }
        if (reviewState === 'CHANGES_REQUESTED') {
          // CodeRabbit found issues but autofix couldn't resolve them.
          console.log('⚠️  CodeRabbit requested changes — autofix could not resolve all issues.');
          break;
        }

        console.log('  ⏳ Waiting for autofix commit...');
        await sleep(POLL_INTERVAL);
      }

      // ── 5. Evaluate outcome ──────────────────────────────
      if (autofixCommit) {
        // CodeRabbit successfully pushed an autofix commit.
        console.log(`🎯 Autofix commit: ${autofixCommit.slice(0, 7)}`);
        console.log('   Caller must run: git fetch origin && git reset --hard origin/<branch>');

        if (params.merge && reviewState === 'APPROVED') {
          console.log('🚀 Auto-merging...');
          const result = gh(`pr merge ${num} --squash --delete-branch`);
          if (result) {
            console.log(`✅ Merged PR #${num}`);
          } else {
            console.log('❌ Merge failed.');
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: [
                `✅ CodeRabbit autofix applied on PR #${num}.`,
                `**Autofix commit:** \`${autofixCommit.slice(0, 7)}\``,
                `**Branch:** \`${headRefName}\``,
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

      if (reviewState === 'CHANGES_REQUESTED') {
        // Fetch the findings for diagnostics
        const findingsText = gh(
          `pr view ${num} --json comments --jq '[.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body] | join("\\n---\\n")'`,
        );

        if (params.merge) {
          console.log('  Skipping merge — unresolved findings.');
        }

        return {
          content: [
            {
              type: 'text',
              text: [
                `⚠️ CodeRabbit requested changes on PR #${num} — autofix could not resolve all issues.`,
                '',
                '### CodeRabbit findings',
                findingsText || '(could not fetch findings — use gh_pr_comments or MCP tools)',
                '',
                '### Next steps',
                '- Review findings manually and apply fixes with `edit`',
                '- Re-trigger autofix by calling `code_rabbit_autofix` again',
              ].join('\n'),
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

      if (!reviewState && !autofixCommit) {
        return {
          content: [
            {
              type: 'text',
              text: `⏰ Timed out waiting for CodeRabbit on PR #${num}. Check PR manually.`,
            },
          ],
          details: { pr: num, branch: headRefName, baselineCommit, autofixCommit: null },
        };
      }

      // Clean review — no autofix needed, no changes requested.
      console.log(`✅ CodeRabbit done: ${reviewState || 'completed'} (clean)`);

      if (params.merge) {
        console.log('🚀 No findings — merging...');
        const result = gh(`pr merge ${num} --squash --delete-branch`);
        if (result) {
          console.log(`✅ Merged PR #${num}`);
        } else {
          console.log('❌ Merge failed.');
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ CodeRabbit review complete on PR #${num}: ${reviewState || 'clean'}.`,
              autofixCommit
                ? `Autofix commit: \`${autofixCommit.slice(0, 7)}\``
                : 'No autofix changes were needed.',
            ].join('\n'),
          },
        ],
        details: {
          pr: num,
          branch: headRefName,
          baselineCommit,
          autofixCommit: autofixCommit ?? null,
          reviewState,
        },
      };
    },
  });
}
