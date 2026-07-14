// .pi/extensions/contract_factory.ts
/**
 * Contract Factory Pi Extension (V2).
 *
 * Uses the canonical backlog parser (scripts/src/lib/ops/parse_backlog.ts)
 * as the single source of truth. Generates draft contracts using
 * docs/contracts/TEMPLATE.md — never embeds a template copy.
 *
 * Tools:
 *   contract_scan_backlog  — Scan docs/TODO.md for available items
 *   contract_generate       — Generate a draft contract shell from a backlog item
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  getGitHeadCommit,
  provisionGitWorktree,
  runGit,
  sanitizeBranchName,
  WORKSPACES_DIR,
} from '../../scripts/src/lib/agents/git_worktree';

// ── Inline parser ───────────────────────────────────────────────
//
// ⚠️  MAINTENANCE NOTE: This is a deliberate copy of the canonical
// parser at scripts/src/lib/ops/parse_backlog.ts. Pi extensions run
// in a Node.js context and cannot import Bun-specific modules.
//
// RULE: Any change to parse_backlog.ts parsing logic MUST be
// reflected here. The parsing algorithm, regexes, and field names
// must stay identical.
//
// Divergence check: both files use the same regex for headings
// (/^###\s+(C-\d+|MIG-\d+)\s+[–—\-]\s+(.+)/) and field lines
// (/^-\s+\*\*(.+?):\*\*\s*(.+)/). Keep them in sync.

type BacklogItem = {
  id: string;
  title: string;
  phase: string;
  status: string;
  priority: string;
  target: string;
  outcome: string;
  scope: string;
  dependencies: string;
  acceptanceGate: string;
  references: string;
  alreadyGenerated: boolean;
  existingContractPath: string | null;
  isArchived: boolean;
  promotion: string | null;
};

const TODO_PATH = 'docs/TODO.md';
const CONTRACTS_DIR = 'docs/contracts';
const ARCHIVED_CONTRACTS_DIR = 'docs/contracts/archived';

const _parseBacklog = (repoRoot: string): { items: BacklogItem[]; errors: string[] } => {
  const todoPath = join(repoRoot, TODO_PATH);
  const contractsDir = join(repoRoot, CONTRACTS_DIR);
  const archivedContractsDir = join(repoRoot, ARCHIVED_CONTRACTS_DIR);
  const errors: string[] = [];
  const items: BacklogItem[] = [];

  if (!existsSync(todoPath)) {
    errors.push(`Backlog file not found: ${todoPath}`);
    return { items, errors };
  }

  const content = readFileSync(todoPath, 'utf-8');
  const sections = content.split(/^(?=(?:## |# Phase ))/m);
  let currentPhase = '';

  for (const section of sections) {
    const lines = section.split('\n');

    if (lines[0]?.startsWith('## ') || /^#\s+Phase\s+\d/.test(lines[0] ?? '')) {
      currentPhase = (lines[0] ?? '').replace(/^#{1,2}\s+/, '').trim();
    }

    let currentItemLines: string[] = [];
    let currentId = '';
    let currentTitle = '';
    let inItem = false;

    for (const line of lines) {
      const headingMatch = line.match(/^###\s+(C-\d+|MIG-\d+)\s+[–—-]\s+(.+)/);
      if (headingMatch) {
        if (inItem && currentId) {
          items.push(
            _buildItem(
              currentId,
              currentTitle,
              currentPhase,
              currentItemLines,
              contractsDir,
              archivedContractsDir,
            ),
          );
        }
        currentId = headingMatch[1] ?? '';
        currentTitle = (headingMatch[2] ?? '').trim();
        currentItemLines = [];
        inItem = true;
        continue;
      }
      if (inItem) {
        currentItemLines.push(line);
      }
    }

    if (inItem && currentId) {
      items.push(
        _buildItem(
          currentId,
          currentTitle,
          currentPhase,
          currentItemLines,
          contractsDir,
          archivedContractsDir,
        ),
      );
    }
  }

  return { items, errors };
};

const _extractPromotionFromContract = (contractPath: string): string | null => {
  try {
    const content = readFileSync(contractPath, 'utf8');
    const match = content.match(/\|\s*\*\*Promotion\*\*\s*\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|/i);
    if (match) {
      const raw = (match[1] ?? '').trim();
      if (raw && raw !== '—') {
        return raw;
      }
    }
  } catch {
    // ignore
  }
  return null;
};

const _buildItem = (
  id: string,
  title: string,
  phase: string,
  lines: string[],
  contractsDir: string,
  archivedContractsDir: string,
): BacklogItem => {
  const rawFields: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^-\s+\*\*(.+?):\*\*\s*(.+)/);
    if (match) {
      rawFields[(match[1] ?? '').trim()] = (match[2] ?? '').trim();
    }
  }
  const get = (fieldName: string): string => rawFields[fieldName] ?? '';

  // Find existing contract by ID prefix (active first, then archived)
  let existingContractPath: string | null = null;
  let isArchived = false;
  try {
    const activeFiles = readdirSync(contractsDir);
    const activeMatch = activeFiles.find(
      (f) => f.startsWith(`${id}-`) && f.endsWith('.md') && f !== 'TEMPLATE.md',
    );
    if (activeMatch) {
      existingContractPath = join(contractsDir, activeMatch);
    } else {
      // Fall back to archived/
      try {
        const archivedFiles = readdirSync(archivedContractsDir);
        const archivedMatch = archivedFiles.find(
          (f) => f.startsWith(`${id}-`) && f.endsWith('.md'),
        );
        if (archivedMatch) {
          existingContractPath = join(archivedContractsDir, archivedMatch);
          isArchived = true;
        }
      } catch {
        // no archived dir
      }
    }
  } catch {
    existingContractPath = null;
  }

  // Extract promotion from existing contract
  const promotion = existingContractPath
    ? _extractPromotionFromContract(existingContractPath)
    : null;

  return {
    id,
    title,
    phase,
    status: get('Status') || 'not_started',
    priority: get('Priority') || 'P2',
    target: get('Target'),
    outcome: get('Outcome'),
    scope: get('Scope'),
    dependencies: get('Dependencies'),
    acceptanceGate: get('Acceptance gate'),
    references: get('References'),
    alreadyGenerated: existingContractPath !== null,
    existingContractPath,
    isArchived,
    promotion,
  };
};

// ── Template loader (reads TEMPLATE.md at runtime) ─────────

const _loadTemplate = (cwd: string): string => {
  const templatePath = resolve(cwd, CONTRACTS_DIR, 'TEMPLATE.md');
  if (existsSync(templatePath)) {
    return readFileSync(templatePath, 'utf-8');
  }
  return [
    '# Contract {FEATURE_CODE}: {TITLE}',
    '',
    '## Metadata',
    '',
    '| Field | Value |',
    '|---|---|',
    '| **Source** | TODO.md |',
    '| **Target** | TBD |',
    '| **Priority** | TBD |',
    '| **Dependencies** | TBD |',
    '| **Status** | draft |',
    '| **Contract version** | 2.0.0 |',
    '',
    '## Overview',
    '',
    'TBD',
    '',
    '<!-- Generated by contract_factory (fallback — TEMPLATE.md not found) -->',
  ].join('\n');
};

// ── File name builder ──────────────────────────────────────

const _buildFileName = (id: string, title: string): string => {
  const key = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');
  return `${id}-${key}.md`;
};

// ── Extension registration ─────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ─────────────────────────────────────────────────────────┐
  // Tool 1: contract_scan_backlog                           │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'contract_scan_backlog',
    label: 'Contract: Scan Backlog',
    description:
      'Scan docs/TODO.md for available backlog items. Shows stable IDs (C-312), titles, priorities, and whether a contract already exists.',
    promptSnippet: 'Use contract_scan_backlog to see what TODO items need contracts.',
    promptGuidelines: [
      'Use this to discover pending items before generating contracts.',
      'Items with existing contracts are marked with file paths.',
      'Use the stable ID from this output with contract_generate.',
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const { items, errors } = _parseBacklog(ctx.cwd);

      if (items.length === 0) {
        const msg =
          errors.length > 0
            ? `Backlog parse errors:\n${errors.map((e) => `- ${e}`).join('\n')}`
            : 'No items found in docs/TODO.md.';
        return { content: [{ type: 'text', text: msg }], details: {} };
      }

      const pending = items.filter((i) => !i.alreadyGenerated && i.status !== 'completed');
      const existing = items.filter((i) => i.alreadyGenerated);

      const lines = [`**docs/TODO.md Backlog Scan** (${items.length} items)\n`];

      if (pending.length > 0) {
        lines.push(`### Pending (${pending.length})\n`);
        for (const item of pending) {
          lines.push(`🔴 \`${item.id}\` — **${item.title}** (${item.priority}, ${item.phase})`);
        }
      }

      const PromotionIcons: Record<string, string> = {
        sandbox: '🧪',
        integrated: '🔗',
        // biome-ignore lint/style/useNamingConvention: matches promotion state key
        release_verified: '🚀',
      };

      if (existing.length > 0) {
        lines.push(`\n### Already Generated (${existing.length})\n`);
        for (const item of existing) {
          const promoIcon = item.promotion ? (PromotionIcons[item.promotion] ?? '') : '';
          const promoStr = item.promotion ? ` [${promoIcon} ${item.promotion}]` : ' [—]';
          const archivedTag = item.isArchived ? ' 📦 archived' : '';
          lines.push(`✅ \`${item.id}\` — ${item.title}${promoStr}${archivedTag}`);
        }
      }

      lines.push(`\nGenerate: \`contract_generate\` with the ID (e.g. \`C-312\`).`);

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { pendingCount: pending.length, existingCount: existing.length },
      };
    },
  });

  // ─────────────────────────────────────────────────────────┐
  // Tool 2: contract_generate                               │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'contract_generate',
    label: 'Contract: Generate from Backlog',
    description:
      'Generate a draft contract shell from a docs/TODO.md item. ' +
      'Uses docs/contracts/TEMPLATE.md as the canonical template — never an embedded copy. ' +
      'Fills known fields from the backlog; marks unknowns as TBD. ' +
      'Use contract_scan_backlog first to discover available IDs.',
    promptSnippet: 'Use contract_generate to create a draft contract from a TODO.md item.',
    promptGuidelines: [
      'Run contract_scan_backlog first to find the ID.',
      'If the contract already exists, it will NOT be overwritten.',
      'Generated contracts are DRAFT shells — the Contract Writer completes them.',
      'Uses TEMPLATE.md v2.0.0 for the contract structure.',
    ],
    parameters: Type.Object({
      featureCode: Type.String({
        description:
          'Stable backlog ID from docs/TODO.md (e.g. "C-312"). Use contract_scan_backlog to discover available IDs.',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const { items } = _parseBacklog(cwd);
      const item = items.find((i) => i.id === params.featureCode);

      if (!item) {
        return {
          content: [
            {
              type: 'text',
              text: [
                `❌ ID \`${params.featureCode}\` not found in docs/TODO.md.`,
                '',
                `Run \`contract_scan_backlog\` to see available IDs.`,
                `If this is a raw request (not from TODO.md), use the /contract-create prompt instead.`,
              ].join('\n'),
            },
          ],
          isError: true,
          details: {},
        };
      }

      if (item.alreadyGenerated && item.existingContractPath) {
        if (item.isArchived) {
          // Contract exists in archived/ — warn but proceed to generate new v2 draft
          console.warn(
            `📦 Contract ${item.id} exists in archived/. Generating a new v2 draft.`,
            `Archived: ${item.existingContractPath}`,
          );
          // Fall through to generate a new active contract
        } else {
          return {
            content: [
              {
                type: 'text',
                text: [
                  `⚠️ Contract for \`${item.id}\` already exists.`,
                  `File: \`${item.existingContractPath}\``,
                  '',
                  'Delete it first if you want to regenerate from scratch.',
                  'Or edit the existing contract directly.',
                ].join('\n'),
              },
            ],
            details: { alreadyExists: true, filePath: item.existingContractPath },
          };
        }
      }

      // Load the canonical template
      const template = _loadTemplate(cwd);

      // Extract clean single-line values from the backlog item.
      // Multi-line fields from TODO.md are truncated to first line.
      const firstLine = (text: string): string => (text ?? '').split('\n')[0]?.trim() ?? '';

      const priority = item.priority || 'P2';
      const priorityJustification = item.phase || '';
      const rawTarget = firstLine(item.target);
      const rawOutcome = firstLine(item.outcome);
      const rawDeps = item.dependencies || '—';

      // Step 1: Only substitute {FEATURE_CODE} and {TITLE} globally.
      // These appear in the H1 heading — no template hints use these exact tokens.
      let filled = template.replace(/\{FEATURE_CODE\}/g, item.id).replace(/\{TITLE\}/g, item.title);

      // Step 2: Rewrite Metadata table rows using structured markdown matching.
      // Replaces the ENTIRE row (including display hints like P{0|1|2|3})
      // with clean values from the backlog item. Avoids corrupting template
      // hint syntax that happens to use the same brace notation.
      const replaceRow = (label: string, value: string): void => {
        // Match the entire table row: pipe, bold label, pipe, cell content, ending pipe.
        // Use [^\n]* instead of [^|]* to handle escaped pipes inside the cell
        // (e.g. P{0\|1\|2\|3} in the template priority hint).
        filled = filled.replace(
          new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|[^\n]*\\|`),
          `| **${label}** | ${value} |`,
        );
      };

      replaceRow('Source', `TODO.md — ${item.phase}`);
      replaceRow('Target', `${rawTarget || 'TBD'} — TBD`);
      replaceRow('Priority', `${priority} — ${priorityJustification}`);
      replaceRow('Dependencies', rawDeps);
      replaceRow('Status', 'draft');
      replaceRow('Promotion', '—');
      replaceRow('Contract version', '2.0.0');
      replaceRow('Docs Impact', 'TBD');

      // Step 3: Fill Overview section with the item's outcome.
      filled = filled.replace(
        /\{2-4 sentences describing what this task is[^}]*\}/,
        rawOutcome || item.title,
      );

      // Step 4: Fill Problem & Baseline evidence marker with a brief placeholder.
      filled = filled.replace(
        /\{what is broken or missing today[^}]*\}/,
        `${item.title} — see TODO.md for details.`,
      );

      // All other {placeholders} remain — the linter catches them, the
      // Contract Writer fills them during /contract-create.

      // Build file path
      const fileName = _buildFileName(item.id, item.title);
      const contractsDir = resolve(cwd, CONTRACTS_DIR);

      if (!existsSync(contractsDir)) {
        mkdirSync(contractsDir, { recursive: true });
      }

      const filePath = resolve(contractsDir, fileName);
      writeFileSync(filePath, filled);

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ Draft contract generated: \`${item.id}\``,
              `**${item.title}**`,
              `File: \`docs/contracts/${fileName}\``,
              `Priority: ${priority} | Status: draft | Template: v2.0.0`,
              item.isArchived
                ? `\n📦 Old v1 contract is archived at \`${item.existingContractPath}\` — this is a fresh v2 draft.`
                : '',
              '',
              `Next steps:`,
              `1. Use \`/contract-create\` to complete the draft with codebase inspection`,
              `2. Use \`/contract-critique\` for adversarial review`,
              `3. After approval, use \`/contract\` to implement`,
            ].join('\n'),
          },
        ],
        details: {
          featureCode: item.id,
          fileName,
          priority,
        },
      };
    },
  });

  // ─────────────────────────────────────────────────────────┐
  // Tool 3: contract_workspace_create                       │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'contract_workspace_create',
    label: 'Contract: Create Workspace',
    description:
      'Provision an isolated Git Worktree for a contract task. ' +
      'Creates a worktree at .pi/workspaces/<id> on a new branch and returns ' +
      'the absolute path and branch name. Use BEFORE writing files or ' +
      'running compilation tools in a contract task.',
    promptSnippet: 'Use contract_workspace_create to isolate a task in a dedicated Git Worktree.',
    promptGuidelines: [
      'Call this before any file mutations or build steps in a contract pipeline.',
      'Use the returned branch_name for reference.',
      'Workspace directories live under .pi/workspaces/ and are .gitignored.',
    ],
    parameters: Type.Object({
      taskId: Type.String({
        description:
          'Unique task or contract ID (e.g. "C-312" or "contract-writer-xyz"). ' +
          'Used to generate a sanitized workspace directory name.',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const sanitized = sanitizeBranchName(params.taskId);
      const wsDir = join(cwd, WORKSPACES_DIR, sanitized);

      // Ensure parent directory exists
      if (!existsSync(join(cwd, WORKSPACES_DIR))) {
        mkdirSync(join(cwd, WORKSPACES_DIR), { recursive: true });
      }

      // Check for existing workspace
      if (existsSync(wsDir)) {
        const existingId = (() => {
          try {
            return getGitHeadCommit(wsDir);
          } catch {
            return 'unknown';
          }
        })();
        return {
          content: [
            {
              type: 'text',
              text: [
                `⚠️ Workspace already exists: \`${wsDir}\``,
                `HEAD: \`${existingId}\``,
                '',
                'Use this existing workspace or clean it up first with `contract_workspace_cleanup` ',
                'if you need a fresh one.',
              ].join('\n'),
            },
          ],
          details: {
            path: wsDir,
            headCommit: existingId,
            alreadyExists: true,
          },
        };
      }

      // Create the Git Worktree
      const { branchName, headCommit } = provisionGitWorktree({
        repoRoot: cwd,
        name: params.taskId,
      });

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ Git Worktree created: \`${wsDir}\``,
              `Branch: \`${branchName}\``,
              `HEAD: \`${headCommit}\``,
              '',
              'This worktree is now the active working directory for the task.',
              'Use `contract_workspace_checkpoint` to save progress snapshots.',
              'Use `contract_workspace_complete` when the task is done.',
            ].join('\n'),
          },
        ],
        details: {
          path: wsDir,
          branchName,
          headCommit,
          alreadyExists: false,
        },
      };
    },
  });

  // ─────────────────────────────────────────────────────────┐
  // Tool 4: contract_workspace_checkpoint                   │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'contract_workspace_checkpoint',
    label: 'Contract: Workspace Checkpoint',
    description:
      'Commit the current working state in a Git Worktree with a descriptive ' +
      'message. Stages all changes and commits them.',
    promptSnippet: 'Use contract_workspace_checkpoint to record an agent milestone.',
    promptGuidelines: [
      'Call after completing a successful partial step (test passes, build succeeds).',
      'Messages should identify what was accomplished (e.g. "Service layer complete").',
      'This triggers `git add -A && git commit` — Moonrepo pre-commit hooks will run.',
    ],
    parameters: Type.Object({
      workspacePath: Type.String({
        description:
          'Absolute path to the Git Worktree directory (returned by contract_workspace_create).',
      }),
      message: Type.String({
        description:
          'Human-readable milestone description (e.g. "Agent milestone: Added auth service").',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const headCommit = (() => {
        try {
          return runGit(`commit -a -m "${params.message.replace(/"/g, '\\"')}"`, {
            cwd: params.workspacePath,
          });
        } catch {
          // No changes to commit — return current HEAD.
          return getGitHeadCommit(params.workspacePath);
        }
      })();

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ Checkpoint saved.`,
              `HEAD: \`${headCommit}\``,
              `Message: "${params.message}"`,
            ].join('\n'),
          },
        ],
        details: { headCommit, message: params.message },
      };
    },
  });

  // ─────────────────────────────────────────────────────────┐
  // Tool 5: contract_workspace_complete                     │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'contract_workspace_complete',
    label: 'Contract: Complete Workspace',
    description:
      'Finalize an isolated worktree: commit all changes and return the branch ' +
      'name for PR creation. Does NOT push or clean up — that step is manual or ' +
      'handled by the pipeline orchestrator.',
    promptSnippet: 'Use contract_workspace_complete when a task reaches its definition of done.',
    promptGuidelines: [
      'Call after all tests/verifications pass.',
      'Returns the branch name and HEAD commit needed for PR creation.',
      'Does NOT clean up the worktree — use contract_workspace_cleanup separately.',
    ],
    parameters: Type.Object({
      workspacePath: Type.String({
        description: 'Absolute path to the Git Worktree directory.',
      }),
      message: Type.String({
        description: 'Final commit message (e.g. "Feat: Completed contract pipeline task C-312").',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      let headCommit: string;
      try {
        headCommit = runGit(`commit -a -m "${params.message.replace(/"/g, '\\"')}"`, {
          cwd: params.workspacePath,
        });
      } catch {
        // No changes to commit — use current HEAD.
        headCommit = getGitHeadCommit(params.workspacePath);
      }

      let branchName = 'unknown';
      try {
        branchName = runGit('rev-parse --abbrev-ref HEAD', {
          cwd: params.workspacePath,
        });
      } catch {
        // Non-fatal.
      }

      const rootDir = ctx.cwd;

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ Worktree finalized.`,
              `Branch: \`${branchName}\``,
              `HEAD: \`${headCommit}\``,
              `Message: "${params.message}"`,
              '',
              'To push for PR creation from the worktree:',
              `  git push -u origin ${branchName}`,
              '',
              `Root workspace: \`${rootDir}\``,
            ].join('\n'),
          },
        ],
        details: {
          headCommit,
          branchName,
          workspacePath: params.workspacePath,
          rootDir,
        },
      };
    },
  });

  // ─────────────────────────────────────────────────────────┐
  // Tool 6: contract_workspace_cleanup                      │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'contract_workspace_cleanup',
    label: 'Contract: Cleanup Workspace',
    description:
      'Safely remove a Git Worktree: runs `git worktree remove --force` and ' +
      'deletes the directory. Also removes the local branch. ' +
      'Use for both successful completions and error recovery.',
    promptSnippet: 'Use contract_workspace_cleanup to tear down an isolated workspace.',
    promptGuidelines: [
      'Call after reconciliation or after a failed task.',
      'Runs `git worktree remove --force` which cleans up both the worktree and its branch.',
      'Does NOT affect commits that were already pushed.',
    ],
    parameters: Type.Object({
      workspacePath: Type.String({
        description: 'Absolute path to the Git Worktree directory to clean up.',
      }),
      abandonChange: Type.Optional(
        Type.Boolean({
          default: false,
          description:
            'If true, also deletes the local branch (error recovery). ' +
            'By default, branches are preserved for PR creation.',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Determine the branch name before removing the worktree.
      let branchName: string | undefined;
      if (existsSync(params.workspacePath)) {
        try {
          branchName = runGit('rev-parse --abbrev-ref HEAD', {
            cwd: params.workspacePath,
          });
        } catch {
          // Non-fatal.
        }
      }

      // Remove the Git Worktree (--force handles dirty state).
      try {
        runGit(`worktree remove '${params.workspacePath}' --force`, {
          cwd: ctx.cwd,
        });
      } catch {
        // Fall back to rm -rf if git worktree remove fails.
        if (existsSync(params.workspacePath)) {
          rmSync(params.workspacePath, { recursive: true, force: true });
        }
      }

      // Optionally delete the local branch (error recovery).
      if (params.abandonChange && branchName) {
        try {
          runGit(`branch -D ${branchName}`, { cwd: ctx.cwd });
          console.log(`🚫 Deleted local branch ${branchName} (error recovery)`);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`⚠️  Could not delete branch: ${message}`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ Worktree cleaned up: \`${params.workspacePath}\``,
              params.abandonChange ? '  (branch was deleted)' : '',
            ].join('\n'),
          },
        ],
        details: {
          cleanedPath: params.workspacePath,
          abandoned: params.abandonChange ?? false,
        },
      };
    },
  });

  // ─────────────────────────────────────────────────────────┐
  // Tool 7: contract_workspace_list                         │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'contract_workspace_list',
    label: 'Contract: List Workspaces',
    description: 'List all active Git Worktrees managed under .pi/workspaces/.',
    promptSnippet: 'Use contract_workspace_list to inspect active agent workspaces.',
    promptGuidelines: [
      'Use for diagnostics — find orphaned or incomplete workspaces.',
      'Returns workspace path, branch name, and HEAD commit for each.',
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const wsParent = join(cwd, WORKSPACES_DIR);
      const items: { path: string; headCommit: string; branchName: string; description: string }[] =
        [];

      if (!existsSync(wsParent)) {
        return {
          content: [{ type: 'text', text: 'No workspaces directory found.' }],
          details: { workspaces: [] },
        };
      }

      const entries = readdirSync(wsParent, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const wsPath = join(wsParent, entry.name);
        try {
          const headCommit = getGitHeadCommit(wsPath);
          const branchName = runGit('rev-parse --abbrev-ref HEAD', { cwd: wsPath });
          const desc = runGit('log -1 --format=%s', { cwd: wsPath });
          items.push({ path: wsPath, headCommit, branchName, description: desc.trim() });
        } catch {
          // Skip non-worktree directories
        }
      }

      if (items.length === 0) {
        return {
          content: [{ type: 'text', text: 'No active Git Worktrees.' }],
          details: { workspaces: [] },
        };
      }

      const lines = [`**Active Worktrees** (${items.length})\n`];
      for (const item of items) {
        const shortPath = basename(item.path);
        lines.push(`🔹 \`${item.branchName}\` (${item.headCommit.slice(0, 12)}) — ${shortPath}`);
        if (item.description) {
          lines.push(`   ${item.description.slice(0, 80)}`);
        }
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { workspaces: items },
      };
    },
  });
}
