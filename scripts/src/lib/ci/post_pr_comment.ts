#!/usr/bin/env bun
// scripts/src/lib/ci/post_pr_comment.ts
//
// Upserts ONE sticky comment on the PR, identified by the hidden
// COMMENT_MARKER that report_format.ts writes into every body. Editing in
// place rather than posting per run is the whole point: a PR that gets ten
// pushes should end with one comment showing the current state, not ten
// stale ones that a reviewer has to date-sort by hand.
//
// Usage:
//   bun run scripts/src/lib/ci/post_pr_comment.ts --body "$RUNNER_TEMP/pr-comment.md"
//
// Environment: GITHUB_TOKEN (needs `pull-requests: write`), GITHUB_REPOSITORY,
// PR_NUMBER. Missing any of them is a no-op, not a failure — a fork PR gets a
// read-only token, and the job summary still carries the full report there.

import { existsSync, readFileSync } from 'node:fs';
import { COMMENT_MARKER } from './report_format.ts';

type Comment = { id: number; body?: string };

const bodyFlag = Bun.argv.indexOf('--body');
const bodyPath = bodyFlag === -1 ? undefined : Bun.argv[bodyFlag + 1];

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;
const apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com';

if (!token || !repository || !prNumber) {
  console.error('ℹ️ post_pr_comment: no token/repository/PR number — skipping comment.');
  process.exit(0);
}
if (bodyPath === undefined || !existsSync(bodyPath)) {
  console.error(`ℹ️ post_pr_comment: no body at ${bodyPath ?? '<missing>'} — skipping comment.`);
  process.exit(0);
}

const body = readFileSync(bodyPath, 'utf8');
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'content-type': 'application/json',
  'x-github-api-version': '2022-11-28',
};

const request = async (url: string, init?: RequestInit): Promise<Response> => {
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    // Never fail the job over a comment. The annotations and job summary are
    // the load-bearing outputs; this one is a convenience.
    console.error(`⚠️ post_pr_comment: ${init?.method ?? 'GET'} ${url} → ${response.status}`);
  }
  return response;
};

const listUrl = `${apiUrl}/repos/${repository}/issues/${prNumber}/comments?per_page=100`;
const existingResponse = await request(listUrl);
const existing = existingResponse.ok ? ((await existingResponse.json()) as Comment[]) : [];
const sticky = existing.find((comment) => comment.body?.includes(COMMENT_MARKER) === true);

if (sticky) {
  await request(`${apiUrl}/repos/${repository}/issues/comments/${sticky.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  });
  console.error(`✅ post_pr_comment: updated comment ${sticky.id}`);
  process.exit(0);
}

// No sticky comment yet. On a green run there is nothing worth creating one
// for — the check mark on the PR already says it.
if (process.env.CHECK_STATUS === 'success') {
  console.error('ℹ️ post_pr_comment: green run and no existing comment — nothing to post.');
  process.exit(0);
}

await request(`${apiUrl}/repos/${repository}/issues/${prNumber}/comments`, {
  method: 'POST',
  body: JSON.stringify({ body }),
});
console.error('✅ post_pr_comment: created sticky comment');
