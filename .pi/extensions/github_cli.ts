// .pi/extensions/github_cli.ts
//
// GitHub CLI integration for pi — PR management, merge, sync.
// Uses `gh` (v2.96+) from nixpkgs. All tools run via lib/gh.ts for
// cancellation safety and consistent timeout handling.
//
// 🔴 For CodeRabbit AI reviews, prefer the `coderabbitai` MCP tools
//   (get_coderabbit_reviews, get_review_details, get_review_comments,
//   resolve_comment) — they provide richer structured data and resolution
//   tracking that gh_pr_comments cannot match.
//
// Registered tools:
//   gh_create_pr            — Create a PR (default base: main)
//   gh_list_prs             — List open PRs
//   gh_summarize_pr         — View + summarize a PR
//   gh_pr_comments          — Fetch PR comments (reviews + timeline) with timestamp cache
//   gh_pr_status            — Show CI checks status for a PR
//   gh_merge_pr             — Merge a PR (default: squash)
//   gh_cancel_pr            — Close a PR without merging
//   gh_edit_pr              — Edit PR title/body/base/labels
//   gh_promote_pr           — Promote a draft PR to "Ready for Review"
//   gh_list_issues          — List GitHub Issues
//   gh_create_issue         — Create a GitHub Issue
//   gh_close_issue          — Close a GitHub Issue
//   gh_reopen_issue         — Reopen a closed Issue
//   gh_edit_issue           — Edit an Issue
//   gh_view_issue           — View full Issue details
//   gh_list_projects        — List GitHub Projects
//   gh_project_view         — View a GitHub Project board
//   gh_project_item_add     — Add an Issue/PR to a Project
//   gh_project_item_mutate  — Mutate a Project v2 item field (e.g. Status)
//   gh_project_item_get     — Get Project v2 item details by content URL
//   gh_workflow_run         — Trigger a workflow_dispatch (e.g. the release deploy)
//   gh_workflow_status      — Recent workflow runs / detailed run status (watch mode)
//   gh_workflow_logs        — Stream workflow run logs (watch until completion)
//   gh_release_list         — List GitHub Releases
//   gh_release_view         — View a Release + its assets (debug artifact uploads)
//   gh_deploy               — Deploy & wait: dispatch + periodic poll + failed logs
//
// Deploy workflow:
//   gh_deploy(mode="staging", platforms=["windows"], wait=true)
//     → dispatches release.yml, polls until the requested platforms finish,
//       auto-fetches failed logs, reports per-platform result + artifacts.
//   Granular: gh_workflow_run → gh_workflow_status(run=<id>, watch=true) →
//            gh_workflow_logs(run=<id>, failedOnly=true)
//
// For git branch management after merge, use `git pull` on the target branch.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

// ── Helpers ─────────────────────────────────────────────────────────────────

import { commitContractContent } from '../../scripts/src/lib/agents/contract_pipeline/contract_sync';
import { PIPELINE_BASE_BRANCH } from '../../scripts/src/lib/agents/contract_pipeline/types';
import { currentBranch, ensureGitHubRepo, resolvePrSelector, runGh } from './lib/gh.ts';
import { defineAction, registerNamespace } from './lib/tool_namespace.ts';

const DEFAULT_BASE = PIPELINE_BASE_BRANCH;

/** Format a byte count for release asset sizes. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '?';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  return `${value.toFixed(1)} ${units[unitIdx]}`;
}

/** Poll until a workflow run reaches a terminal state, or the timeout elapses. */
async function waitForRunCompletion(
  runId: string,
  timeoutSeconds: number,
): Promise<'completed' | 'timeout' | { error: string }> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const result = await runGh(['run', 'view', runId, '--json', 'status'], {
      parseJson: true,
      timeoutMs: 30_000,
    });
    if (!result.success) {
      return { error: result.text };
    }
    const status = String((result.json as Record<string, unknown>)?.status ?? '');
    if (status === 'completed') {
      return 'completed';
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return 'timeout';
}

/** Resolve a run id from a run id or branch name (newest run on that branch). */
async function resolveRunId(
  runOrBranch: string,
  workflow: string,
): Promise<{ runId: string; fromBranch: boolean } | { error: string }> {
  // Bare numeric id → direct
  if (/^\d+$/.test(runOrBranch)) {
    return { runId: runOrBranch, fromBranch: false };
  }
  const result = await runGh(
    [
      'run',
      'list',
      '--workflow',
      workflow,
      '--branch',
      runOrBranch,
      '--limit',
      '1',
      '--json',
      'databaseId',
    ],
    { parseJson: true, timeoutMs: 30_000 },
  );
  const runs =
    result.success && Array.isArray(result.json)
      ? (result.json as Array<Record<string, unknown>>)
      : [];
  const id = runs[0] ? String(runs[0].databaseId ?? '') : '';
  if (!id) {
    return { error: `No runs found for workflow "${workflow}" on branch "${runOrBranch}"` };
  }
  return { runId: id, fromBranch: true };
}

/** Format a single workflow run with per-job + per-step status. */
function formatRunDetail(data: Record<string, unknown>): string {
  const id = String(data.databaseId ?? '?');
  const title = String(data.displayTitle ?? '?');
  const status = String(data.status ?? '?');
  const conclusion = data.conclusion ? String(data.conclusion) : '';
  const url = String(data.url ?? '');
  const branch = String(data.headBranch ?? '?');
  const event = String(data.event ?? '?');

  let statusIcon: string;
  if (status === 'completed') {
    if (conclusion === 'success') {
      statusIcon = '✅';
    } else if (conclusion === 'cancelled') {
      statusIcon = '🚫';
    } else {
      statusIcon = '❌';
    }
  } else {
    statusIcon = '⏳';
  }

  const lines = [
    `${statusIcon} **Run #${id}: ${title}**`,
    `**Status:** ${status}${conclusion ? ` / ${conclusion}` : ''} | **Event:** ${event} | **Branch:** ${branch}`,
  ];
  if (url) {
    lines.push(`**URL:** ${url}`);
  }

  const jobs = Array.isArray(data.jobs) ? (data.jobs as Array<Record<string, unknown>>) : [];
  if (jobs.length > 0) {
    lines.push('', '**Jobs:**');
    for (const job of jobs) {
      const jobName = String(job.name ?? '?');
      const jobStatus = String(job.status ?? '?');
      const jobConclusion = job.conclusion ? String(job.conclusion) : '';
      let jobIcon: string;
      if (jobStatus === 'completed') {
        if (jobConclusion === 'success') {
          jobIcon = '✅';
        } else if (jobConclusion === 'cancelled') {
          jobIcon = '🚫';
        } else {
          jobIcon = '❌';
        }
      } else {
        jobIcon = '⏳';
      }
      lines.push(
        `  ${jobIcon} **${jobName}** — ${jobStatus}${jobConclusion ? ` / ${jobConclusion}` : ''}`,
      );

      const steps = Array.isArray(job.steps) ? (job.steps as Array<Record<string, unknown>>) : [];
      for (const step of steps) {
        const stepName = String(step.name ?? '?');
        const stepStatus = String(step.status ?? '?');
        const stepConclusion = step.conclusion ? String(step.conclusion) : '';
        let stepIcon: string;
        if (stepStatus === 'completed') {
          stepIcon = stepConclusion === 'success' ? '✅' : '❌';
        } else {
          stepIcon = '⏳';
        }
        const num = String(step.number ?? '?');
        lines.push(
          `     ${stepIcon} ${num}. ${stepName}${stepConclusion ? ` — ${stepConclusion}` : ''}`,
        );
      }
    }
  }
  return lines.join('\n');
}

/** Format a list of workflow runs. */
function formatRunList(runs: Array<Record<string, unknown>>): string {
  if (runs.length === 0) {
    return 'No workflow runs found.';
  }
  const lines: string[] = [];
  for (const run of runs) {
    const id = String(run.databaseId ?? '?');
    const title = String(run.displayTitle ?? '?');
    const status = String(run.status ?? '?');
    const conclusion = run.conclusion ? String(run.conclusion) : '';
    const branch = String(run.headBranch ?? '?');
    const event = String(run.event ?? '?');
    let icon: string;
    if (status === 'completed') {
      if (conclusion === 'success') {
        icon = '✅';
      } else if (conclusion === 'cancelled') {
        icon = '🚫';
      } else {
        icon = '❌';
      }
    } else {
      icon = '⏳';
    }
    lines.push(
      `${icon} **#${id}** ${title}`,
      `   ${event} | ${branch} | ${status}${conclusion ? ` / ${conclusion}` : ''}`,
    );
  }
  return lines.join('\n');
}

// ── Deploy-and-wait (periodic fetcher, mirrors code_rabbit.ts) ────────────

