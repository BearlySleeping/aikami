// .pi/extensions/github_cli.ts
//
// GitHub CLI integration for pi — PR management, merge, sync.
// Uses `gh` (v2.96+) from nixpkgs. All tools run via pi.exec for
// cancellation safety and consistent timeout handling.
//
// Registered tools:
//   gh_create_pr      — Create a PR (default base: dev)
//   gh_list_prs       — List open PRs
//   gh_summarize_pr   — View + summarize a PR
//   gh_pr_status      — Show CI checks status for a PR
//   gh_merge_pr       — Merge a PR (default: squash)
//   gh_cancel_pr      — Close a PR without merging
//   gh_edit_pr        — Edit PR title/body/base/labels
//
// For jj bookmark sync / working copy management, see jujutsu.ts.

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_BASE = 'dev';

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
  if (urlMatch) return urlMatch[1];

  // If it's purely numeric, it's a PR number
  if (/^\d+$/.test(raw)) return raw;

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
    cwd: opts?.cwd,
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

// ── Formatters ──────────────────────────────────────────────────────────────

/** Format a list of PRs from gh JSON output. */
function formatPrList(prs: Array<Record<string, unknown>>): string {
  if (prs.length === 0) return 'No pull requests found.';

  const lines: string[] = [];
  for (const pr of prs) {
    const number = String(pr.number ?? '?');
    const title = String(pr.title ?? '');
    const head = String(pr.headRefName ?? '?');
    const base = String(pr.baseRefName ?? '?');
    const state = String(pr.state ?? '?');
    const url = String(pr.url ?? '');
    const author = pr.author && typeof pr.author === 'object'
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
  const author = data.author && typeof data.author === 'object'
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

  if (mergedAt) lines.push(`**Merged:** ${mergedAt}`);
  if (closedAt && !mergedAt) lines.push(`**Closed:** ${closedAt}`);
  if (labels) lines.push(`**Labels:** ${labels}`);

  // Review summary
  if (reviews.length > 0) {
    const reviewSummary = reviews.map((r) => {
      const rState = String(r.state ?? '?');
      const rAuthor = r.author && typeof r.author === 'object'
        ? String((r.author as Record<string, unknown>).login ?? '?')
        : '?';
      return `@${rAuthor}: ${rState}`;
    }).join(', ');
    lines.push(`**Reviews:** ${reviewSummary}`);
  }

  if (comments.length > 0) {
    lines.push(`**Comments:** ${comments.length}`);
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
    if (files.length > 20) lines.push(`  ... and ${files.length - 20} more`);
  }

  if (body) {
    lines.push('', `**Description:**`, body);
  }

  return lines.join('\n');
}

/** Format CI check status. */
function formatCheckStatus(raw: string): string {
  if (!raw.trim()) return 'No CI checks found for this PR.';

  const lines = raw.split('\n');
  const statusLines: string[] = [];
  let passCount = 0;
  let failCount = 0;
  let pendingCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
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
    promptSnippet: 'Use gh_create_pr to create a GitHub PR (default base: dev)',
    promptGuidelines: [
      'Use gh_create_pr when the user asks to create a pull request.',
      'The default base branch is "dev". Use baseBranch to override.',
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
      draft: Type.Optional(
        Type.Boolean({ default: false, description: 'Create as draft PR' }),
      ),
      web: Type.Optional(
        Type.Boolean({ default: false, description: 'Open PR in browser after creation' }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const repoCheck = await ensureGitHubRepo(pi);
      if (!repoCheck.ok) {
        return {
          content: [{ type: 'text', text: `❌ ${repoCheck.reason}` }],
          isError: true,
          details: {},
        };
      }

      const base = params.baseBranch ?? DEFAULT_BASE;
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

      if (params.body) {
        args.push('--body', params.body);
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
              '',
              `You can merge this PR with: \`gh_merge_pr("${prUrl}")\``,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
        details: {
          prUrl,
          title: params.title,
          headBranch: params.headBranch,
          baseBranch: base,
          draft: params.draft ?? false,
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
      label: Type.Optional(
        Type.String({ description: 'Filter by label' }),
      ),
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

      if (params.base) args.push('--base', params.base);
      if (params.author) args.push('--author', params.author);
      if (params.label) args.push('--label', params.label);

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
        details: { count: prs.length, state, prs: prs.map((p) => ({ number: p.number, title: p.title, url: p.url })) },
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
      'author, reviews, changed files, and comment count. ' +
      'Accepts PR number, URL, or branch name.',
    promptSnippet: 'Use gh_summarize_pr to get the full summary of a GitHub PR',
    promptGuidelines: [
      'Use gh_summarize_pr to review a PR before merging or when the user asks about a PR.',
      'Pass the PR number, URL, or branch name.',
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
            'number', 'title', 'body', 'state', 'url', 'headRefName', 'baseRefName',
            'author', 'createdAt', 'mergedAt', 'closedAt', 'labels',
            'assignees', 'reviews', 'comments', 'additions', 'deletions', 'files',
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

      if (params.watch) args.push('--watch');

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
      'Offer to run jj_sync (or jj_new) after a successful merge to update the local bookmark.',
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

      if (params.autoMerge) args.push('--auto');
      if (params.deleteBranch) args.push('--delete-branch');

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

      if (params.deleteBranch) args.push('--delete-branch');

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
      title: Type.Optional(
        Type.String({ description: 'New PR title' }),
      ),
      body: Type.Optional(
        Type.String({ description: 'New PR description (markdown)' }),
      ),
      baseBranch: Type.Optional(
        Type.String({ description: 'New target base branch' }),
      ),
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

}
