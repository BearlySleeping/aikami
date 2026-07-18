// .pi/extensions/code_rabbit.ts
//
// CodeRabbit autofix integration — trigger, wait, apply, merge.
// Call from the review session with: code_rabbit_autofix

import { execSync } from 'node:child_process';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const TIMEOUT = 60_000;
const POLL_INTERVAL = 30_000;
const MAX_WAIT_MS = 30 * 60 * 1000;

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
    description: 'Trigger CodeRabbit review, wait for completion, fetch findings. Does NOT merge if findings exist.',
    parameters: Type.Object({
      pr: Type.String({ description: 'PR number' }),
      merge: Type.Optional(Type.Boolean({ default: false, description: 'Auto-merge only if no findings' })),
    }),
    async execute(_toolCallId, params: Params, _signal, _onUpdate, _ctx): Promise<any> {
      const num = prNumber(params.pr);

      // 1. Trigger
      console.log(`🔍 Triggering CodeRabbit on PR #${num}...`);
      gh(`pr comment ${num} --body "@coderabbitai review"`);

      // 2. Poll
      console.log('⏳ Waiting for CodeRabbit...');
      let deadline = Date.now() + MAX_WAIT_MS;
      let reviewState = '';

      while (Date.now() < deadline) {
        reviewState = gh(`pr view ${num} --json reviews --jq '.reviews[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .state'`);
        if (reviewState) { console.log(`✅ Review complete: ${reviewState.trim()}`); break; }

        const comments = gh(`pr view ${num} --json comments --jq '.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body'`);
        const rateLimit = comments.match(/available in:?\s*(\d+)/);
        if (rateLimit?.[1]) {
          const mins = Number.parseInt(rateLimit[1], 10) + 1;
          console.log(`  ⏳ Rate limited — waiting ${mins} min...`);
          await sleep(mins * 60_000);
          gh(`pr comment ${num} --body "@coderabbitai review"`);
          deadline = Date.now() + MAX_WAIT_MS;
          continue;
        }
        console.log('  ⏳ Polling...');
        await sleep(POLL_INTERVAL);
      }

      if (!reviewState) {
        return { content: [{ type: 'text', text: `Timed out waiting for CodeRabbit on PR #${num}.` }] };
      }

      // 3. Check findings
      const comments = gh(`pr view ${num} --json comments --jq '.comments[] | select(.author.login=="coderabbitai" or .author.login=="coderabbitai[bot]") | .body'`);
      const hasFindings = comments.includes('Actionable comments posted:');

      if (reviewState.includes('CHANGES_REQUESTED')) {
        console.log('⚠️  CodeRabbit requested changes.');
        return { content: [{ type: 'text', text: `CodeRabbit requested changes on PR #${num}. Fetch findings with MCP, fix, re-trigger review.` }] };
      }

      if (hasFindings) {
        console.log('📋 CodeRabbit has findings.');
        if (params.merge) {
          console.log('  Skipping merge — fix findings first.');
        }
        return { content: [{ type: 'text', text: `CodeRabbit found issues on PR #${num}. Use coderabbitai_get_coderabbit_reviews MCP to fetch them, fix with edit, then re-trigger.` }] };
      }

      // 4. No findings — safe to merge
      if (params.merge) {
        console.log('🚀 No findings — merging...');
        const result = gh(`pr merge ${num} --squash --delete-branch`);
        if (result) console.log(`✅ Merged PR #${num}`);
        else console.log('❌ Merge failed.');
      }

      return { content: [{ type: 'text', text: `CodeRabbit done on PR #${num}: ${reviewState.trim()}${hasFindings ? ' (has findings)' : ' (clean)'}.` }] };
    },
  });
}