/** Sleep that throws when the signal is aborted (user pressed Esc/Ctrl+C). */
const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return Promise.reject(new Error('Aborted'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

/** Normalize a platforms param (array or comma string) to a CSV string. */
const normalizePlatforms = (raw: unknown): string => {
  if (Array.isArray(raw)) {
    return raw.filter((p) => typeof p === 'string').join(',');
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .join(',');
  }
  return '';
};

/**
 * Fetch the newest run ID for a workflow on a given ref.
 * Used to detect post-dispatch runs and avoid picking up stale/pre-existing runs.
 */
async function fetchNewestRunId(workflow: string, ref: string): Promise<string | undefined> {
  const list = await runGh(
    [
      'run',
      'list',
      '--workflow',
      workflow,
      '--branch',
      ref,
      '--limit',
      '1',
      '--json',
      'databaseId',
    ],
    { parseJson: true, timeoutMs: 30_000 },
  );
  const runs =
    list.success && Array.isArray(list.json) ? (list.json as Array<Record<string, unknown>>) : [];
  return runs[0] ? String(runs[0].databaseId ?? '') : undefined;
}

/** Fetch run status + jobs, optionally filtered to the requested platforms. */
async function fetchRunStatus(
  runId: string,
  platforms: string[],
): Promise<
  | { ok: true; status: string; conclusion: string; jobs: Array<Record<string, unknown>> }
  | { ok: false; error: string }
> {
  const result = await runGh(['run', 'view', runId, '--json', 'status,conclusion,jobs'], {
    parseJson: true,
    timeoutMs: 30_000,
  });
  if (!result.success) {
    return { ok: false, error: result.text };
  }
  const data = result.json as Record<string, unknown>;
  let jobs = Array.isArray(data.jobs) ? (data.jobs as Array<Record<string, unknown>>) : [];
  if (platforms.length > 0) {
    jobs = jobs.filter((j) => {
      const name = String(j.name ?? '').toLowerCase();
      return platforms.some((p) => name.includes(p.trim().toLowerCase()));
    });
  }
  return {
    ok: true,
    status: String(data.status ?? ''),
    conclusion: String(data.conclusion ?? ''),
    jobs,
  };
}

/** Fetch artifacts attached to a run (name + size) for the final report. */
async function fetchRunArtifacts(runId: string): Promise<Array<{ name: string; size: number }>> {
  const repoCheck = await ensureGitHubRepo();
  if (!repoCheck.ok || !repoCheck.owner || !repoCheck.repo) {
    return [];
  }
  const result = await runGh(
    ['api', `repos/${repoCheck.owner}/${repoCheck.repo}/actions/runs/${runId}/artifacts`],
    { parseJson: true, timeoutMs: 30_000 },
  );
  const data = result.json as { artifacts?: Array<Record<string, unknown>> } | undefined;
  if (!result.success || !Array.isArray(data?.artifacts)) {
    return [];
  }
  return data.artifacts.map((a) => ({
    name: String(a.name ?? '?'),
    size: Number(a.size_in_bytes ?? 0),
  }));
}

// ── PR Comments Cache ────────────────────────────────────────────────────

const CACHE_DIR = '.pi/github';

type CachedComment = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
};

type CachedReview = {
  id: string;
  body: string;
  author: string;
  state: string;
  submittedAt: string;
};

type PrCommentCache = {
  prNumber: number;
  fetchedAt: string;
  prUpdatedAt: string;
  comments: CachedComment[];
  reviews: CachedReview[];
};

/** Read the cached comments for a PR. */
const readCommentCache = (prNumber: number, cwd: string): PrCommentCache | undefined => {
  const cachePath = join(cwd, CACHE_DIR, `pr-${prNumber}-comments.json`);
  if (!existsSync(cachePath)) {
    return undefined;
  }
  try {
    const raw = readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PrCommentCache>;
    if (typeof parsed.prNumber === 'number' && typeof parsed.fetchedAt === 'string') {
      return parsed as PrCommentCache;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/** Write the comment cache for a PR. */
const writeCommentCache = (cache: PrCommentCache, cwd: string): void => {
  const cachePath = join(cwd, CACHE_DIR, `pr-${cache.prNumber}-comments.json`);
  mkdirSync(join(cwd, CACHE_DIR), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, undefined, 2));
};

/**
 * Fetch PR comments + reviews + inline review comments from GitHub.
 * Uses `gh pr view --json comments,reviews` for timeline comments + review bodies,
 * then ALSO fetches inline review comments via the API for per-line findings.
 */
const fetchPrComments = async (
  prNumber: number,
  cwd: string,
  includeReviews: boolean,
  includeInline: boolean,
): Promise<PrCommentCache> => {
  const jsonFields = includeReviews ? 'comments,reviews,updatedAt' : 'comments,updatedAt';

  const result = await runGh(['pr', 'view', String(prNumber), '--json', jsonFields], {
    parseJson: true,
    cwd,
  });

  if (!result.success || !result.json) {
    throw new Error(`Failed to fetch PR #${prNumber} comments: ${result.text}`);
  }

  const data = result.json as Record<string, unknown>;
  const fetchedAt = new Date().toISOString();
  const prUpdatedAt = String(data.updatedAt ?? fetchedAt);

  const rawComments = Array.isArray(data.comments)
    ? (data.comments as Array<Record<string, unknown>>)
    : [];
  const rawReviews = Array.isArray(data.reviews)
    ? (data.reviews as Array<Record<string, unknown>>)
    : [];

  const comments: CachedComment[] = rawComments.map((c) => ({
    id: String((c as Record<string, unknown>).id ?? ''),
    body: String((c as Record<string, unknown>).body ?? ''),
    author:
      (c as Record<string, unknown>).author &&
      typeof (c as Record<string, unknown>).author === 'object'
        ? String(((c as Record<string, unknown>).author as Record<string, unknown>).login ?? '?')
        : '?',
    createdAt: String((c as Record<string, unknown>).createdAt ?? ''),
    updatedAt: String(
      (c as Record<string, unknown>).updatedAt ?? (c as Record<string, unknown>).createdAt ?? '',
    ),
    url: String((c as Record<string, unknown>).url ?? ''),
  }));

  // Fetch inline review comments (per-line findings from CodeRabbit etc.)
  let inlineComments: CachedComment[] = [];
  if (includeInline) {
    const owner = process.env.GITHUB_REPOSITORY_OWNER ?? '';
    const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
    if (owner && repo) {
      try {
        const inlineResult = await runGh(
          ['api', `repos/${owner}/${repo}/pulls/${prNumber}/comments`, '--paginate'],
          { parseJson: true, cwd, timeoutMs: 30_000 },
        );
        if (inlineResult.success && Array.isArray(inlineResult.json)) {
          inlineComments = (inlineResult.json as Array<Record<string, unknown>>).map((c) => ({
            id: String((c as Record<string, unknown>).id ?? ''),
            body: [
              `📄 \`${String((c as Record<string, unknown>).path ?? '?')}:${(c as Record<string, unknown>).line ?? (c as Record<string, unknown>).original_line ?? '?'}\``,
              '',
              String((c as Record<string, unknown>).body ?? ''),
            ].join('\n'),
            author:
              (c as Record<string, unknown>).user &&
              typeof (c as Record<string, unknown>).user === 'object'
                ? String(
                    ((c as Record<string, unknown>).user as Record<string, unknown>).login ?? '?',
                  )
                : '?',
            createdAt: String((c as Record<string, unknown>).created_at ?? ''),
            updatedAt: String(
              (c as Record<string, unknown>).updated_at ??
                (c as Record<string, unknown>).created_at ??
                '',
            ),
            url: String((c as Record<string, unknown>).html_url ?? ''),
          }));
        }
      } catch {
        // Non-fatal — inline comments are best-effort
      }
    }
  }

  const reviews: CachedReview[] = includeReviews
    ? rawReviews.map((r) => ({
        id: String((r as Record<string, unknown>).id ?? ''),
        body: String((r as Record<string, unknown>).body ?? ''),
        author:
          (r as Record<string, unknown>).author &&
          typeof (r as Record<string, unknown>).author === 'object'
            ? String(
                ((r as Record<string, unknown>).author as Record<string, unknown>).login ?? '?',
              )
            : '?',
        state: String((r as Record<string, unknown>).state ?? ''),
        submittedAt: String((r as Record<string, unknown>).submittedAt ?? ''),
      }))
    : [];

  return { prNumber, fetchedAt, prUpdatedAt, comments: [...comments, ...inlineComments], reviews };
};

/** Format comments + reviews for display. */
const formatPrComments = (
  cache: PrCommentCache,
  since?: string,
): { text: string; newCount: number; editedCount: number } => {
  const lines: string[] = [];
  let newCount = 0;
  let editedCount = 0;

  // Filter if timestamp provided
  const filterComments = since
    ? cache.comments.filter((c) => c.updatedAt > since || c.createdAt > since)
    : cache.comments;
  const filterReviews = since ? cache.reviews.filter((r) => r.submittedAt > since) : cache.reviews;

  // Count new vs edited
  for (const c of filterComments) {
    if (since && c.createdAt > since) {
      newCount++;
    } else if (since && c.updatedAt > since) {
      editedCount++;
    } else {
      newCount++;
    }
  }

  // Header
  const sinceLabel = since ? ` since ${since.slice(0, 19).replace('T', ' ')}` : '';
  lines.push(`## PR #${cache.prNumber} comments${sinceLabel}`);
  lines.push(`**Fetched:** ${cache.fetchedAt.slice(0, 19).replace('T', ' ')}`);
  lines.push(`**New:** ${newCount} comments, ${filterReviews.length} reviews`);
  if (editedCount > 0) {
    lines.push(`**Edited:** ${editedCount} comment(s) updated`);
  }
  lines.push('');

  // Reviews first (most important — CodeRabbit findings)
  if (filterReviews.length > 0) {
    for (const r of filterReviews) {
      lines.push(`---`, `### Review by @${r.author} (${r.state})`, '', r.body);
    }
  }

  // Timeline comments
  if (filterComments.length > 0) {
    lines.push('', '---', '### Timeline comments', '');
    for (const c of filterComments) {
      const created = c.createdAt.slice(0, 19).replace('T', ' ');
      const edited =
        c.updatedAt !== c.createdAt
          ? ` (edited ${c.updatedAt.slice(0, 19).replace('T', ' ')})`
          : '';
      lines.push(`**@${c.author}** — ${created}${edited}`, '', c.body, '');
    }
  }

  if (filterComments.length === 0 && filterReviews.length === 0) {
    lines.push('_No new comments or reviews since last fetch._');
  }

  return { text: lines.join('\n'), newCount, editedCount };
};

// ── Formatters ──────────────────────────────────────────────────────────────

/** Format a list of PRs from gh JSON output. */
function formatPrList(prs: Array<Record<string, unknown>>): string {
  if (prs.length === 0) {
    return 'No pull requests found.';
  }

  const lines: string[] = [];
  for (const pr of prs) {
    const number = String(pr.number ?? '?');
    const title = String(pr.title ?? '');
    const head = String(pr.headRefName ?? '?');
    const base = String(pr.baseRefName ?? '?');
    const state = String(pr.state ?? '?');
    const url = String(pr.url ?? '');
    const author =
      pr.author && typeof pr.author === 'object'
        ? String((pr.author as Record<string, unknown>).login ?? '?')
        : '?';
    const draftIcon = pr.isDraft ? '📝 ' : '';
    let stateIcon: string;
    if (state === 'OPEN') {
      stateIcon = '🟢';
    } else if (state === 'MERGED') {
      stateIcon = '🟣';
    } else {
      stateIcon = '🔴';
    }
    lines.push(
      `${draftIcon}${stateIcon} **#${number}** ${title}`,
      `   ${head} → ${base} | by @${author} | ${url}`,
    );
  }
  return lines.join('\n');
}

/** Format a single PR summary from gh JSON output. */
function formatPrSummary(data: Record<string, unknown>): string {
  const number = String(data.number ?? '?');
  const title = String(data.title ?? '');
  const state = String(data.state ?? '?');
  const url = String(data.url ?? '');
  const head = String(data.headRefName ?? '?');
  const base = String(data.baseRefName ?? '?');
  const author =
    data.author && typeof data.author === 'object'
      ? String((data.author as Record<string, unknown>).login ?? '?')
      : '?';
  const body = String(data.body ?? '').slice(0, 2000);
  const createdAt = String(data.createdAt ?? '?');
  const mergedAt = data.mergedAt ? String(data.mergedAt) : null;
  const closedAt = data.closedAt ? String(data.closedAt) : null;
  const additions = data.additions ?? '?';
  const deletions = data.deletions ?? '?';
  const files = Array.isArray(data.files) ? (data.files as Array<Record<string, unknown>>) : [];
  const labels = Array.isArray(data.labels)
    ? (data.labels as Array<Record<string, unknown>>).map((l) => l.name).join(', ')
    : '';
  const reviews = Array.isArray(data.reviews)
    ? (data.reviews as Array<Record<string, unknown>>)
    : [];
  const comments = Array.isArray(data.comments)
    ? (data.comments as Array<Record<string, unknown>>)
    : [];

  let stateIcon: string;
  if (state === 'OPEN') {
    stateIcon = '🟢';
  } else if (state === 'MERGED') {
    stateIcon = '🟣';
  } else {
    stateIcon = '🔴';
  }
  const lines = [
    `${stateIcon} **#${number}: ${title}**`,
    `**State:** ${state} | **By:** @${author} | **Created:** ${createdAt}`,
    `**Branch:** ${head} → ${base} | **+${additions} −${deletions}**`,
    `**URL:** ${url}`,
  ];

  if (mergedAt) {
    lines.push(`**Merged:** ${mergedAt}`);
  }
  if (closedAt && !mergedAt) {
    lines.push(`**Closed:** ${closedAt}`);
  }
  if (labels) {
    lines.push(`**Labels:** ${labels}`);
  }

  // Reviews — show state + body content
  if (reviews.length > 0) {
    const reviewSummary = reviews
      .map((r) => {
        const rState = String(r.state ?? '?');
        const rAuthor =
          r.author && typeof r.author === 'object'
            ? String((r.author as Record<string, unknown>).login ?? '?')
            : '?';
        return `@${rAuthor}: ${rState}`;
      })
      .join(', ');
    lines.push(`**Reviews:** ${reviewSummary}`);

    for (const r of reviews) {
      const rBody = String(r.body ?? '');
      if (rBody.trim()) {
        const rAuthor =
          r.author && typeof r.author === 'object'
            ? String((r.author as Record<string, unknown>).login ?? '?')
            : '?';
        const truncated = rBody.length > 50000 ? `${rBody.slice(0, 50000)}...` : rBody;
        lines.push('', `---`, `### Review by @${rAuthor}`, '', truncated);
      }
    }
  }

  // Comments
  if (comments.length > 0) {
    lines.push(`**Comments:** ${comments.length}`);
    for (const c of comments) {
      const cBody = String((c as Record<string, unknown>).body ?? '');
      if (cBody.trim()) {
        const cAuthor =
          (c as Record<string, unknown>).author &&
          typeof (c as Record<string, unknown>).author === 'object'
            ? String(
                ((c as Record<string, unknown>).author as Record<string, unknown>).login ?? '?',
              )
            : '?';
        const truncated = cBody.length > 50000 ? `${cBody.slice(0, 50000)}...` : cBody;
        lines.push('', `---`, `**@${cAuthor}:**`, '', truncated);
      }
    }
  }

  // Changed files
  if (files.length > 0) {
    const fileList = files.slice(0, 20).map((f) => {
      const path = String(f.path ?? '?');
      const adds = Number(f.additions ?? 0);
      const dels = Number(f.deletions ?? 0);
      return `  ${path} (+${adds} −${dels})`;
    });
    lines.push(`**Files changed (${files.length}):**`);
    lines.push(...fileList);
    if (files.length > 20) {
      lines.push(`  ... and ${files.length - 20} more`);
    }
  }

  if (body) {
    lines.push('', `**Description:**`, body);
  }

  return lines.join('\n');
}

/** Format CI check status. */
function formatCheckStatus(raw: string): string {
  if (!raw.trim()) {
    return 'No CI checks found for this PR.';
  }

  const lines = raw.split('\n');
  const statusLines: string[] = [];
  let passCount = 0;
  let failCount = 0;
  let pendingCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.includes('pass') || trimmed.includes('✓') || /\bpass\b/i.test(trimmed)) {
      passCount++;
      statusLines.push(`  ✅ ${trimmed}`);
    } else if (trimmed.includes('fail') || trimmed.includes('✗') || /\bfail\b/i.test(trimmed)) {
      failCount++;
      statusLines.push(`  ❌ ${trimmed}`);
    } else if (trimmed.includes('pending') || trimmed.includes('⏳')) {
      pendingCount++;
      statusLines.push(`  ⏳ ${trimmed}`);
    } else {
      statusLines.push(`  ${trimmed}`);
    }
  }

  const summary = `**Checks:** ${passCount} passing, ${failCount} failing, ${pendingCount} pending`;
  return [summary, '', ...statusLines].join('\n');
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  registerNamespace(pi, {
    name: 'gh_pr',
    label: 'GitHub: Pull Requests',
    description: 'Work with GitHub pull requests via the gh CLI.',
    promptSnippet: 'Use gh_pr for all pull request work (create, list, view, status, merge, edit)',
    actions: [
      defineAction({
        action: 'create',
        summary: 'Open a pull request',

        parameters: Type.Object({
          title: Type.String({ description: 'PR title' }),
          body: Type.Optional(Type.String({ description: 'PR description (markdown supported)' })),
          headBranch: Type.String({ description: 'Source branch name (head)' }),
          baseBranch: Type.Optional(
            Type.String({
              default: DEFAULT_BASE,
              description: `Target base branch (default: "${DEFAULT_BASE}")`,
            }),
          ),
          // Default to draft — CI must pass and a human must promote the PR
          // to "Ready for review" before CodeRabbit AI review is triggered.
          draft: Type.Optional(Type.Boolean({ default: true, description: 'Create as draft PR' })),
          web: Type.Optional(
            Type.Boolean({ default: false, description: 'Open PR in browser after creation' }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const repoCheck = await ensureGitHubRepo();
          if (!repoCheck.ok) {
            return {
              content: [{ type: 'text', text: `❌ ${repoCheck.reason}` }],
              isError: true,
              details: {},
            };
          }

          const base = params.baseBranch ?? DEFAULT_BASE;

          // 🔗 Auto-linkage: detect explicit "closes #N" markers or GitHub issue URLs
          let body = params.body ?? '';
          const closesMatch = body.match(/closes:\s*#(\d+)/im);
          const ghIssueMatch = body.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
          const linkedIssue = closesMatch?.[1] ?? ghIssueMatch?.[1];
          if (linkedIssue) {
            const closePrefix = `Closes #${linkedIssue}\n\n`;
            if (!body.startsWith('Closes #')) {
              body = closePrefix + body;
            }
          }

          const args = [
            'pr',
            'create',
            '--title',
            params.title,
            '--head',
            params.headBranch,
            '--base',
            base,
          ];

          if (body) {
            args.push('--body', body);
          }
          if (params.draft) {
            args.push('--draft');
          }
          if (params.web) {
            args.push('--web');
          }

          const result = await runGh(args, { timeoutMs: 60_000 });

          if (!result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: [
                    `❌ Failed to create PR: ${result.text}`,
                    '',
                    `**Details:**`,
                    `  Title: ${params.title}`,
                    `  Branch: ${params.headBranch} → ${base}`,
                  ].join('\n'),
                },
              ],
              isError: true,
              details: { headBranch: params.headBranch, baseBranch: base },
            };
          }

          // Extract the PR URL from the output
          const prUrl = result.text.match(/(https:\/\/github\.com\/[^\s]+)/)?.[1] ?? result.text;
          const prNumber = ((): number | undefined => {
            const match = prUrl.match(/\/pull\/(\d+)/);
            return match ? Number(match[1]) : undefined;
          })();

          // 🔗 Auto-sync: if the PR references a contract (C-XXX), record
          // pr_url/pr_number in the contract's YAML frontmatter.
          //
          // 🔴 Committed straight to `main` via commitContractContent — NEVER
          // written to the checkout. The old implementation did a plain
          // writeFileSync into `<cwd>/docs/contracts/...`, and every role
          // except implementer/verifier runs with cwd = the ROOT checkout (see
          // ContractHerdrAdapter._createWorkerTab). So opening a PR left the
          // human's root checkout dirty on whatever unrelated branch they had
          // checked out — an edit they never asked for, in the middle of their
          // own work, which then had to be stashed or reverted by hand. The
          // contract is main-owned metadata: it belongs on main, on its own
          // commit, exactly like the authoring step already does.
          //
          // Match from the TITLE or the head branch (e.g. contract/C-372,
          // contract-task-c-372-*). The BODY is prose — a PR can mention another
          // contract in its description (e.g. "ran C-372 to reproduce this") and
          // must NOT clobber that contract's pr_url.
          let contractUpdated: string | undefined;
          let contractSyncNote: string | undefined;
          if (prNumber && prUrl) {
            const contractMatch =
              params.title.match(/\b(C-\d+|MIG-\d+)\b/i) ??
              params.headBranch.match(/\b(C-\d+|MIG-\d+)\b/i);
            if (contractMatch?.[1]) {
              const contractId = contractMatch[1].toUpperCase();
              const cwd = _ctx?.cwd ?? process.cwd();
              const contractsDir = join(cwd, 'docs/contracts');
              try {
                if (existsSync(contractsDir)) {
                  // Resolution order matches contract_resolver.ts:
                  // 1. Full-slug files (C-XXX-slug.md)
                  const fullSlugFiles = readdirSync(contractsDir).filter(
                    (f: string) => f.startsWith(`${contractId}-`) && f.endsWith('.md'),
                  );
                  // 2. Placeholder files (C-XXX.md)
                  const placeholderFile = `${contractId}.md`;
                  const placeholderExists = existsSync(join(contractsDir, placeholderFile));

                  let contractPath: string | undefined;
                  if (fullSlugFiles.length === 1 && fullSlugFiles[0]) {
                    contractPath = join(contractsDir, fullSlugFiles[0]);
                  } else if (fullSlugFiles.length === 0 && placeholderExists) {
                    contractPath = join(contractsDir, placeholderFile);
                  }

                  if (contractPath) {
                    const content = readFileSync(contractPath, 'utf-8');
                    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
                    if (yamlMatch?.[1]) {
                      let yaml = yamlMatch[1];
                      // Update pr_url and pr_number — preserve existing indentation
                      const prUrlMatch = yaml.match(/^(\s*)pr_url:\s*.+/m);
                      const indent = prUrlMatch?.[1] ?? '  ';
                      yaml = yaml.replace(/^\s*pr_url:\s*.+/m, `${indent}pr_url: "${prUrl}"`);
                      if (/^\s*pr_number:/m.test(yaml)) {
                        yaml = yaml.replace(
                          /^\s*pr_number:\s*.+/m,
                          `${indent}pr_number: ${prNumber}`,
                        );
                      } else {
                        // Add pr_number after pr_url if missing
                        yaml = yaml.replace(
                          /(^\s*pr_url:\s*.+)/m,
                          `$1\n${indent}pr_number: ${prNumber}`,
                        );
                      }
                      const updated = content.replace(yamlMatch[1], yaml);
                      if (updated !== content) {
                        // Plumbing commit onto main's tip + CAS push. Touches
                        // neither this checkout's working tree nor its index,
                        // so it is safe no matter what branch is checked out
                        // here (root checkout mid-refactor, a linked contract
                        // worktree, anything).
                        const sync = commitContractContent({
                          repoRoot: cwd,
                          contractPath,
                          content: updated,
                          message: `docs(contracts): ${contractId} link PR #${prNumber}`,
                        });
                        if (sync.ok && sync.committed) {
                          contractUpdated = contractPath;
                        } else if (!sync.ok) {
                          contractSyncNote = sync.message;
                        }
                      }
                    }
                  }
                }
              } catch {
                // Non-fatal — contract auto-write is best-effort
              }
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: [
                  `✅ **Pull Request created!**`,
                  `**URL:** ${prUrl}`,
                  `**Title:** ${params.title}`,
                  `**Branch:** ${params.headBranch} → ${base}`,
                  params.draft ? `**Draft:** yes` : '',
                  contractUpdated
                    ? `**Contract:** \`${contractUpdated}\` linked to the PR and pushed to main`
                    : '',
                  contractSyncNote ? `⚠️ **Contract not linked:** ${contractSyncNote}` : '',
                  '',
                  `You can merge this PR with: \`gh_merge_pr("${prUrl}")\``,
                ]
                  .filter(Boolean)
                  .join('\n'),
              },
            ],
            details: {
              prUrl,
              prNumber,
              title: params.title,
              headBranch: params.headBranch,
              baseBranch: base,
              draft: params.draft ?? false,
              contractUpdated: contractUpdated ?? null,
            },
          };
        },
      }),
      defineAction({
        action: 'list',
        summary: 'List PRs, filtered by state/base/author/label',

        parameters: Type.Object({
          state: Type.Optional(
            Type.String({
              enum: ['open', 'closed', 'merged', 'all'],
              default: 'open',
              description: 'Filter by PR state (default: "open")',
            }),
          ),
          base: Type.Optional(
            Type.String({ description: 'Filter by base branch (e.g. "dev", "main")' }),
          ),
          author: Type.Optional(
            Type.String({ description: 'Filter by author GitHub handle (e.g. "@me" for you)' }),
          ),
          label: Type.Optional(Type.String({ description: 'Filter by label' })),
          limit: Type.Optional(
            Type.Number({ default: 20, description: 'Maximum PRs to list (default: 20)' }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const state = params.state ?? 'open';
          const args = [
            'pr',
            'list',
            '--state',
            state,
            '--json',
            'number,title,headRefName,baseRefName,state,url,createdAt,author,isDraft,labels',
            '--limit',
            String(params.limit ?? 20),
          ];

          if (params.base) {
            args.push('--base', params.base);
          }
          if (params.author) {
            args.push('--author', params.author);
          }
          if (params.label) {
            args.push('--label', params.label);
          }

          const result = await runGh(args, { parseJson: true });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to list PRs: ${result.text}` }],
              isError: true,
              details: {},
            };
          }

          const prs = Array.isArray(result.json)
            ? (result.json as Array<Record<string, unknown>>)
            : [];
          const formatted = formatPrList(prs);

          return {
            content: [{ type: 'text', text: formatted }],
            details: {
              count: prs.length,
              state,
              prs: prs.map((p) => ({ number: p.number, title: p.title, url: p.url })),
            },
          };
        },
      }),
      defineAction({
        action: 'view',
        summary: 'Full PR summary: body, reviews, comments, changed files',

        parameters: Type.Object({
          pr: Type.String({
            description: 'PR number (e.g. "42"), URL, or branch name',
          }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const selector = resolvePrSelector(params.pr);
          const result = await runGh(
            [
              'pr',
              'view',
              selector,
              '--json',
              [
                'number',
                'title',
                'body',
                'state',
                'url',
                'headRefName',
                'baseRefName',
                'author',
                'createdAt',
                'mergedAt',
                'closedAt',
                'labels',
                'assignees',
                'reviews',
                'comments',
                'additions',
                'deletions',
                'files',
              ].join(','),
            ],
            { parseJson: true },
          );

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to view PR: ${result.text}` }],
              isError: true,
              details: {},
            };
          }

          const data = result.json as Record<string, unknown>;
          const formatted = formatPrSummary(data);

          return {
            content: [{ type: 'text', text: formatted }],
            details: {
              number: data.number,
              title: data.title,
              state: data.state,
              url: data.url,
            },
          };
        },
      }),
      defineAction({
        action: 'status',
        summary: 'CI check status for a PR',

        parameters: Type.Object({
          pr: Type.String({
            description: 'PR number (e.g. "42"), URL, or branch name',
          }),
          watch: Type.Optional(
            Type.Boolean({
              default: false,
              description: 'Wait for checks to complete (polling mode)',
            }),
          ),
        }),
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
          const selector = resolvePrSelector(params.pr);
          const args = ['pr', 'checks', selector];

          if (params.watch) {
            args.push('--watch');
          }

          const result = await runGh(args, {
            timeoutMs: params.watch ? 600_000 : 60_000,
            signal,
            // gh pr checks exit codes: 0 = all pass, 1 = failures OR "no checks
            // reported", 8 = pending. 1 and 8 are handled below, not errors.
            allowExitCodes: [1, 8],
          });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to check PR status: ${result.text}` }],
              isError: true,
              details: { pr: selector },
            };
          }

          // gh exits 1 with "no checks reported on the '<branch>' branch" when the
          // PR has zero CI checks — a legitimate empty state, not an error.
          if (/no checks reported/i.test(result.text)) {
            return {
              content: [
                {
                  type: 'text',
                  text: `**PR #${selector} Checks**\n\nNo CI checks are configured for this PR.`,
                },
              ],
              details: {
                pr: selector,
                overallPassing: null,
                checkCount: 0,
                note: 'no_checks_reported',
              },
            };
          }

          const formatted = formatCheckStatus(result.text);
          const overallPassing = !formatted.includes('❌');

          return {
            content: [
              {
                type: 'text',
                text: `**PR #${selector} Checks**\n\n${formatted}`,
              },
            ],
            details: { pr: selector, overallPassing },
          };
        },
      }),
      defineAction({
        action: 'merge',
        summary: 'Merge a PR (squash by default, supports auto-merge)',

        parameters: Type.Object({
          pr: Type.String({
            description: 'PR number (e.g. "42"), URL, or branch name',
          }),
          method: Type.Optional(
            Type.String({
              enum: ['squash', 'rebase', 'merge'],
              default: 'squash',
              description: 'Merge method (default: "squash")',
            }),
          ),
          autoMerge: Type.Optional(
            Type.Boolean({
              default: false,
              description: 'Enable auto-merge (wait for CI, then merge automatically)',
            }),
          ),
          deleteBranch: Type.Optional(
            Type.Boolean({
              default: false,
              description: 'Delete the head branch after merge',
            }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const selector = resolvePrSelector(params.pr);
          const method = params.method ?? 'squash';
          const args = ['pr', 'merge', selector, `--${method}`];

          if (params.autoMerge) {
            args.push('--auto');
          }
          if (params.deleteBranch) {
            args.push('--delete-branch');
          }

          const result = await runGh(args, { timeoutMs: 60_000 });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to merge PR: ${result.text}` }],
              isError: true,
              details: { pr: selector, method },
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: [
                  `✅ **PR #${selector} merged successfully!**`,
                  `**Method:** ${method}`,
                  params.autoMerge ? `**Auto-merge:** enabled` : '',
                  '',
                  result.text,
                ]
                  .filter(Boolean)
                  .join('\n'),
              },
            ],
            details: { pr: selector, method, merged: true },
          };
        },
      }),
      defineAction({
        action: 'close',
        summary: 'Close a PR without merging',

        parameters: Type.Object({
          pr: Type.String({
            description: 'PR number (e.g. "42"), URL, or branch name',
          }),
          deleteBranch: Type.Optional(
            Type.Boolean({
              default: false,
              description: 'Delete the remote head branch after closing',
            }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const selector = resolvePrSelector(params.pr);
          const args = ['pr', 'close', selector];

          if (params.deleteBranch) {
            args.push('--delete-branch');
          }

          const result = await runGh(args, { timeoutMs: 30_000 });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to close PR: ${result.text}` }],
              isError: true,
              details: { pr: selector },
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: [
                  `✅ **PR #${selector} closed.**`,
                  params.deleteBranch ? '**Branch:** deleted' : '',
                  '',
                  result.text,
                ]
                  .filter(Boolean)
                  .join('\n'),
              },
            ],
            details: { pr: selector, closed: true },
          };
        },
      }),
      defineAction({
        action: 'edit',
        summary: 'Update PR title, body, base, labels or assignees',

        parameters: Type.Object({
          pr: Type.String({
            description: 'PR number (e.g. "42"), URL, or branch name',
          }),
          title: Type.Optional(Type.String({ description: 'New PR title' })),
          body: Type.Optional(Type.String({ description: 'New PR description (markdown)' })),
          baseBranch: Type.Optional(Type.String({ description: 'New target base branch' })),
          addLabels: Type.Optional(
            Type.Array(Type.String(), {
              description: 'Labels to add (comma-separated or array)',
            }),
          ),
          removeLabels: Type.Optional(
            Type.Array(Type.String(), {
              description: 'Labels to remove (comma-separated or array)',
            }),
          ),
          addAssignees: Type.Optional(
            Type.Array(Type.String(), {
              description: 'GitHub handles to assign',
            }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const selector = resolvePrSelector(params.pr);
          const args = ['pr', 'edit', selector];
          const changes: string[] = [];

          if (params.title) {
            args.push('--title', params.title);
            changes.push(`title → "${params.title}"`);
          }
          if (params.body) {
            args.push('--body', params.body);
            changes.push('body updated');
          }
          if (params.baseBranch) {
            args.push('--base', params.baseBranch);
            changes.push(`base → "${params.baseBranch}"`);
          }
          if (params.addLabels && params.addLabels.length > 0) {
            for (const label of params.addLabels) {
              args.push('--add-label', label);
            }
            changes.push(`added labels: ${params.addLabels.join(', ')}`);
          }
          if (params.removeLabels && params.removeLabels.length > 0) {
            for (const label of params.removeLabels) {
              args.push('--remove-label', label);
            }
            changes.push(`removed labels: ${params.removeLabels.join(', ')}`);
          }
          if (params.addAssignees && params.addAssignees.length > 0) {
            for (const assignee of params.addAssignees) {
              args.push('--add-assignee', assignee);
            }
            changes.push(`assigned: ${params.addAssignees.join(', ')}`);
          }

          if (changes.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: '⚠️ No changes specified. Provide at least one field to update (title, body, baseBranch, addLabels, removeLabels, addAssignees).',
                },
              ],
              details: { pr: selector },
            };
          }

          const result = await runGh(args, { timeoutMs: 30_000 });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to edit PR: ${result.text}` }],
              isError: true,
              details: { pr: selector, changes },
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: [
                  `✅ **PR #${selector} updated.**`,
                  '',
                  '**Changes:**',
                  ...changes.map((c) => `  - ${c}`),
                  '',
                  result.text,
                ].join('\n'),
              },
            ],
            details: { pr: selector, changes },
          };
        },
      }),
      defineAction({
        action: 'ready',
        summary: 'Promote a draft PR to Ready for Review',

        parameters: Type.Object({
          pr: Type.String({
            description: 'PR number (e.g. "42"), URL, or branch name',
          }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const selector = resolvePrSelector(params.pr);

          const result = await runGh(['pr', 'ready', selector], { timeoutMs: 30_000 });

          if (!result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Failed to promote PR #${selector}: ${result.text}`,
                },
              ],
              isError: true,
              details: { pr: selector },
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: [
                  `✅ **PR #${selector} is now Ready for Review!**`,
                  '',
                  'CodeRabbit AI review has been triggered. You can check for review',
                  `comments with: \`gh_pr_comments("${selector}")\``,
                ].join('\n'),
              },
            ],
            details: { pr: selector, promoted: true },
          };
        },
      }),
      defineAction({
        action: 'comments',
        summary: 'Fetch PR review and inline comments (timestamp-cached)',

        parameters: Type.Object({
          pr: Type.String({
            description: 'PR number (e.g. "42"), URL, or branch name',
          }),
          since: Type.Optional(
            Type.String({
              description:
                'ISO 8601 timestamp (e.g. "2026-07-14T23:00:00Z"). Only return comments created/updated after this time. Use the `fetchedAt` value from the previous response.',
            }),
          ),
          force: Type.Optional(
            Type.Boolean({
              default: false,
              description: 'Bypass cache and re-fetch all comments from GitHub.',
            }),
          ),
          includeReviews: Type.Optional(
            Type.Boolean({
              default: true,
              description:
                'Include formal review bodies (CodeRabbit findings). Set false for timeline comments only.',
            }),
          ),
          includeInline: Type.Optional(
            Type.Boolean({
              default: true,
              description:
                'Include per-line review comments from CodeRabbit (fetched via separate API). Default: true.',
            }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const selector = resolvePrSelector(params.pr);
          const prNumber = Number(selector);
          if (Number.isNaN(prNumber)) {
            return {
              content: [
                { type: 'text', text: `❌ Could not resolve PR number from: ${params.pr}` },
              ],
              isError: true,
              details: {},
            };
          }

          const cwd = ctx.cwd ?? process.cwd();
          const includeReviews = params.includeReviews ?? true;
          const includeInline = params.includeInline ?? true;

          // Check cache first (unless forced)
          if (!params.force) {
            const cached = readCommentCache(prNumber, cwd);
            if (cached) {
              const formatted = formatPrComments(cached, params.since);
              return {
                content: [{ type: 'text', text: formatted.text }],
                details: {
                  prNumber,
                  fetchedAt: cached.fetchedAt,
                  newCount: formatted.newCount,
                  editedCount: formatted.editedCount,
                  fromCache: true,
                },
              };
            }
          }

          // Fetch from GitHub
          try {
            const cache = await fetchPrComments(prNumber, cwd, includeReviews, includeInline);
            writeCommentCache(cache, cwd);

            const formatted = formatPrComments(cache, params.since);
            return {
              content: [{ type: 'text', text: formatted.text }],
              details: {
                prNumber,
                fetchedAt: cache.fetchedAt,
                prUpdatedAt: cache.prUpdatedAt,
                newCount: formatted.newCount,
                editedCount: formatted.editedCount,
                fromCache: false,
              },
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Failed to fetch PR comments: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
              details: {},
            };
          }
        },
      }),
    ],
  });

  registerNamespace(pi, {
    name: 'gh_issue',
    label: 'GitHub: Issues',
    description: 'Work with GitHub issues via the gh CLI.',
    actions: [
      defineAction({
        action: 'list',
        summary: 'List issues, filtered by state/label/assignee/milestone',

        parameters: Type.Object({
          state: Type.Optional(
            Type.String({
              enum: ['open', 'closed', 'all'],
              default: 'open',
              description: 'Filter by issue state (default: "open")',
            }),
          ),
          labels: Type.Optional(
            Type.Array(Type.String(), {
              description: 'Filter by labels (comma-separated)',
            }),
          ),
          assignee: Type.Optional(
            Type.String({ description: 'Filter by assignee (e.g. "@me" for you)' }),
          ),
          milestone: Type.Optional(Type.String({ description: 'Filter by milestone title' })),
          limit: Type.Optional(
            Type.Number({ default: 20, description: 'Maximum issues to list (default: 20)' }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const args = [
            'issue',
            'list',
            '--state',
            params.state ?? 'open',
            '--json',
            'number,title,state,url,labels,assignees,milestone,createdAt',
            '--limit',
            String(params.limit ?? 20),
          ];

          if (params.assignee) {
            args.push('--assignee', params.assignee);
          }
          if (params.milestone) {
            args.push('--milestone', params.milestone);
          }
          if (params.labels) {
            for (const label of params.labels) {
              args.push('--label', label);
            }
          }

          const result = await runGh(args, { parseJson: true });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to list issues: ${result.text}` }],
              isError: true,
              details: {},
            };
          }

          const issues = Array.isArray(result.json)
            ? (result.json as Array<Record<string, unknown>>)
            : [];
          if (issues.length === 0) {
            return {
              content: [{ type: 'text', text: 'No issues found.' }],
              details: { count: 0 },
            };
          }

          const lines: string[] = [];
          for (const issue of issues) {
            const num = String(issue.number ?? '?');
            const title = String(issue.title ?? '');
            const state = String(issue.state ?? '?');
            const url = String(issue.url ?? '');
            const issueLabels = Array.isArray(issue.labels)
              ? (issue.labels as Array<Record<string, unknown>>).map((l) => l.name).join(', ')
              : '';
            const issueAssignees = Array.isArray(issue.assignees)
              ? (issue.assignees as Array<Record<string, unknown>>).map((a) => a.login).join(', ')
              : '';
            const milestoneTitle =
              issue.milestone && typeof issue.milestone === 'object'
                ? String((issue.milestone as Record<string, unknown>).title ?? '')
                : '';

            const stateIcon = state === 'OPEN' ? '🟢' : '🔴';
            const meta: string[] = [];
            if (issueLabels) {
              meta.push(`labels: ${issueLabels}`);
            }
            if (issueAssignees) {
              meta.push(`@${issueAssignees}`);
            }
            if (milestoneTitle) {
              meta.push(`🎯 ${milestoneTitle}`);
            }

            lines.push(`${stateIcon} **#${num}** ${title}`);
            if (meta.length > 0) {
              lines.push(`   ${meta.join(' | ')}`);
            }
            lines.push(`   ${url}`);
          }

          return {
            content: [{ type: 'text', text: lines.join('\n') }],
            details: { count: issues.length, state: params.state },
          };
        },
      }),
      defineAction({
        action: 'create',
        summary: 'Create an issue',

        parameters: Type.Object({
          title: Type.String({ description: 'Issue title' }),
          body: Type.Optional(Type.String({ description: 'Issue body (markdown supported)' })),
          labels: Type.Optional(Type.Array(Type.String(), { description: 'Labels to apply' })),
          assignees: Type.Optional(
            Type.Array(Type.String(), { description: 'GitHub handles to assign' }),
          ),
          milestone: Type.Optional(Type.String({ description: 'Milestone title' })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const args = ['issue', 'create', '--title', params.title];
          if (params.body) {
            args.push('--body', params.body);
          }
          if (params.labels) {
            for (const label of params.labels) {
              args.push('--label', label);
            }
          }
          if (params.assignees) {
            for (const assignee of params.assignees) {
              args.push('--assignee', assignee);
            }
          }
          if (params.milestone) {
            args.push('--milestone', params.milestone);
          }

          const result = await runGh(args, { timeoutMs: 30_000 });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to create issue: ${result.text}` }],
              isError: true,
              details: {},
            };
          }

          const issueUrl = result.text.match(/(https:\/\/github\.com\/[^\s]+)/)?.[1] ?? result.text;

          return {
            content: [
              {
                type: 'text',
                text: `✅ **Issue created:** ${issueUrl}\n\n**Title:** ${params.title}`,
              },
            ],
            details: { issueUrl, title: params.title },
          };
        },
      }),
      defineAction({
        action: 'close',
        summary: 'Close an issue, optionally with a comment',

        parameters: Type.Object({
          issue: Type.String({ description: 'Issue number (e.g. "42") or URL' }),
          reason: Type.Optional(
            Type.String({
              enum: ['completed', 'not planned'],
              description: 'Reason for closing (default: "completed")',
            }),
          ),
          comment: Type.Optional(Type.String({ description: 'Closing comment' })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const num = resolvePrSelector(params.issue);
          const args = ['issue', 'close', num];
          if (params.reason) {
            args.push('--reason', params.reason);
          }

          const result = await runGh(args, { timeoutMs: 30_000 });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to close issue: ${result.text}` }],
              isError: true,
              details: {},
            };
          }

          // Add comment if provided
          if (params.comment) {
            await runGh(['issue', 'comment', num, '--body', params.comment], { timeoutMs: 30_000 });
          }

          return {
            content: [
              {
                type: 'text',
                text: `✅ **Issue #${num} closed.**${params.comment ? ' Comment added.' : ''}`,
              },
            ],
            details: { issue: num, closed: true },
          };
        },
      }),
      defineAction({
        action: 'reopen',
        summary: 'Reopen a closed issue',

        parameters: Type.Object({
          issue: Type.String({ description: 'Issue number (e.g. "42") or URL' }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const num = resolvePrSelector(params.issue);
          const result = await runGh(['issue', 'reopen', num], { timeoutMs: 30_000 });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to reopen issue: ${result.text}` }],
              isError: true,
              details: {},
            };
          }

          return {
            content: [{ type: 'text', text: `✅ **Issue #${num} reopened.**` }],
            details: { issue: num, reopened: true },
          };
        },
      }),
      defineAction({
        action: 'edit',
        summary: 'Update issue title, body, labels, assignees or milestone',

        parameters: Type.Object({
          issue: Type.String({ description: 'Issue number (e.g. "42") or URL' }),
          title: Type.Optional(Type.String({ description: 'New title' })),
          body: Type.Optional(Type.String({ description: 'New body (markdown)' })),
          addLabels: Type.Optional(Type.Array(Type.String(), { description: 'Labels to add' })),
          removeLabels: Type.Optional(
            Type.Array(Type.String(), { description: 'Labels to remove' }),
          ),
          addAssignees: Type.Optional(
            Type.Array(Type.String(), { description: 'Handles to assign' }),
          ),
          milestone: Type.Optional(Type.String({ description: 'Milestone title' })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const num = resolvePrSelector(params.issue);
          const args = ['issue', 'edit', num];
          const changes: string[] = [];

          if (params.title) {
            args.push('--title', params.title);
            changes.push(`title → "${params.title}"`);
          }
          if (params.body) {
            args.push('--body', params.body);
            changes.push('body updated');
          }
          if (params.milestone) {
            args.push('--milestone', params.milestone);
            changes.push(`milestone → ${params.milestone}`);
          }
          if (params.addLabels) {
            for (const l of params.addLabels) {
              args.push('--add-label', l);
            }
            changes.push(`added labels: ${params.addLabels.join(', ')}`);
          }
          if (params.removeLabels) {
            for (const l of params.removeLabels) {
              args.push('--remove-label', l);
            }
            changes.push(`removed labels: ${params.removeLabels.join(', ')}`);
          }
          if (params.addAssignees) {
            for (const a of params.addAssignees) {
              args.push('--add-assignee', a);
            }
            changes.push(`assigned: ${params.addAssignees.join(', ')}`);
          }

          if (changes.length === 0) {
            return {
              content: [{ type: 'text', text: '⚠️ No changes specified.' }],
              details: { issue: num },
            };
          }

          const result = await runGh(args, { timeoutMs: 30_000 });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to edit issue: ${result.text}` }],
              isError: true,
              details: { issue: num },
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: [`✅ **Issue #${num} updated.**`, '', ...changes.map((c) => `  - ${c}`)].join(
                  '\n',
                ),
              },
            ],
            details: { issue: num, changes },
          };
        },
      }),
      defineAction({
        action: 'view',
        summary: 'Full issue details including comments',

        parameters: Type.Object({
          issue: Type.String({ description: 'Issue number (e.g. "42") or URL' }),
          comments: Type.Optional(
            Type.Boolean({ default: false, description: 'Include comments' }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const num = resolvePrSelector(params.issue);
          const jsonFields = [
            'number',
            'title',
            'body',
            'state',
            'url',
            'createdAt',
            'updatedAt',
            'labels',
            'assignees',
            'milestone',
            'comments',
          ];
          const args = ['issue', 'view', num, '--json', jsonFields.join(',')];
          if (params.comments) {
            args.push('--comments');
          }

          const result = await runGh(args, { parseJson: true });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to view issue: ${result.text}` }],
              isError: true,
              details: {},
            };
          }

          const data = result.json as Record<string, unknown>;
          const number = String(data.number ?? '?');
          const title = String(data.title ?? '');
          const state = String(data.state ?? '?');
          const url = String(data.url ?? '');
          const body = String(data.body ?? '').slice(0, 3000);
          const createdAt = String(data.createdAt ?? '?');
          const issueLabels = Array.isArray(data.labels)
            ? (data.labels as Array<Record<string, unknown>>).map((l) => l.name).join(', ')
            : '';
          const issueAssignees = Array.isArray(data.assignees)
            ? (data.assignees as Array<Record<string, unknown>>).map((a) => a.login).join(', ')
            : '';
          const milestoneTitle =
            data.milestone && typeof data.milestone === 'object'
              ? String((data.milestone as Record<string, unknown>).title ?? '')
              : '';

          const stateIcon = state === 'OPEN' ? '🟢' : '🔴';
          const lines = [
            `${stateIcon} **#${number}: ${title}**`,
            `**State:** ${state} | **Created:** ${createdAt}`,
            `**URL:** ${url}`,
          ];
          if (issueLabels) {
            lines.push(`**Labels:** ${issueLabels}`);
          }
          if (issueAssignees) {
            lines.push(`**Assignees:** @${issueAssignees}`);
          }
          if (milestoneTitle) {
            lines.push(`**Milestone:** 🎯 ${milestoneTitle}`);
          }
          if (body) {
            lines.push('', '**Description:**', body);
          }

          return {
            content: [{ type: 'text', text: lines.join('\n') }],
            details: { number, title, state, url },
          };
        },
      }),
    ],
  });

  registerNamespace(pi, {
    name: 'gh_project',
    label: 'GitHub: Projects',
    description: 'Work with GitHub Projects v2 (roadmap boards) via the gh CLI and GraphQL API.',
    actions: [
      defineAction({
        action: 'list',
        summary: 'List Projects for an org or user',

        parameters: Type.Object({
          owner: Type.Optional(
            Type.String({ description: 'Org or user handle (default: repo owner)' }),
          ),
          closed: Type.Optional(
            Type.Boolean({ default: false, description: 'Include closed projects' }),
          ),
          limit: Type.Optional(
            Type.Number({ default: 20, description: 'Max results (default: 20)' }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          let owner = params.owner;
          if (!owner) {
            const repoCheck = await ensureGitHubRepo();
            if (!repoCheck.ok) {
              return {
                content: [{ type: 'text', text: `❌ ${repoCheck.reason} — pass owner parameter.` }],
                isError: true,
                details: {},
              };
            }
            owner = repoCheck.owner;
          }

          const projectOwner = owner ?? '';
          if (!projectOwner) {
            return {
              content: [
                {
                  type: 'text',
                  text: '❌ Could not determine project owner. Pass owner parameter.',
                },
              ],
              isError: true,
              details: {},
            };
          }

          const args = [
            'project',
            'list',
            '--owner',
            projectOwner,
            '--format',
            'json',
            '--limit',
            String(params.limit ?? 20),
          ];
          if (params.closed) {
            args.push('--closed');
          }

          const result = await runGh(args, { parseJson: true, timeoutMs: 30_000 });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to list projects: ${result.text}` }],
              isError: true,
              details: {},
            };
          }

          const resultAny = result.json as { projects?: Array<Record<string, unknown>> };
          const projects = resultAny?.projects ?? [];
          if (projects.length === 0) {
            return {
              content: [{ type: 'text', text: `No projects found for @${owner}.` }],
              details: { owner, count: 0 },
            };
          }

          const lines: string[] = [];
          for (const p of projects) {
            const num = String(p.number ?? '?');
            const title = String(p.title ?? '');
            const url = String(p.url ?? '');
            const closed = p.closed;
            const icon = closed ? '🔴' : '🟢';
            lines.push(`${icon} **#${num}** ${title}`);
            lines.push(`   ${url}`);
          }

          return {
            content: [{ type: 'text', text: lines.join('\n') }],
            details: { owner, count: projects.length },
          };
        },
      }),
      defineAction({
        action: 'view',
        summary: 'View a Project with its fields and items',

        parameters: Type.Object({
          project: Type.String({ description: 'Project number (e.g. "1")' }),
          owner: Type.Optional(
            Type.String({ description: 'Org or user handle (default: repo owner)' }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          let owner = params.owner;
          if (!owner) {
            const repoCheck = await ensureGitHubRepo();
            if (!repoCheck.ok) {
              return {
                content: [{ type: 'text', text: `❌ ${repoCheck.reason}` }],
                isError: true,
                details: {},
              };
            }
            owner = repoCheck.owner;
          }

          const projectOwner = owner ?? '';
          if (!projectOwner) {
            return {
              content: [
                {
                  type: 'text',
                  text: '❌ Could not determine project owner. Pass owner parameter.',
                },
              ],
              isError: true,
              details: {},
            };
          }

          // Use --format json for machine-readable output
          const args = [
            'project',
            'view',
            params.project,
            '--owner',
            projectOwner,
            '--format',
            'json',
          ];
          const result = await runGh(args, { parseJson: true, timeoutMs: 30_000 });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to view project: ${result.text}` }],
              isError: true,
              details: {},
            };
          }

          const data = result.json as Record<string, unknown>;
          const title = String(data.title ?? '?');
          const num = String(data.number ?? '?');
          const url = String(data.url ?? '');
          const description = String(data.shortDescription ?? '');
          const closed = !!data.closed;
          const fields = Array.isArray(data.fields)
            ? (data.fields as Array<Record<string, unknown>>)
            : [];
          const items = Array.isArray(data.items)
            ? (data.items as Array<Record<string, unknown>>)
            : [];

          const icon = closed ? '🔴' : '🟢';
          const lines = [`${icon} **#${num}: ${title}**`, `**URL:** ${url}`];
          if (description) {
            lines.push(`**Description:** ${description}`);
          }

          if (fields.length > 0) {
            lines.push('', '**Custom fields:**');
            for (const f of fields) {
              const fName = String(f.name ?? '?');
              const fType = String(f.type ?? '?');
              lines.push(`  - ${fName} (${fType})`);
            }
          }

          if (items.length > 0) {
            lines.push('', `**Items (${items.length}):**`);
            for (const item of items.slice(0, 30)) {
              const itemTitle = String(
                (item.content as Record<string, unknown>)?.title ?? item.title ?? '?',
              );
              const itemType = String(
                (item.content as Record<string, unknown>)?.type ?? item.type ?? '?',
              );
              const status = item.status
                ? String((item.status as Record<string, unknown>)?.name ?? '')
                : '';
              const statusStr = status ? ` [${status}]` : '';
              lines.push(`  - ${itemType}: ${itemTitle}${statusStr}`);
            }
            if (items.length > 30) {
              lines.push(`  ... and ${items.length - 30} more`);
            }
          }

          return {
            content: [{ type: 'text', text: lines.join('\n') }],
            details: { number: num, title, url, itemCount: items.length },
          };
        },
      }),
      defineAction({
        action: 'item_add',
        summary: 'Add an issue or PR to a Project',

        parameters: Type.Object({
          project: Type.String({ description: 'Project number (e.g. "1")' }),
          url: Type.String({ description: 'Issue or PR URL to add' }),
          owner: Type.Optional(
            Type.String({ description: 'Org or user handle (default: repo owner)' }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          let owner = params.owner;
          if (!owner) {
            const repoCheck = await ensureGitHubRepo();
            if (!repoCheck.ok) {
              return {
                content: [{ type: 'text', text: `❌ ${repoCheck.reason}` }],
                isError: true,
                details: {},
              };
            }
            owner = repoCheck.owner;
          }

          const projectOwner = owner ?? '';
          if (!projectOwner) {
            return {
              content: [
                {
                  type: 'text',
                  text: '❌ Could not determine project owner. Pass owner parameter.',
                },
              ],
              isError: true,
              details: {},
            };
          }

          const args = [
            'project',
            'item-add',
            params.project,
            '--owner',
            projectOwner,
            '--url',
            params.url,
          ];

          const result = await runGh(args, { timeoutMs: 30_000 });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to add item to project: ${result.text}` }],
              isError: true,
              details: {},
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: `✅ **Added to project #${params.project}**: ${params.url}`,
              },
            ],
            details: { project: params.project, url: params.url },
          };
        },
      }),
      defineAction({
        action: 'item_set',
        summary: 'Set a Project item field value, e.g. its Status column',

        parameters: Type.Object({
          project: Type.String({ description: 'Project number (e.g. "1")' }),
          url: Type.Optional(
            Type.String({ description: 'Issue or PR URL linked to the project item' }),
          ),
          itemId: Type.Optional(
            Type.String({
              description: 'Project item node ID (from GraphQL). Alternative to url.',
            }),
          ),
          fieldName: Type.Optional(
            Type.String({
              default: 'Status',
              description: 'Field name to mutate (default: "Status")',
            }),
          ),
          value: Type.String({
            description: 'New value for the field (e.g. "In Progress", "Done")',
          }),
          owner: Type.Optional(
            Type.String({ description: 'Org or user handle (default: repo owner)' }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          let owner = params.owner;
          if (!owner) {
            const repoCheck = await ensureGitHubRepo();
            if (!repoCheck.ok) {
              return {
                content: [{ type: 'text', text: `❌ ${repoCheck.reason}` }],
                isError: true,
                details: {},
              };
            }
            owner = repoCheck.owner;
          }

          const projectOwner = owner ?? '';
          if (!projectOwner) {
            return {
              content: [
                {
                  type: 'text',
                  text: '❌ Could not determine project owner. Pass owner parameter.',
                },
              ],
              isError: true,
              details: {},
            };
          }

          const fieldName = params.fieldName ?? 'Status';
          const projectNum = Number(params.project);

          // Step 1: Fetch project metadata to get project node ID and field options
          // Try organization first, fall back to user
          const orgQuery = `
            query($owner: String!, $number: Int!) {
              organization(login: $owner) {
                projectV2(number: $number) {
                  id
                  fields(first: 50) {
                    nodes {
                      ... on ProjectV2SingleSelectField {
                        id
                        name
                        options {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          `;

          const userQuery = `
            query($owner: String!, $number: Int!) {
              user(login: $owner) {
                projectV2(number: $number) {
                  id
                  fields(first: 50) {
                    nodes {
                      ... on ProjectV2SingleSelectField {
                        id
                        name
                        options {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          `;

          let projectData: { projectId: string; fieldId: string; optionId: string };
          try {
            // Try organization first
            let result = await runGh(
              [
                'api',
                'graphql',
                '-f',
                `query=${orgQuery}`,
                '-F',
                `owner=${projectOwner}`,
                '-F',
                `number=${projectNum}`,
              ],
              { parseJson: true },
            );

            // If organization fails, fall back to user
            if (
              !result.success ||
              !result.json ||
              !(result.json as any).data?.organization?.projectV2
            ) {
              result = await runGh(
                [
                  'api',
                  'graphql',
                  '-f',
                  `query=${userQuery}`,
                  '-F',
                  `owner=${projectOwner}`,
                  '-F',
                  `number=${projectNum}`,
                ],
                { parseJson: true },
              );
            }

            if (!result.success || !result.json) {
              return {
                content: [{ type: 'text', text: `❌ Failed to fetch project: ${result.text}` }],
                isError: true,
                details: {},
              };
            }

            const data = result.json as {
              data?: {
                organization?: {
                  projectV2?: {
                    id: string;
                    fields: {
                      nodes: Array<{
                        id: string;
                        name: string;
                        options: Array<{ id: string; name: string }>;
                      }>;
                    };
                  };
                };
                user?: {
                  projectV2?: {
                    id: string;
                    fields: {
                      nodes: Array<{
                        id: string;
                        name: string;
                        options: Array<{ id: string; name: string }>;
                      }>;
                    };
                  };
                };
              };
            };
            const pv2 = data.data?.organization?.projectV2 ?? data.data?.user?.projectV2;
            if (!pv2) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `❌ Project #${projectNum} not found for @${projectOwner}`,
                  },
                ],
                isError: true,
                details: {},
              };
            }

            const field = pv2.fields?.nodes?.find((f) => f.name === fieldName);
            if (!field) {
              const available = (pv2.fields?.nodes ?? []).map((f) => f.name).join(', ');
              return {
                content: [
                  {
                    type: 'text',
                    text: `❌ Field "${fieldName}" not found. Available: ${available}`,
                  },
                ],
                isError: true,
                details: {},
              };
            }

            const option = field.options?.find((o) => o.name === params.value);
            if (!option) {
              const available = (field.options ?? []).map((o) => o.name).join(', ');
              return {
                content: [
                  {
                    type: 'text',
                    text: `❌ Option "${params.value}" not found for field "${fieldName}". Available: ${available}`,
                  },
                ],
                isError: true,
                details: {},
              };
            }

            projectData = {
              projectId: pv2.id,
              fieldId: field.id,
              optionId: option.id,
            };
          } catch (err) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Failed to resolve project metadata: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
              details: {},
            };
          }

          // Step 2: Find the project item by URL or item ID
          let itemId = params.itemId;
          if (!itemId && params.url) {
            try {
              // Try organization first, fall back to user, with pagination
              const itemOrgQuery = `
                query($owner: String!, $number: Int!, $cursor: String) {
                  organization(login: $owner) {
                    projectV2(number: $number) {
                      items(first: 100, after: $cursor) {
                        pageInfo {
                          hasNextPage
                          endCursor
                        }
                        nodes {
                          id
                          content {
                            ... on Issue { url }
                            ... on PullRequest { url }
                          }
                        }
                      }
                    }
                  }
                }
              `;
              const itemUserQuery = `
                query($owner: String!, $number: Int!, $cursor: String) {
                  user(login: $owner) {
                    projectV2(number: $number) {
                      items(first: 100, after: $cursor) {
                        pageInfo {
                          hasNextPage
                          endCursor
                        }
                        nodes {
                          id
                          content {
                            ... on Issue { url }
                            ... on PullRequest { url }
                          }
                        }
                      }
                    }
                  }
                }
              `;

              const allNodes: Array<{ id: string; content: { url?: string } }> = [];
              let cursor: string | null = null;
              let hasNextPage = true;

              // Try organization first
              while (hasNextPage && !itemId) {
                const args = [
                  'api',
                  'graphql',
                  '-f',
                  `query=${itemOrgQuery}`,
                  '-F',
                  `owner=${projectOwner}`,
                  '-F',
                  `number=${projectNum}`,
                ];
                if (cursor) {
                  args.push('-f', `cursor=${cursor}`);
                }

                const itemResult = await runGh(args, { parseJson: true });
                const itemData = itemResult.json as {
                  data?: {
                    organization?: {
                      projectV2?: {
                        items: {
                          pageInfo: { hasNextPage: boolean; endCursor: string | null };
                          nodes: Array<{ id: string; content: { url?: string } }>;
                        };
                      };
                    };
                  };
                };

                const items = itemData.data?.organization?.projectV2?.items;
                if (!items && cursor === null) {
                  // Organization failed on first page, try user instead
                  break;
                }
                if (!items) {
                  hasNextPage = false;
                  break;
                }

                allNodes.push(...items.nodes);
                const match = items.nodes.find((n) => n.content?.url === params.url);
                if (match) {
                  itemId = match.id;
                  break;
                }

                hasNextPage = items.pageInfo.hasNextPage;
                cursor = items.pageInfo.endCursor;
              }

              // If organization didn't work or item not found, try user
              if (!itemId) {
                cursor = null;
                hasNextPage = true;
                while (hasNextPage && !itemId) {
                  const args = [
                    'api',
                    'graphql',
                    '-f',
                    `query=${itemUserQuery}`,
                    '-F',
                    `owner=${projectOwner}`,
                    '-F',
                    `number=${projectNum}`,
                  ];
                  if (cursor) {
                    args.push('-f', `cursor=${cursor}`);
                  }

                  const itemResult = await runGh(args, { parseJson: true });
                  const itemData = itemResult.json as {
                    data?: {
                      user?: {
                        projectV2?: {
                          items: {
                            pageInfo: { hasNextPage: boolean; endCursor: string | null };
                            nodes: Array<{ id: string; content: { url?: string } }>;
                          };
                        };
                      };
                    };
                  };

                  const items = itemData.data?.user?.projectV2?.items;
                  if (!items) {
                    hasNextPage = false;
                    break;
                  }

                  allNodes.push(...items.nodes);
                  const match = items.nodes.find((n) => n.content?.url === params.url);
                  if (match) {
                    itemId = match.id;
                    break;
                  }

                  hasNextPage = items.pageInfo.hasNextPage;
                  cursor = items.pageInfo.endCursor;
                }
              }
            } catch {
              // will report error below
            }
          }

          if (!itemId) {
            return {
              content: [
                {
                  type: 'text',
                  text: '❌ Could not find the project item. Provide either `url` (issue/PR URL) or `itemId` (project item node ID).',
                },
              ],
              isError: true,
              details: {},
            };
          }

          // Step 3: Mutate the field value
          const mutation = `
            mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
              updateProjectV2ItemFieldValue(input: {
                projectId: $projectId
                itemId: $itemId
                fieldId: $fieldId
                value: { singleSelectOptionId: $optionId }
              }) {
                clientMutationId
              }
            }
          `;

          try {
            const mutResult = await runGh(
              [
                'api',
                'graphql',
                '-f',
                `query=${mutation}`,
                '-f',
                `projectId=${projectData.projectId}`,
                '-f',
                `itemId=${itemId}`,
                '-f',
                `fieldId=${projectData.fieldId}`,
                '-f',
                `optionId=${projectData.optionId}`,
              ],
              { parseJson: true },
            );

            if (!mutResult.success) {
              return {
                content: [{ type: 'text', text: `❌ Mutation failed: ${mutResult.text}` }],
                isError: true,
                details: {},
              };
            }

            return {
              content: [
                {
                  type: 'text',
                  text: `✅ **Project #${projectNum} item updated:** \`${fieldName}\` → "${params.value}"`,
                },
              ],
              details: { project: projectNum, fieldName, value: params.value, updated: true },
            };
          } catch (err) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Failed to mutate project item: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
              details: {},
            };
          }
        },
      }),
      defineAction({
        action: 'item_get',
        summary: 'Look up a Project item by its issue/PR URL',

        parameters: Type.Object({
          project: Type.String({ description: 'Project number (e.g. "1")' }),
          url: Type.String({ description: 'Issue or PR URL to find in the project' }),
          owner: Type.Optional(
            Type.String({ description: 'Org or user handle (default: repo owner)' }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          let owner = params.owner;
          if (!owner) {
            const repoCheck = await ensureGitHubRepo();
            if (!repoCheck.ok) {
              return {
                content: [{ type: 'text', text: `❌ ${repoCheck.reason}` }],
                isError: true,
                details: {},
              };
            }
            owner = repoCheck.owner;
          }

          const projectOwner = owner ?? '';
          if (!projectOwner) {
            return {
              content: [
                {
                  type: 'text',
                  text: '❌ Could not determine project owner. Pass owner parameter.',
                },
              ],
              isError: true,
              details: {},
            };
          }

          const projectNum = Number(params.project);

          // Try organization first, fall back to user, with pagination
          const orgQuery = `
            query($owner: String!, $number: Int!, $cursor: String) {
              organization(login: $owner) {
                projectV2(number: $number) {
                  id
                  title
                  items(first: 100, after: $cursor) {
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                    nodes {
                      id
                      content {
                        ... on Issue {
                          number
                          title
                          url
                          state
                        }
                        ... on PullRequest {
                          number
                          title
                          url
                          state
                        }
                      }
                      fieldValues(first: 20) {
                        nodes {
                          ... on ProjectV2ItemFieldSingleSelectValue {
                            name
                            field { ... on ProjectV2Field { name } }
                          }
                          ... on ProjectV2ItemFieldTextValue {
                            text
                            field { ... on ProjectV2Field { name } }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `;

          const userQuery = `
            query($owner: String!, $number: Int!, $cursor: String) {
              user(login: $owner) {
                projectV2(number: $number) {
                  id
                  title
                  items(first: 100, after: $cursor) {
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                    nodes {
                      id
                      content {
                        ... on Issue {
                          number
                          title
                          url
                          state
                        }
                        ... on PullRequest {
                          number
                          title
                          url
                          state
                        }
                      }
                      fieldValues(first: 20) {
                        nodes {
                          ... on ProjectV2ItemFieldSingleSelectValue {
                            name
                            field { ... on ProjectV2Field { name } }
                          }
                          ... on ProjectV2ItemFieldTextValue {
                            text
                            field { ... on ProjectV2Field { name } }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `;

          try {
            type ProjectItemNode = {
              id: string;
              content: {
                number?: number;
                title?: string;
                url?: string;
                state?: string;
              };
              fieldValues: {
                nodes: Array<{
                  name?: string;
                  text?: string;
                  field?: { name?: string };
                }>;
              };
            };

            const allItems: ProjectItemNode[] = [];
            let cursor: string | null = null;
            let hasNextPage = true;

            // Try organization first
            while (hasNextPage) {
              const args = [
                'api',
                'graphql',
                '-f',
                `query=${orgQuery}`,
                '-F',
                `owner=${projectOwner}`,
                '-F',
                `number=${projectNum}`,
              ];
              if (cursor) {
                args.push('-f', `cursor=${cursor}`);
              }

              const result = await runGh(args, { parseJson: true });
              const data = result.json as {
                data?: {
                  organization?: {
                    projectV2?: {
                      id: string;
                      title: string;
                      items: {
                        pageInfo: { hasNextPage: boolean; endCursor: string | null };
                        nodes: ProjectItemNode[];
                      };
                    };
                  };
                };
              };

              const pv2 = data.data?.organization?.projectV2;
              if (!pv2 && cursor === null) {
                // Organization failed on first page, try user instead
                break;
              }
              if (!pv2) {
                hasNextPage = false;
                break;
              }

              allItems.push(...pv2.items.nodes);
              hasNextPage = pv2.items.pageInfo.hasNextPage;
              cursor = pv2.items.pageInfo.endCursor;
            }

            // If organization didn't work, try user
            if (allItems.length === 0) {
              cursor = null;
              hasNextPage = true;
              while (hasNextPage) {
                const args = [
                  'api',
                  'graphql',
                  '-f',
                  `query=${userQuery}`,
                  '-F',
                  `owner=${projectOwner}`,
                  '-F',
                  `number=${projectNum}`,
                ];
                if (cursor) {
                  args.push('-f', `cursor=${cursor}`);
                }

                const result = await runGh(args, { parseJson: true });

                if (!result.success || !result.json) {
                  return {
                    content: [
                      { type: 'text', text: `❌ Failed to fetch project items: ${result.text}` },
                    ],
                    isError: true,
                    details: {},
                  };
                }

                const data = result.json as {
                  data?: {
                    user?: {
                      projectV2?: {
                        id: string;
                        title: string;
                        items: {
                          pageInfo: { hasNextPage: boolean; endCursor: string | null };
                          nodes: ProjectItemNode[];
                        };
                      };
                    };
                  };
                };

                const pv2 = data.data?.user?.projectV2;
                if (!pv2) {
                  hasNextPage = false;
                  break;
                }

                allItems.push(...pv2.items.nodes);
                hasNextPage = pv2.items.pageInfo.hasNextPage;
                cursor = pv2.items.pageInfo.endCursor;
              }
            }

            // Now search through all collected items
            const match = params.url
              ? allItems.find((n) => n.content?.url === params.url)
              : allItems[0];

            if (!match) {
              return {
                content: [
                  {
                    type: 'text',
                    text: params.url
                      ? `❌ No project item found for URL: ${params.url}`
                      : '❌ No project items found',
                  },
                ],
                isError: true,
                details: {},
              };
            }

            const content = match.content;
            const fieldValues = (match.fieldValues?.nodes ?? [])
              .filter((fv) => fv.field?.name)
              .map((fv) => {
                const value = fv.name ?? fv.text ?? '—';
                return `  - ${fv.field?.name ?? '?'}: ${value}`;
              });

            const lines = [
              `**Project Item Found**`,
              `**Node ID:** \`${match.id}\``,
              `**Content:** ${content?.title ?? '?'} (#${content?.number ?? '?'}) — ${content?.state ?? '?'}`,
              `**URL:** ${content?.url ?? '?'}`,
              '',
              '**Field Values:**',
              ...fieldValues,
            ];

            return {
              content: [{ type: 'text', text: lines.join('\n') }],
              details: {
                itemId: match.id,
                url: content?.url,
                number: content?.number,
                title: content?.title,
                state: content?.state,
              },
            };
          } catch (err) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Failed to get project item: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
              details: {},
            };
          }
        },
      }),
    ],
  });

  registerNamespace(pi, {
    name: 'gh_workflow',
    label: 'GitHub: Actions',
    description:
      'Trigger and inspect GitHub Actions workflow runs, including the release/deploy pipeline.',
    actions: [
      defineAction({
        action: 'run',
        summary: 'Trigger a workflow via workflow_dispatch',

        parameters: Type.Object({
          workflow: Type.Optional(
            Type.String({
              default: 'release.yml',
              description: 'Workflow file name (default: "release.yml")',
            }),
          ),
          ref: Type.Optional(
            Type.String({ description: 'Branch/tag to run on (default: current git branch)' }),
          ),
          inputs: Type.Optional(
            Type.Record(Type.String(), Type.String(), {
              description:
                'workflow_dispatch inputs as string key→value pairs (booleans must be "true"/"false")',
            }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const repoCheck = await ensureGitHubRepo();
          if (!repoCheck.ok) {
            return {
              content: [{ type: 'text', text: `❌ ${repoCheck.reason}` }],
              isError: true,
              details: {},
            };
          }

          const workflow = params.workflow ?? 'release.yml';
          const ref = params.ref ?? (await currentBranch());

          // Capture the newest run ID BEFORE dispatch so we can detect the new run afterward
          const baselineRunId = await fetchNewestRunId(workflow, ref);

          const args = ['workflow', 'run', workflow, '--ref', ref];
          for (const [key, value] of Object.entries(params.inputs ?? {})) {
            args.push('-f', `${key}=${value}`);
          }

          const result = await runGh(args, { timeoutMs: 30_000 });
          if (!result.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: [
                    `❌ Failed to trigger workflow: ${result.text}`,
                    '',
                    'If the error mentions "failed to parse workflow", the workflow file is invalid —',
                    'check job-level `if:` conditions (env context is not allowed there).',
                  ].join('\n'),
                },
              ],
              isError: true,
              details: {},
            };
          }

          // Dispatch returns no payload — poll briefly for the NEW run (not a pre-existing one).
          let runId: string | undefined;
          let runUrl: string | undefined;
          for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise((r) => setTimeout(r, 1500));
            const list = await runGh(
              [
                'run',
                'list',
                '--workflow',
                workflow,
                '--branch',
                ref,
                '--limit',
                '1',
                '--json',
                'databaseId,url',
              ],
              { parseJson: true, timeoutMs: 30_000 },
            );
            const runs =
              list.success && Array.isArray(list.json)
                ? (list.json as Array<Record<string, unknown>>)
                : [];
            if (runs[0]) {
              const candidateId = String(runs[0].databaseId ?? '');
              // Accept only when the run ID differs from the baseline (new run created)
              if (candidateId !== baselineRunId) {
                runId = candidateId;
                runUrl = String(runs[0].url ?? '');
                break;
              }
            }
          }

          const lines = [
            '✅ **Workflow dispatched!**',
            `**Workflow:** ${workflow}`,
            `**Ref:** ${ref}`,
          ];
          if (params.inputs && Object.keys(params.inputs).length > 0) {
            lines.push(`**Inputs:** ${JSON.stringify(params.inputs)}`);
          }
          if (runUrl) {
            lines.push(`**Run:** ${runUrl}`);
          } else {
            lines.push(
              '**Run:** not visible yet — check with `gh_workflow_status` in a few seconds.',
            );
          }

          return {
            content: [{ type: 'text', text: lines.join('\n') }],
            details: {
              workflow,
              ref,
              inputs: params.inputs ?? {},
              runId: runId ?? null,
              runUrl: runUrl ?? null,
            },
          };
        },
      }),
      defineAction({
        action: 'status',
        summary: 'Recent runs for a workflow, or one run in detail',

        parameters: Type.Object({
          workflow: Type.Optional(
            Type.String({
              default: 'release.yml',
              description: 'Workflow file name (default: "release.yml")',
            }),
          ),
          run: Type.Optional(
            Type.String({ description: 'Run ID or branch name to inspect a single run' }),
          ),
          limit: Type.Optional(
            Type.Number({
              default: 5,
              description: 'Runs to list when no run is given (default: 5)',
            }),
          ),
          watch: Type.Optional(
            Type.Boolean({ default: false, description: 'Poll until the run completes' }),
          ),
          timeoutSeconds: Type.Optional(
            Type.Number({
              default: 1800,
              description: 'Max watch time in seconds (default: 1800)',
            }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const workflow = params.workflow ?? 'release.yml';

          // ── List mode: no run specified ──
          if (!params.run) {
            const result = await runGh(
              [
                'run',
                'list',
                '--workflow',
                workflow,
                '--limit',
                String(params.limit ?? 5),
                '--json',
                'databaseId,displayTitle,event,status,conclusion,headBranch,url',
              ],
              { parseJson: true, timeoutMs: 30_000 },
            );
            if (!result.success) {
              return {
                content: [{ type: 'text', text: `❌ Failed to list runs: ${result.text}` }],
                isError: true,
                details: {},
              };
            }
            const runs = Array.isArray(result.json)
              ? (result.json as Array<Record<string, unknown>>)
              : [];
            return {
              content: [
                {
                  type: 'text',
                  text: `**Recent runs — ${workflow}**\n\n${formatRunList(runs)}`,
                },
              ],
              details: { workflow, count: runs.length },
            };
          }

          // ── Single run mode ──
          const resolved = await resolveRunId(params.run, workflow);
          if ('error' in resolved) {
            return {
              content: [{ type: 'text', text: `❌ ${resolved.error}` }],
              isError: true,
              details: {},
            };
          }
          const { runId } = resolved;

          // Optional watch: poll until terminal state.
          if (params.watch) {
            const outcome = await waitForRunCompletion(runId, params.timeoutSeconds ?? 1800);
            if (typeof outcome === 'object') {
              return {
                content: [{ type: 'text', text: `❌ ${outcome.error}` }],
                isError: true,
                details: { runId },
              };
            }
            if (outcome === 'timeout') {
              return {
                content: [
                  {
                    type: 'text',
                    text: `⏳ Run #${runId} still running after ${params.timeoutSeconds ?? 1800}s — use gh_workflow_status again or gh_workflow_logs to inspect.`,
                  },
                ],
                details: { runId, status: 'still-running' },
              };
            }
          }

          const result = await runGh(
            [
              'run',
              'view',
              runId,
              '--json',
              'databaseId,displayTitle,event,status,conclusion,url,headBranch,jobs',
            ],
            { parseJson: true, timeoutMs: 30_000 },
          );
          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to view run: ${result.text}` }],
              isError: true,
              details: { runId },
            };
          }

          const data = result.json as Record<string, unknown>;
          return {
            content: [{ type: 'text', text: formatRunDetail(data) }],
            details: {
              runId,
              status: data.status,
              conclusion: data.conclusion ?? null,
              url: data.url ?? null,
            },
          };
        },
      }),
      defineAction({
        action: 'logs',
        summary: 'Stream logs for a run, optionally watching to completion',

        parameters: Type.Object({
          run: Type.String({ description: 'Run ID or branch name' }),
          workflow: Type.Optional(
            Type.String({
              default: 'release.yml',
              description: 'Workflow file name (default: "release.yml")',
            }),
          ),
          job: Type.Optional(
            Type.String({ description: 'Only show logs for a specific job (name or ID)' }),
          ),
          failedOnly: Type.Optional(
            Type.Boolean({ default: false, description: 'Only show logs for failed steps' }),
          ),
          watch: Type.Optional(
            Type.Boolean({
              default: false,
              description: 'Wait for the run to finish before dumping logs',
            }),
          ),
          timeoutSeconds: Type.Optional(
            Type.Number({
              default: 1800,
              description: 'Max watch time in seconds (default: 1800)',
            }),
          ),
          lines: Type.Optional(
            Type.Number({ description: 'Keep only the last N log lines (0 = all)' }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const workflow = params.workflow ?? 'release.yml';
          const resolved = await resolveRunId(params.run, workflow);
          if ('error' in resolved) {
            return {
              content: [{ type: 'text', text: `❌ ${resolved.error}` }],
              isError: true,
              details: {},
            };
          }
          const { runId } = resolved;

          if (params.watch) {
            const outcome = await waitForRunCompletion(runId, params.timeoutSeconds ?? 1800);
            if (typeof outcome === 'object') {
              return {
                content: [{ type: 'text', text: `❌ ${outcome.error}` }],
                isError: true,
                details: { runId },
              };
            }
            if (outcome === 'timeout') {
              return {
                content: [
                  {
                    type: 'text',
                    text: `⏳ Run #${runId} still running after ${params.timeoutSeconds ?? 1800}s. Logs may be incomplete — fetch again later.`,
                  },
                ],
                details: { runId, status: 'still-running' },
              };
            }
          }

          const args = ['run', 'view', runId];
          if (params.failedOnly) {
            args.push('--log-failed');
          } else {
            args.push('--log');
          }
          if (params.job) {
            args.push('--job', params.job);
          }

          const result = await runGh(args, { timeoutMs: 300_000 });
          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to fetch logs: ${result.text}` }],
              isError: true,
              details: { runId },
            };
          }

          let logText = result.text;
          if (params.lines && params.lines > 0) {
            const parts = logText.split('\n');
            logText = parts.slice(-params.lines).join('\n');
          }

          return {
            content: [{ type: 'text', text: logText || '_No log output for this run._' }],
            details: { runId, failedOnly: params.failedOnly ?? false, job: params.job ?? null },
          };
        },
      }),
      defineAction({
        action: 'deploy',
        summary: 'Trigger the release/deploy workflow and optionally wait',

        parameters: Type.Object({
          mode: Type.Optional(
            Type.String({
              enum: ['staging', 'production'],
              default: 'staging',
              description: 'Deployment target (default: staging)',
            }),
          ),
          platforms: Type.Optional(
            Type.Union(
              [
                Type.Array(Type.String({ enum: ['linux', 'windows', 'macos'] })),
                Type.String({ description: 'Comma-separated, e.g. "linux,windows"' }),
              ],
              { description: 'Platforms to build (default: all)' },
            ),
          ),
          bundles: Type.Optional(
            Type.String({
              description:
                'Bundle targets to build, comma-separated (appimage,deb,rpm,msi,dmg). Empty = platform defaults',
            }),
          ),
          ref: Type.Optional(
            Type.String({ description: 'Branch to deploy (default: current git branch)' }),
          ),
          workflow: Type.Optional(
            Type.String({
              default: 'release.yml',
              description: 'Workflow file name (default: "release.yml")',
            }),
          ),
          force: Type.Optional(
            Type.Boolean({
              default: false,
              description: 'Bypass the Redis checksum cache (--force)',
            }),
          ),
          wait: Type.Optional(
            Type.Boolean({
              default: true,
              description: 'Wait for completion and report (default: true)',
            }),
          ),
          timeoutSeconds: Type.Optional(
            Type.Number({
              default: 2700,
              minimum: 1,
              description: 'Max wait time in seconds (default: 2700 = 45min)',
            }),
          ),
          intervalSeconds: Type.Optional(
            Type.Number({
              default: 15,
              minimum: 1,
              description: 'Poll interval in seconds (default: 15)',
            }),
          ),
          fetchLogs: Type.Optional(
            Type.Boolean({
              default: true,
              description: 'Auto-fetch failed step logs when a job fails (default: true)',
            }),
          ),
        }),
        async execute(_toolCallId, params, signal, onUpdate, _ctx) {
          const repoCheck = await ensureGitHubRepo();
          if (!repoCheck.ok) {
            return {
              content: [{ type: 'text', text: `❌ ${repoCheck.reason}` }],
              isError: true,
              details: {},
            };
          }

          const workflow = params.workflow ?? 'release.yml';
          const mode = params.mode ?? 'staging';
          const ref = params.ref ?? (await currentBranch());
          const platformsCsv = normalizePlatforms(params.platforms);
          const platforms = platformsCsv ? platformsCsv.split(',') : [];
          const timeoutSeconds = Math.max(1, params.timeoutSeconds ?? 2700);
          const intervalSeconds = Math.max(1, params.intervalSeconds ?? 15);
          const intervalMs = intervalSeconds * 1000;

          // Capture the newest run ID BEFORE dispatch so we can detect the new run afterward
          const baselineRunId = await fetchNewestRunId(workflow, ref);

          // ── 1. Dispatch ──
          const dispatchArgs = ['workflow', 'run', workflow, '--ref', ref, '-f', `mode=${mode}`];
          if (params.force) {
            dispatchArgs.push('-f', 'force=true');
          }
          if (platformsCsv) {
            dispatchArgs.push('-f', `platforms=${platformsCsv}`);
          }
          const bundles = params.bundles?.trim() ?? '';
          if (bundles) {
            dispatchArgs.push('-f', `bundles=${bundles}`);
          }

          const progress = (line: string) =>
            onUpdate?.({ content: [{ type: 'text', text: line }], details: {} });

          progress(
            `🚀 Dispatching ${workflow} on ${ref} (mode=${mode}${platformsCsv ? `, platforms=${platformsCsv}` : ', all platforms'}${bundles ? `, bundles=${bundles}` : ''})...`,
          );
          const dispatch = await runGh(dispatchArgs, { timeoutMs: 30_000 });
          if (!dispatch.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: [
                    `❌ Failed to trigger deploy: ${dispatch.text}`,
                    '',
                    'If the error mentions "failed to parse workflow", the workflow file is invalid.',
                  ].join('\n'),
                },
              ],
              isError: true,
              details: {},
            };
          }

          // ── 2. Wait for the NEW run to appear (not a pre-existing one) ──
          let runId: string | undefined;
          for (let attempt = 0; attempt < 10; attempt++) {
            try {
              await abortableSleep(1500, signal);
            } catch {
              return {
                content: [
                  { type: 'text', text: '🛑 Aborted while waiting for the run to appear.' },
                ],
                details: { dispatched: true },
              };
            }
            const list = await runGh(
              [
                'run',
                'list',
                '--workflow',
                workflow,
                '--branch',
                ref,
                '--limit',
                '1',
                '--json',
                'databaseId,url',
              ],
              { parseJson: true, timeoutMs: 30_000 },
            );
            const runs =
              list.success && Array.isArray(list.json)
                ? (list.json as Array<Record<string, unknown>>)
                : [];
            if (runs[0]) {
              const candidateId = String(runs[0].databaseId ?? '');
              // Accept only when the run ID differs from the baseline (new run created)
              if (candidateId !== baselineRunId) {
                runId = candidateId;
                break;
              }
            }
          }

          if (!runId) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Deploy dispatched but the run did not appear — check with gh_workflow_status(workflow="${workflow}").`,
                },
              ],
              isError: true,
              details: { workflow, ref, mode },
            };
          }

          const runUrl = `https://github.com/${repoCheck.owner}/${repoCheck.repo}/actions/runs/${runId}`;

          // ── 3. Quick dispatch (no wait) ──
          if (!params.wait) {
            return {
              content: [
                {
                  type: 'text',
                  text: [
                    `🚀 **Deploy dispatched** (mode=${mode}${platformsCsv ? `, platforms=${platformsCsv}` : ', all platforms'}${bundles ? `, bundles=${bundles}` : ''})`,
                    `**Run:** ${runUrl}`,
                    '',
                    `Watch with: gh_workflow_status(run=${runId}, watch=true)`,
                    `Logs with: gh_workflow_logs(run=${runId})`,
                  ].join('\n'),
                },
              ],
              details: { runId, runUrl, workflow, ref, mode, platforms },
            };
          }

          // ── 4. Periodic fetch until all requested jobs are terminal ──
          const deadline = Date.now() + timeoutSeconds * 1000;
          let lastJobState = '';
          let aborted = false;
          let timedOut = false;
          let finalStatus:
            | { ok: true; status: string; conclusion: string; jobs: Array<Record<string, unknown>> }
            | undefined;
          let lastError: string | undefined;

          while (Date.now() < deadline) {
            const snap = await fetchRunStatus(runId, platforms);
            if (!snap.ok) {
              lastError = snap.error;
              break;
            }
            finalStatus = snap;

            const jobStates = snap.jobs
              .map(
                (j) => `${String(j.name ?? '?')}:${String(j.conclusion ?? String(j.status ?? ''))}`,
              )
              .join(' | ');
            if (jobStates !== lastJobState) {
              progress(`⏳ ${jobStates || '(no jobs yet — runner starting)'}`);
              lastJobState = jobStates;
            }

            const relevantJobs = snap.jobs.filter((j) => String(j.status ?? '') === 'completed');
            const allDone = snap.jobs.length > 0 && relevantJobs.length === snap.jobs.length;
            if (allDone || snap.status === 'completed') {
              break;
            }

            try {
              await abortableSleep(intervalMs, signal);
            } catch {
              aborted = true;
              break;
            }
          }

          // Prioritize polling errors even if we have a stale finalStatus
          if (lastError) {
            return {
              content: [{ type: 'text', text: `❌ Failed to poll deploy run: ${lastError}` }],
              isError: true,
              details: { runId },
            };
          }

          if (!finalStatus) {
            timedOut = true;
          } else if (Date.now() >= deadline && !aborted) {
            timedOut = true;
          }

          // ── 5. Final report ──
          const report: string[] = [];
          const isAborted = aborted;
          if (isAborted) {
            report.push('🛑 **Aborted** (Esc/Ctrl+C) — current state:');
          } else if (timedOut) {
            report.push(`⏳ **Timed out after ${timeoutSeconds}s** — current state:`);
          }

          const runStatus = finalStatus?.status ?? 'unknown';
          const runConclusion = finalStatus?.conclusion ?? '';
          const finalJobs = finalStatus?.jobs ?? [];
          const allSucceeded =
            !isAborted &&
            !timedOut &&
            runStatus === 'completed' &&
            (runConclusion === 'success' ||
              (finalJobs.length > 0 && finalJobs.every((j) => j.conclusion === 'success')));

          report.push(
            `${allSucceeded ? '✅' : '❌'} **Deploy ${allSucceeded ? 'succeeded' : runConclusion || runStatus}** — ${mode}${platformsCsv ? ` (${platformsCsv})` : ' (all platforms)'}${bundles ? `, bundles: ${bundles}` : ''}`,
            `**Run:** ${runUrl}`,
          );

          if (finalStatus && finalStatus.jobs.length > 0) {
            report.push('', '**Jobs:**');
            for (const job of finalStatus.jobs) {
              const jobName = String(job.name ?? '?');
              const jobConclusion = job.conclusion
                ? String(job.conclusion)
                : String(job.status ?? '');
              let icon: string;
              if (jobConclusion === 'success') {
                icon = '✅';
              } else if (jobConclusion === 'skipped') {
                icon = '⏭️';
              } else if (jobConclusion === 'cancelled') {
                icon = '🚫';
              } else {
                icon = '❌';
              }
              report.push(`  ${icon} **${jobName}** — ${jobConclusion}`);
            }
          }

          // Artifacts (only meaningful when the run is done)
          if (runStatus === 'completed') {
            const artifacts = await fetchRunArtifacts(runId);
            if (artifacts.length > 0) {
              report.push('', '**Artifacts:**');
              for (const a of artifacts) {
                report.push(`  📦 ${a.name} — ${formatBytes(a.size)}`);
              }
            }
          }

          // ── 6. Auto-fetch failed logs ──
          const failedJobs = finalStatus?.jobs.filter((j) => j.conclusion === 'failure') ?? [];
          if (
            params.fetchLogs !== false &&
            (failedJobs.length > 0 || runConclusion === 'failure')
          ) {
            report.push('', '---', '**Failed step logs:**');
            const logs = await runGh(['run', 'view', runId, '--log-failed'], {
              timeoutMs: 120_000,
            });
            if (logs.success && logs.text.trim()) {
              const lines = logs.text.split('\n');
              const kept = lines.slice(-150);
              report.push('', '```', kept.join('\n'), '```');
            } else {
              report.push('  _(no failed logs available)_');
            }
          }

          return {
            content: [{ type: 'text', text: report.join('\n') }],
            details: {
              runId,
              runUrl,
              workflow,
              ref,
              mode,
              platforms,
              bundles: bundles || null,
              status: runStatus,
              conclusion: runConclusion || null,
              succeeded: allSucceeded,
              aborted: isAborted,
              timedOut,
            },
          };
        },
      }),
    ],
  });

  registerNamespace(pi, {
    name: 'gh_release',
    label: 'GitHub: Releases',
    description: 'Inspect GitHub releases and their uploaded assets.',
    actions: [
      defineAction({
        action: 'list',
        summary: 'List releases with tag, title and date',

        parameters: Type.Object({
          limit: Type.Optional(
            Type.Number({ default: 10, description: 'Max releases (default: 10)' }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const result = await runGh(
            [
              'release',
              'list',
              '--limit',
              String(params.limit ?? 10),
              '--json',
              'tagName,name,isLatest,publishedAt,url',
            ],
            { parseJson: true, timeoutMs: 30_000 },
          );
          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to list releases: ${result.text}` }],
              isError: true,
              details: {},
            };
          }

          const releases = Array.isArray(result.json)
            ? (result.json as Array<Record<string, unknown>>)
            : [];
          if (releases.length === 0) {
            return {
              content: [{ type: 'text', text: 'No releases found.' }],
              details: { count: 0 },
            };
          }

          const lines: string[] = [];
          for (const r of releases) {
            const tag = String(r.tagName ?? '?');
            const name = String(r.name ?? '');
            const isLatest = r.isLatest ? ' 🟢 latest' : '';
            const published = String(r.publishedAt ?? '?').slice(0, 10);
            const url = String(r.url ?? '');
            lines.push(
              `**${tag}**${isLatest} — ${name || tag}`,
              `   published ${published} | ${url}`,
            );
          }
          return {
            content: [{ type: 'text', text: lines.join('\n') }],
            details: { count: releases.length },
          };
        },
      }),
      defineAction({
        action: 'view',
        summary: 'View a release with its notes and assets',

        parameters: Type.Object({
          tag: Type.Optional(
            Type.String({
              description: 'Release tag, or "latest" for the newest release (defaults to latest)',
            }),
          ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const args = ['release', 'view'];
          if (params.tag && params.tag !== 'latest') {
            args.push(params.tag);
          }
          args.push('--json', 'tagName,name,body,publishedAt,isLatest,url,assets');
          const result = await runGh(args, { parseJson: true, timeoutMs: 30_000 });
          if (!result.success) {
            return {
              content: [{ type: 'text', text: `❌ Failed to view release: ${result.text}` }],
              isError: true,
              details: {},
            };
          }

          const data = result.json as Record<string, unknown>;
          const tag = String(data.tagName ?? '?');
          const name = String(data.name ?? '');
          const isLatest = data.isLatest ? ' 🟢 latest' : '';
          const published = String(data.publishedAt ?? '?');
          const url = String(data.url ?? '');
          const body = String(data.body ?? '').slice(0, 3000);

          const lines = [
            `**${tag}**${isLatest} — ${name || tag}`,
            `**Published:** ${published}`,
            `**URL:** ${url}`,
          ];

          const assets = Array.isArray(data.assets)
            ? (data.assets as Array<Record<string, unknown>>)
            : [];
          if (assets.length > 0) {
            lines.push('', `**Assets (${assets.length}):**`);
            const byExt = new Map<string, Array<Record<string, unknown>>>();
            for (const asset of assets) {
              const aName = String(asset.name ?? '?');
              const ext = aName.includes('.')
                ? aName.slice(aName.lastIndexOf('.')).toLowerCase()
                : '(none)';
              const list = byExt.get(ext) ?? [];
              list.push(asset);
              byExt.set(ext, list);
            }
            for (const [ext, list] of byExt) {
              lines.push(`  **${ext}** (${list.length}):`);
              for (const asset of list) {
                const aName = String(asset.name ?? '?');
                const size = formatBytes(Number(asset.size ?? 0));
                const downloads = Number(asset.downloadCount ?? 0);
                const state = String(asset.state ?? '?');
                const stateIcon = state === 'uploaded' ? '✅' : '⚠️';
                lines.push(
                  `    ${stateIcon} ${aName} — ${size}, ${downloads} downloads (${state})`,
                );
              }
            }
          } else {
            lines.push(
              '',
              '⚠️ **No assets uploaded to this release.**',
              '  If this was a desktop release, the upload step likely failed.',
            );
          }

          if (body.trim()) {
            lines.push('', '**Notes:**', body);
          }

          return {
            content: [{ type: 'text', text: lines.join('\n') }],
            details: { tag, isLatest: !!data.isLatest, assetCount: assets.length },
          };
        },
      }),
    ],
  });
  // ═══════════════════════════════════════════════════════════════════════
  // Tool 1: gh_create_pr

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 2: gh_list_prs

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 3: gh_summarize_pr

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 4: gh_pr_status

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 5: gh_merge_pr

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 6: gh_cancel_pr

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 7: gh_edit_pr

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 8: gh_list_issues

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 9: gh_create_issue

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 10: gh_close_issue

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 11: gh_reopen_issue

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 12: gh_edit_issue

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 13: gh_view_issue

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 14: gh_list_projects

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 15: gh_project_view

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 16: gh_project_item_add

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_promote_pr

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_pr_comments

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_project_item_mutate

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_project_item_get

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_workflow_run

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_workflow_status

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_workflow_logs

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_release_list

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_release_view

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_deploy — trigger the release workflow and wait for the result
}
