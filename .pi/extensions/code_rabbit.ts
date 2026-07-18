// .pi/extensions/code_rabbit.ts
//
// CodeRabbit autofix integration — trigger, wait, apply, merge.
// Call from the review session with: code_rabbit_autofix

import { execSync } from 'node:child_process';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const TIMEOUT = 60_000;
const POLL_INTERVAL = 30_000;
const MAX_WAIT_MS = 30 * 60 * 1000; // 30 min total

const gh = (args: string): string => {
  try { return execSync(`gh ${args}`, { encoding: 'utf-8', stdio: ['pipe','pipe','pipe'], timeout: TIMEOUT }).trim(); }
  catch { return ''; }
};
const prNumber = (pr: string): string => { const m = pr.match(/(\d+)$/); return m?.[1] ?? pr; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Params = { pr: string; merge?: boolean };

export default function codeRabbitExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'code_rabbit_autofix',
    label: 'CodeRabbit Autofix',
    description: 'Trigger CodeRabbit review + autofix on a PR, wait for completion, apply fixes, validate, and merge.',
    parameters: Type.Object({
      pr: Type.String({ description: 'PR number (e.g. "27") or URL' }),
      merge: Type.Optional(Type.Boolean({ default: true, description: 'Auto-merge after review completes' })),
    }),
    async execute(_toolCallId, params: Params, _signal, _onUpdate, _ctx): Promise<any> {
      const num = prNumber(params.pr);

      // 1. Trigger review
      console.log(`🔍 Triggering CodeRabbit review on PR #${num}...`);
      gh(`pr comment ${num} --body "@coderabbitai review"`);

      // 2. Poll for review completion
      console.log('⏳ Waiting for CodeRabbit review...');
      let deadline = Date.now() + MAX_WAIT_MS;
      let reviewState = '';

      while (Date.now() < deadline) {
        // Check review state
        reviewState = gh(`pr view ${num} --json reviews --jq '.reviews[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .state'`);

        if (reviewState.includes('APPROVED') || reviewState.includes('COMMENTED') || reviewState.includes('CHANGES_REQUESTED')) {
          console.log(`✅ CodeRabbit review complete: ${reviewState.trim()}`);
          break;
        }

        // Check for rate limits in comments
        const comments = gh(`pr view ${num} --json comments --jq '.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body'`);
        const rateLimit = comments.match(/available in:?\s*(\d+)/);
        if (rateLimit?.[1]) {
          const mins = Number.parseInt(rateLimit[1], 10) + 1; // +1 buffer
          console.log(`  ⏳ Rate limited — waiting ${mins} minutes...`);
          await sleep(mins * 60_000);
          console.log('  🔄 Re-triggering review...');
          gh(`pr comment ${num} --body "@coderabbitai review"`);
          deadline = Date.now() + MAX_WAIT_MS; // Reset deadline after waiting
          continue;
        }

        // Progress indicator
        const inProgress = comments.includes('processing new changes') || comments.includes('Come back again');
        if (inProgress) console.log('  🔄 CodeRabbit still reviewing...');
        else console.log('  ⏳ Waiting for review to start...');

        await sleep(POLL_INTERVAL);
      }

      if (!reviewState) {
        console.log('⏰ Timed out waiting for CodeRabbit. Not merging.');
        return { content: [{ type: 'text', text: `Timed out waiting for CodeRabbit on PR #${num}. Review may still be pending.` }], details: null };
      }

      // 3. Don't merge if review requested changes
      if (reviewState.includes('CHANGES_REQUESTED')) {
        console.log('⚠️  CodeRabbit requested changes — not merging.');
        // Check for autofix checkboxes
        const comments = gh(`pr view ${num} --json comments --jq '.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body'`);
        if (comments.includes('✅ Action performed') || comments.includes('Commit unit tests in branch')) {
          console.log('  Autofix may be available — check the PR UI.');
        }
        return { content: [{ type: 'text', text: `CodeRabbit requested changes on PR #${num}. Check the PR for autofix options.` }], details: null };
      }

      // 4. Merge
      if (params.merge) {
        console.log('🚀 Merging...');
        const result = gh(`pr merge ${num} --squash --delete-branch`);
        if (result) {
          console.log(`✅ Merged PR #${num}`);
          return { content: [{ type: 'text', text: `PR #${num} merged.` }], details: null };
        }
        console.log(`❌ Merge failed. Check CI or branch protection.`);
        return { content: [{ type: 'text', text: `Merge failed for PR #${num}.` }], details: null };
      }

      return { content: [{ type: 'text', text: `CodeRabbit review complete for PR #${num} — ${reviewState.trim()}.` }], details: null };
    },
  });
}
