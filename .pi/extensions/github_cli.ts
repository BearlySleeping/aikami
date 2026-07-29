// .pi/extensions/github_cli.ts
//
// GitHub CLI integration for pi — PR management, merge, sync.
// Uses `gh` (v2.96+) from nixpkgs. All tools run via pi.exec for
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
//
// For git branch management after merge, use `git pull` on the target branch.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 60_000;

import { PIPELINE_BASE_BRANCH } from '../../scripts/src/lib/agents/contract_pipeline/types';

const DEFAULT_BASE = PIPELINE_BASE_BRANCH;

/** Repository root — always run gh from here, not from a worktree subdirectory. */
let _repoRoot: string | undefined;
const repoRoot = (): string => {
  if (!_repoRoot) {
    // When running inside a contract pipeline worktree, gh commands must run
    // from the main repo root — not the worktree.  Running gh from a worktree
    // triggers Git "already used by worktree" errors when gh tries to resolve
    // the target branch (e.g. `main`) for merge operations.
    const wsPath = process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
    if (wsPath) {
      // Worktree paths are `.pi/workspaces/run-xxx`. Walk up to find the
      // parent of `.pi/` — that's the main repo root.
      const piIdx = wsPath.indexOf('/.pi/');
      if (piIdx !== -1) {
        _repoRoot = wsPath.slice(0, piIdx);
        return _repoRoot;
      }
    }
    _repoRoot = process.cwd();
  }
  return _repoRoot;
};

/**
 * Resolve a pr identifier (number, URL, or branch name) to a gh-compatible
 * pr selector. Accepts:
 *   - raw number: "42"          → "42"
 *   - branch name: "feat/xyz"   → "feat/xyz"
 *   - URL: "https://github.com/owner/repo/pull/42" → "42"
 */
function resolvePrSelector(raw: string): string {
  // If it's a URL, extract the PR number
  const urlMatch = raw.match(/\/pull\/(\d+)/);
  if (urlMatch) {
    return urlMatch[1] ?? raw;
  }

  // If it's purely numeric, it's a PR number
  if (/^\d+$/.test(raw)) {
    return raw;
  }

  // Otherwise treat as branch name
  return raw;
}

/** Run gh with optional JSON output and parse the result. */
async function runGh(
  pi: ExtensionAPI,
  args: string[],
  opts?: { timeout?: number; parseJson?: boolean; cwd?: string },
): Promise<{ success: boolean; text: string; json?: unknown }> {
  const result = await pi.exec('gh', args, {
    signal: undefined,
    timeout: opts?.timeout ?? DEFAULT_TIMEOUT,
    cwd: opts?.cwd ?? repoRoot(),
  });

  if (result.code !== 0) {
    return { success: false, text: result.stderr || result.stdout || 'gh exited with error' };
  }

  const text = result.stdout.trim();
  if (opts?.parseJson && text) {
    try {
      return { success: true, text, json: JSON.parse(text) };
    } catch {
      // Non-JSON output — return text as-is
      return { success: true, text };
    }
  }

  return { success: true, text };
}

