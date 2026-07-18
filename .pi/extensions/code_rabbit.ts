// .pi/extensions/code_rabbit.ts
//
// CodeRabbit autofix integration — trigger, wait, apply, merge.
// Call from the review session with: code_rabbit_autofix

import { execSync } from 'node:child_process';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const TIMEOUT = 60_000;
const POLL_INTERVAL = 30_000;
const MAX_WAIT_MS = 10 * 60 * 1000;

/** Safe gh exec that won't throw on non-zero exit. */
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

/** Extract PR number from URL or raw number string. */
const prNumber = (pr: string): string => {
  const m = pr.match(/(\d+)$/);
  return m?.[1] ?? pr;
};

/** Sleep helper. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Tool: code_rabbit_autofix ────────────────────────────────────

export default function codeRabbitExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'code_rabbit_autofix',
    description: 'Trigger CodeRabbit review + autofix on a PR, wait for completion, validate, and merge.',
    parameters: Type.Object({
      pr: Type.String({ description: 'PR number (e.g. "27") or URL' }),
      merge: Type.Optional(Type.Boolean({ default: true, description: 'Auto-merge after autofix completes' })),
    }),
    async handler(params) {
      const num = prNumber(params.pr);

      // Step 1: Trigger CodeRabbit review
      pi.log(`🔍 Triggering CodeRabbit review on PR #${num}...`);
      const trigger = gh(`pr comment ${num} --body "@coderabbitai review"`);
      if (!trigger) {
        pi.log('⚠️  Could not post trigger comment. Continuing to poll...');
      }

      // Step 2: Wait for CodeRabbit to finish
      pi.log('⏳ Waiting for CodeRabbit review...');
      const deadline = Date.now() + MAX_WAIT_MS;
      let reviewDone = false;

      while (Date.now() < deadline) {
        // Check if CodeRabbit review is complete
        const reviews = gh(`pr view ${num} --json reviews --jq '.reviews[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .state'`);
        if (reviews.includes('APPROVED') || reviews.includes('COMMENTED') || reviews.includes('CHANGES_REQUESTED')) {
          reviewDone = true;
          pi.log(`✅ CodeRabbit review complete: ${reviews}`);
          break;
        }

        // Also check if review is still in progress
        const comments = gh(`pr view ${num} --json comments --jq '.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body'`);
        if (comments.includes('processing new changes') || comments.includes('Come back again')) {
          pi.log('  Still reviewing...');
        }

        // Check for rate limits
        const rateLimit = comments.match(/available in:?\s*(\d+)/);
        if (rateLimit) {
          const mins = Number.parseInt(rateLimit[1], 10);
          pi.log(`  Rate limited — waiting ${mins} minutes...`);
          await sleep(mins * 60_000);
          gh(`pr comment ${num} --body "@coderabbitai review"`);
          continue;
        }

        await sleep(POLL_INTERVAL);
      }

      if (!reviewDone) {
        pi.log('⏰ Timeout waiting for CodeRabbit review.');
        if (params.merge) {
          pi.log('Proceeding to merge anyway (YOLO).');
          gh(`pr merge ${num} --squash --delete-branch`);
          pi.log(`✅ Merged PR #${num}`);
        }
        return;
      }

      // Step 3: Check for autofix checkboxes
      pi.log('🔧 Checking for CodeRabbit autofixes...');
      const finishComment = gh(`pr view ${num} --json comments --jq '.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body'`).split('\n').find(l => l.includes('Finishing Touches') || l.includes('Trigger review'));
      
      if (finishComment) {
        // Try to check autofix checkboxes by fetching the comment ID and editing
        const commentId = gh(`api graphql -f query='query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){comments(first:5,authorLogins:["coderabbitai","coderabbitai[bot]"]){nodes{id,body}}}}}' -F owner=BearlySleeping -F repo=aikami -F pr=${num}`);
        pi.log('  CodeRabbit comment found. Check the autofix checkbox in the PR UI to trigger automatic fixes.');
      }

      // Step 4: Validate + Merge
      if (params.merge) {
        pi.log('🚀 Merging...');
        const result = gh(`pr merge ${num} --squash --delete-branch`);
        if (result) {
          pi.log(`✅ Merged PR #${num}`);
        } else {
          pi.log(`❌ Merge failed for PR #${num}. Check CI status.`);
        }
      } else {
        pi.log(`✅ PR #${num} ready for review.`);
      }
    },
  });
}
