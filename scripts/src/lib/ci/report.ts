#!/usr/bin/env bun
// scripts/src/lib/ci/report.ts
//
// CLI that turns a captured `moon ci` log into the PR-facing report:
// inline annotations, a job summary, and the body for the sticky PR comment.
//
// Usage (CI — see .github/workflows/pr-checks.yml):
//   bun run scripts/src/lib/ci/report.ts \
//     --log "$RUNNER_TEMP/moon-ci.log" \
//     --status failure \
//     --annotate \
//     --summary "$GITHUB_STEP_SUMMARY" \
//     --comment "$RUNNER_TEMP/pr-comment.md"
//
// Usage (local — reproduce exactly what the PR will say):
//   bun moon ci --base=origin/main 2>&1 | tee /tmp/moon-ci.log
//   bun run scripts/src/lib/ci/report.ts --log /tmp/moon-ci.log --print
//
// Exit code is always 0: this step reports, it never decides. The workflow
// fails the job off `moon ci`'s own outcome, so a parser bug can never turn a
// green build red (or, worse, a red build green).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCiLog, parseProjectRoots } from './diagnostics.ts';
import { renderReport } from './report_format.ts';

const ROOT = resolve(import.meta.dir, '../../../..');

type Args = {
  log?: string;
  summary?: string;
  comment?: string;
  json?: string;
  status?: string;
  annotate: boolean;
  print: boolean;
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = { annotate: false, print: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case '--annotate':
        args.annotate = true;
        break;
      case '--print':
        args.print = true;
        break;
      case '--log':
      case '--summary':
      case '--comment':
      case '--json':
      case '--status': {
        const value = argv[++index];
        if (value !== undefined) {
          args[arg.slice(2) as 'log' | 'summary' | 'comment' | 'json' | 'status'] = value;
        }
        break;
      }
      default:
        break;
    }
  }
  return args;
};

const args = parseArgs(Bun.argv.slice(2));

if (args.log === undefined || !existsSync(args.log)) {
  console.error(`❌ report: no log to parse (--log ${args.log ?? '<missing>'})`);
  process.exit(0);
}

const workspaceYamlPath = join(ROOT, '.moon/workspace.yml');
const projectRoots = existsSync(workspaceYamlPath)
  ? parseProjectRoots(readFileSync(workspaceYamlPath, 'utf8'))
  : {};

const parsed = parseCiLog({ log: readFileSync(args.log, 'utf8'), projectRoots });

const report = renderReport(parsed, {
  repository: process.env.GITHUB_REPOSITORY,
  serverUrl: process.env.GITHUB_SERVER_URL ?? 'https://github.com',
  // For a pull_request event GITHUB_SHA is the merge commit, which has no
  // browsable blob URL on the PR branch — the head SHA does.
  sha: process.env.PR_HEAD_SHA || process.env.GITHUB_SHA,
  runUrl:
    process.env.GITHUB_REPOSITORY === undefined || process.env.GITHUB_RUN_ID === undefined
      ? undefined
      : `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  failed: args.status !== 'success',
});

if (args.annotate) {
  for (const annotation of report.annotations) {
    console.log(annotation);
  }
}

if (args.summary !== undefined && args.summary !== '') {
  writeFileSync(args.summary, `${report.summary}\n`, { flag: 'a' });
}

// Only worth commenting when there is something to say. A green PR gets its
// existing comment updated (post_pr_comment.ts handles that) but never a new
// one — nobody wants a "✅ passed" comment on every push.
if (args.comment !== undefined && args.comment !== '') {
  writeFileSync(args.comment, `${report.comment}\n`);
}

if (args.json !== undefined && args.json !== '') {
  writeFileSync(args.json, `${JSON.stringify(parsed, null, 2)}\n`);
}

if (args.print) {
  console.log(report.summary);
}

const label = report.errorCount === 1 ? 'error' : 'errors';
console.error(
  `\n📋 PR report: ${report.errorCount} ${label}, ${report.warningCount} warning(s) across ${
    parsed.failedTargets.length
  } failing target(s).`,
);
