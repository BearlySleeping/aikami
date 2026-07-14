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

  // Review summary
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
      draft: Type.Optional(Type.Boolean({ default: false, description: 'Create as draft PR' })),
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
}