/** Check that we're inside a git repo with a GitHub remote. */
async function ensureGitHubRepo(
  pi: ExtensionAPI,
): Promise<{ ok: boolean; reason?: string; owner?: string; repo?: string }> {
  const result = await pi.exec('git', ['remote', 'get-url', 'origin'], {
    timeout: 10_000,
  });
  if (result.code !== 0) {
    return { ok: false, reason: 'Not a git repository or no "origin" remote configured' };
  }
  const remote = result.stdout.trim();
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!match) {
    return { ok: false, reason: `Remote 'origin' is not a GitHub repository: ${remote}` };
  }
  return { ok: true, owner: match[1], repo: match[2] };
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
  pi: ExtensionAPI,
  prNumber: number,
  cwd: string,
  includeReviews: boolean,
  includeInline: boolean,
): Promise<PrCommentCache> => {
  const jsonFields = includeReviews ? 'comments,reviews,updatedAt' : 'comments,updatedAt';

  const result = await runGh(pi, ['pr', 'view', String(prNumber), '--json', jsonFields], {
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
          pi,
          ['api', `repos/${owner}/${repo}/pulls/${prNumber}/comments`, '--paginate'],
          { parseJson: true, cwd, timeout: 30_000 },
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
            updatedAt: String((c as Record<string, unknown>).updated_at ?? (c as Record<string, unknown>).created_at ?? ''),
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
    const stateIcon = state === 'OPEN' ? '🟢' : state === 'MERGED' ? '🟣' : '🔴';
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

  const stateIcon = state === 'OPEN' ? '🟢' : state === 'MERGED' ? '🟣' : '🔴';
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
  // ═══════════════════════════════════════════════════════════════════════
  // Tool 1: gh_create_pr
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_create_pr',
    label: 'GitHub: Create PR',
    description:
      'Create a GitHub Pull Request using gh CLI. Default base branch is "dev". ' +
      'Returns the PR URL on success. ' +
      'Set draft=true for work-in-progress PRs. Set web=true to open in browser.',
    promptSnippet: 'Use gh_create_pr to create a GitHub PR (default base: main)',
    promptGuidelines: [
      'Use gh_create_pr when the user asks to create a pull request.',
      'The default base branch is set via PIPELINE_BASE_BRANCH in contract_pipeline/types.ts. Use baseBranch to override.',
      'After creation, the PR URL is shown — offer to merge it with gh_merge_pr if approved.',
    ],
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
      const repoCheck = await ensureGitHubRepo(pi);
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

      const result = await runGh(pi, args, { timeout: 60_000 });

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

      // 🔗 Auto-write: if PR references a contract (C-XXX), update the contract's YAML frontmatter
      let contractUpdated: string | undefined;
      if (prNumber && prUrl) {
        const contractMatch =
          params.title.match(/\b(C-\d+|MIG-\d+)\b/i) ?? body.match(/\b(C-\d+|MIG-\d+)\b/i);
        if (contractMatch?.[1]) {
          const contractId = contractMatch[1].toUpperCase();
          const cwd = _ctx?.cwd ?? process.cwd();
          const contractsDir = join(cwd, 'docs/contracts');
          try {
            if (existsSync(contractsDir)) {
              const files = readdirSync(contractsDir).filter(
                (f: string) => f.startsWith(`${contractId}-`) && f.endsWith('.md'),
              );
              if (files.length === 1 && files[0]) {
                const contractPath = join(contractsDir, files[0]);
                const content = readFileSync(contractPath, 'utf-8');
                const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
                if (yamlMatch?.[1]) {
                  let yaml = yamlMatch[1];
                  // Update pr_url and pr_number — preserve existing indentation
                  const prUrlMatch = yaml.match(/^(\s*)pr_url:\s*.+/m);
                  const indent = prUrlMatch?.[1] ?? '  ';
                  yaml = yaml.replace(/^\s*pr_url:\s*.+/m, `${indent}pr_url: "${prUrl}"`);
                  if (/^\s*pr_number:/m.test(yaml)) {
                    yaml = yaml.replace(/^\s*pr_number:\s*.+/m, `${indent}pr_number: ${prNumber}`);
                  } else {
                    // Add pr_number after pr_url if missing
                    yaml = yaml.replace(
                      /(^\s*pr_url:\s*.+)/m,
                      `$1\n${indent}pr_number: ${prNumber}`,
                    );
                  }
                  const updated = content.replace(yamlMatch[1], yaml);
                  if (updated !== content) {
                    writeFileSync(contractPath, updated);
                    contractUpdated = contractPath;
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
              contractUpdated ? `**Contract:** Updated \`${contractUpdated}\` with PR URL` : '',
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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 2: gh_list_prs
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_list_prs',
    label: 'GitHub: List PRs',
    description:
      'List GitHub Pull Requests using gh CLI. Filters by state, base branch, author, or label. ' +
      'Returns formatted list with PR numbers, titles, branches, and URLs.',
    promptSnippet: 'Use gh_list_prs to list GitHub PRs (open, closed, merged, or all)',
    promptGuidelines: [
      'Use gh_list_prs to see open PRs, filter by author, or check what needs review.',
      'Default state is "open". Use state="all" to see everything.',
    ],
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

      const result = await runGh(pi, args, { parseJson: true });

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `❌ Failed to list PRs: ${result.text}` }],
          isError: true,
          details: {},
        };
      }

      const prs = Array.isArray(result.json) ? (result.json as Array<Record<string, unknown>>) : [];
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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 3: gh_summarize_pr
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_summarize_pr',
    label: 'GitHub: Summarize PR',
    description:
      'View and summarize a GitHub Pull Request. Shows title, description, state, ' +
      'author, review content (including CodeRabbit findings), comments, changed files, and stats. ' +
      'Accepts PR number, URL, or branch name.',
    promptSnippet: 'Use gh_summarize_pr to get the full summary of a GitHub PR',
    promptGuidelines: [
      'Use gh_summarize_pr to review a PR before merging or when the user asks about a PR.',
      'Pass the PR number, URL, or branch name.',
      '🔴 For detailed CodeRabbit review content within this PR, prefer the `coderabbitai` MCP tools (get_coderabbit_reviews, get_review_details) which provide structured findings and resolution tracking.',
    ],
    parameters: Type.Object({
      pr: Type.String({
        description: 'PR number (e.g. "42"), URL, or branch name',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const selector = resolvePrSelector(params.pr);
      const result = await runGh(
        pi,
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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 4: gh_pr_status
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_pr_status',
    label: 'GitHub: PR Checks',
    description:
      'Check CI status for a GitHub Pull Request. Shows all checks, their statuses, ' +
      'and a summary of passing/failing/pending counts. ' +
      'Accepts PR number, URL, or branch name.',
    promptSnippet: 'Use gh_pr_status to check CI checks on a GitHub PR',
    promptGuidelines: [
      'Use gh_pr_status to see if a PR is passing CI before merging.',
      'The output shows per-check status with pass/fail/pending summary.',
    ],
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
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const selector = resolvePrSelector(params.pr);
      const args = ['pr', 'checks', selector];

      if (params.watch) {
        args.push('--watch');
      }

      const result = await runGh(pi, args, { timeout: params.watch ? 600_000 : 60_000 });

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `❌ Failed to check PR status: ${result.text}` }],
          isError: true,
          details: {},
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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 5: gh_merge_pr
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_merge_pr',
    label: 'GitHub: Merge PR',
    description:
      'Merge a GitHub Pull Request. Default merge method is squash. ' +
      'Supports auto-merge (merge when CI passes) and branch deletion after merge. ' +
      'Accepts PR number, URL, or branch name.',
    promptSnippet: 'Use gh_merge_pr to merge a GitHub PR (default: squash)',
    promptGuidelines: [
      'Use gh_merge_pr when the user approves a PR for merging.',
      'Default merge method is squash. Use method="rebase" or method="merge" to override.',
      'Set autoMerge=true to enable auto-merge (merges when CI passes).',
      'Offer to run `git pull` after a successful merge to update the local branch.',
    ],
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

      const result = await runGh(pi, args, { timeout: 60_000 });

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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 6: gh_cancel_pr
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_cancel_pr',
    label: 'GitHub: Close PR',
    description:
      'Close a GitHub Pull Request without merging. Optionally deletes the head branch. ' +
      'Accepts PR number, URL, or branch name.',
    promptSnippet: 'Use gh_cancel_pr to close a GitHub PR without merging',
    promptGuidelines: [
      'Use gh_cancel_pr when a PR is no longer needed or should be abandoned.',
      'Set deleteBranch=true to also delete the remote branch.',
    ],
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

      const result = await runGh(pi, args, { timeout: 30_000 });

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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 7: gh_edit_pr
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_edit_pr',
    label: 'GitHub: Edit PR',
    description:
      'Edit a GitHub Pull Request — update title, body, base branch, labels, or assignees. ' +
      'Only specified fields are changed; omitted fields are left as-is. ' +
      'Accepts PR number, URL, or branch name.',
    promptSnippet: 'Use gh_edit_pr to update a GitHub PR title, body, base, or labels',
    promptGuidelines: [
      'Use gh_edit_pr to update PR metadata without closing and re-creating.',
      'Only specified fields are updated — pass only what needs to change.',
    ],
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

      const result = await runGh(pi, args, { timeout: 30_000 });

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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 8: gh_list_issues
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_list_issues',
    label: 'GitHub: List Issues',
    description:
      'List GitHub Issues using gh CLI. Filters by state, labels, assignee, or milestone. ' +
      'Returns formatted list with issue numbers, titles, labels, and URLs.',
    promptSnippet: 'Use gh_list_issues to list GitHub issues (open, closed, or all)',
    promptGuidelines: [
      'Use gh_list_issues to see open issues, filter by label, or check what needs triage.',
      'Default state is "open". Use state="all" to see everything.',
    ],
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

      const result = await runGh(pi, args, { parseJson: true });

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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 9: gh_create_issue
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_create_issue',
    label: 'GitHub: Create Issue',
    description:
      'Create a GitHub Issue. Supports title, body (markdown), labels, assignees, and milestone.',
    promptSnippet: 'Use gh_create_issue to create a GitHub issue',
    promptGuidelines: [
      'Use gh_create_issue to file bugs, feature requests, or create contract-tracked issues.',
      'The issue URL is returned — use it to link to projects or reference in commits.',
    ],
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

      const result = await runGh(pi, args, { timeout: 30_000 });

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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 10: gh_close_issue
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_close_issue',
    label: 'GitHub: Close Issue',
    description: 'Close a GitHub Issue. Optionally add a closing comment.',
    promptSnippet: 'Use gh_close_issue to close an issue',
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

      const result = await runGh(pi, args, { timeout: 30_000 });

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `❌ Failed to close issue: ${result.text}` }],
          isError: true,
          details: {},
        };
      }

      // Add comment if provided
      if (params.comment) {
        await runGh(pi, ['issue', 'comment', num, '--body', params.comment], { timeout: 30_000 });
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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 11: gh_reopen_issue
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_reopen_issue',
    label: 'GitHub: Reopen Issue',
    description: 'Reopen a closed GitHub Issue.',
    promptSnippet: 'Use gh_reopen_issue to reopen a closed issue',
    parameters: Type.Object({
      issue: Type.String({ description: 'Issue number (e.g. "42") or URL' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const num = resolvePrSelector(params.issue);
      const result = await runGh(pi, ['issue', 'reopen', num], { timeout: 30_000 });

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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 12: gh_edit_issue
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_edit_issue',
    label: 'GitHub: Edit Issue',
    description: 'Edit a GitHub Issue — update title, body, labels, assignees, or milestone.',
    promptSnippet: 'Use gh_edit_issue to update an issue',
    parameters: Type.Object({
      issue: Type.String({ description: 'Issue number (e.g. "42") or URL' }),
      title: Type.Optional(Type.String({ description: 'New title' })),
      body: Type.Optional(Type.String({ description: 'New body (markdown)' })),
      addLabels: Type.Optional(Type.Array(Type.String(), { description: 'Labels to add' })),
      removeLabels: Type.Optional(Type.Array(Type.String(), { description: 'Labels to remove' })),
      addAssignees: Type.Optional(Type.Array(Type.String(), { description: 'Handles to assign' })),
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

      const result = await runGh(pi, args, { timeout: 30_000 });

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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 13: gh_view_issue
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_view_issue',
    label: 'GitHub: View Issue',
    description:
      'View full details of a GitHub Issue — title, body, labels, assignees, milestone, and comments.',
    promptSnippet: 'Use gh_view_issue to see full issue details',
    promptGuidelines: [
      'Use gh_view_issue to read an issue before converting it to a contract.',
      'The full body and recent comments are shown — useful for understanding feature requests.',
    ],
    parameters: Type.Object({
      issue: Type.String({ description: 'Issue number (e.g. "42") or URL' }),
      comments: Type.Optional(Type.Boolean({ default: false, description: 'Include comments' })),
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

      const result = await runGh(pi, args, { parseJson: true });

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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 14: gh_list_projects
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_list_projects',
    label: 'GitHub: List Projects',
    description:
      'List GitHub Projects for an owner (org or user). Shows project number, title, state, and URL.',
    promptSnippet: 'Use gh_list_projects to list GitHub Projects (roadmaps)',
    promptGuidelines: [
      'Use gh_list_projects to discover available project boards.',
      'Default owner is the org (extracted from repo remote). Pass owner to override.',
      'Closed projects are excluded by default.',
    ],
    parameters: Type.Object({
      owner: Type.Optional(
        Type.String({ description: 'Org or user handle (default: repo owner)' }),
      ),
      closed: Type.Optional(
        Type.Boolean({ default: false, description: 'Include closed projects' }),
      ),
      limit: Type.Optional(Type.Number({ default: 20, description: 'Max results (default: 20)' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      let owner = params.owner;
      if (!owner) {
        const repoCheck = await ensureGitHubRepo(pi);
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
            { type: 'text', text: '❌ Could not determine project owner. Pass owner parameter.' },
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

      const result = await runGh(pi, args, { parseJson: true, timeout: 30_000 });

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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 15: gh_project_view
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_project_view',
    label: 'GitHub: View Project',
    description:
      'View a GitHub Project (roadmap) with its fields and items. Shows project metadata, custom fields, and linked issues/PRs.',
    promptSnippet: 'Use gh_project_view to inspect a GitHub Project board',
    promptGuidelines: [
      'Use gh_project_view to view the roadmap and its items.',
      'Pass fieldView to see items with their field values.',
    ],
    parameters: Type.Object({
      project: Type.String({ description: 'Project number (e.g. "1")' }),
      owner: Type.Optional(
        Type.String({ description: 'Org or user handle (default: repo owner)' }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      let owner = params.owner;
      if (!owner) {
        const repoCheck = await ensureGitHubRepo(pi);
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
            { type: 'text', text: '❌ Could not determine project owner. Pass owner parameter.' },
          ],
          isError: true,
          details: {},
        };
      }

      // Use --format json for machine-readable output
      const args = ['project', 'view', params.project, '--owner', projectOwner, '--format', 'json'];
      const result = await runGh(pi, args, { parseJson: true, timeout: 30_000 });

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
      const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];

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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 16: gh_project_item_add
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_project_item_add',
    label: 'GitHub: Add to Project',
    description: 'Add a GitHub Issue or Pull Request to a GitHub Project (roadmap).',
    promptSnippet: 'Use gh_project_item_add to add an issue or PR to a project board',
    promptGuidelines: [
      'Use gh_project_item_add to link an issue or PR to the roadmap.',
      'Pass the full URL of the issue or PR.',
    ],
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
        const repoCheck = await ensureGitHubRepo(pi);
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
            { type: 'text', text: '❌ Could not determine project owner. Pass owner parameter.' },
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

      const result = await runGh(pi, args, { timeout: 30_000 });

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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_promote_pr
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_promote_pr',
    label: 'GitHub: Promote PR',
    description:
      'Promote a draft GitHub Pull Request to "Ready for Review". ' +
      'Executes `gh pr ready` to transition the PR out of draft status, ' +
      'which triggers CodeRabbit AI code review and signals to human reviewers ' +
      'that the PR is ready for inspection. ' +
      'Accepts PR number, URL, or branch name.',
    promptSnippet: 'Use gh_promote_pr to mark a draft PR ready for review',
    promptGuidelines: [
      'Use gh_promote_pr when CI passes and the PR is ready for CodeRabbit AI review.',
      'This transitions the PR from Draft → Ready for Review, triggering automated reviews.',
      'Only promote after local CI checks pass — draft PRs save CodeRabbit quota.',
    ],
    parameters: Type.Object({
      pr: Type.String({
        description: 'PR number (e.g. "42"), URL, or branch name',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const selector = resolvePrSelector(params.pr);

      const result = await runGh(pi, ['pr', 'ready', selector], { timeout: 30_000 });

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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_pr_comments
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_pr_comments',
    label: 'GitHub: PR Comments',
    description:
      'Fetch PR comments (reviews + timeline + inline review comments) with timestamp-based caching. ' +
      'First call fetches all comments and caches them. Subsequent calls with ' +
      'the `since` parameter from the previous `fetchedAt` return only new/edited ' +
      'comments. Use `force: true` to bypass cache. ' +
      'Set `includeInline: true` to also fetch per-line review comments (CodeRabbit findings).',
    promptSnippet: 'Use gh_pr_comments to check for new PR comments since last fetch',
    promptGuidelines: [
      'On first call, omit `since` to get all comments and cache them.',
      'On subsequent calls, pass the `fetchedAt` value from the previous response as `since`.',
      'Pass `force: true` to re-fetch everything and refresh the cache.',
      'Pass `includeInline: true` to also get per-line CodeRabbit review findings.',
      '🔴 For CodeRabbit AI reviews, prefer the `coderabbitai` MCP tools (get_coderabbit_reviews, get_review_details, get_review_comments) — they provide structured findings with per-comment resolution tracking. Use gh_pr_comments for human comments and general timeline history only.',
    ],
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
          content: [{ type: 'text', text: `❌ Could not resolve PR number from: ${params.pr}` }],
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
        const cache = await fetchPrComments(pi, prNumber, cwd, includeReviews, includeInline);
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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_project_item_mutate
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_project_item_mutate',
    label: 'GitHub: Mutate Project Item',
    description:
      'Update a GitHub Project v2 item field value — e.g. change its Status column. ' +
      'Uses GraphQL to mutate single-select fields on project items.',
    promptSnippet: "Use gh_project_item_mutate to update a project item's status or other field",
    promptGuidelines: [
      "Use gh_project_item_mutate to change a project item's Status column.",
      "Requires the project number (e.g. 1), the item's content URL (issue/PR URL), or item ID.",
      'Also works with any single-select project field, not just Status.',
    ],
    parameters: Type.Object({
      project: Type.String({ description: 'Project number (e.g. "1")' }),
      url: Type.Optional(
        Type.String({ description: 'Issue or PR URL linked to the project item' }),
      ),
      itemId: Type.Optional(
        Type.String({ description: 'Project item node ID (from GraphQL). Alternative to url.' }),
      ),
      fieldName: Type.Optional(
        Type.String({ default: 'Status', description: 'Field name to mutate (default: "Status")' }),
      ),
      value: Type.String({ description: 'New value for the field (e.g. "In Progress", "Done")' }),
      owner: Type.Optional(
        Type.String({ description: 'Org or user handle (default: repo owner)' }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      let owner = params.owner;
      if (!owner) {
        const repoCheck = await ensureGitHubRepo(pi);
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
            { type: 'text', text: '❌ Could not determine project owner. Pass owner parameter.' },
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
          pi,
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
            pi,
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
              { type: 'text', text: `❌ Project #${projectNum} not found for @${projectOwner}` },
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
              { type: 'text', text: `❌ Field "${fieldName}" not found. Available: ${available}` },
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

            const itemResult = await runGh(pi, args, { parseJson: true });
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

              const itemResult = await runGh(pi, args, { parseJson: true });
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
          pi,
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
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool: gh_project_item_get
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'gh_project_item_get',
    label: 'GitHub: Get Project Item',
    description:
      'Get a GitHub Project v2 item by its linked content URL (issue/PR URL). ' +
      'Returns the item node ID, field values, and content metadata. ' +
      'Useful for finding a project item to mutate its fields.',
    promptSnippet: 'Use gh_project_item_get to find a project item by its linked issue/PR URL',
    promptGuidelines: [
      "Use gh_project_item_get to get a project item's node ID for subsequent mutations.",
      'Pass the issue/PR URL to find its corresponding project item.',
    ],
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
        const repoCheck = await ensureGitHubRepo(pi);
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
            { type: 'text', text: '❌ Could not determine project owner. Pass owner parameter.' },
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

          const result = await runGh(pi, args, { parseJson: true });
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

            const result = await runGh(pi, args, { parseJson: true });

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
  });
}
