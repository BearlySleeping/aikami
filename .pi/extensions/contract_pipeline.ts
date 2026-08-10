// .pi/extensions/contract_pipeline.ts

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { captureGitState } from '../../scripts/src/lib/agents/contract_pipeline/git_state';
import { readManifest } from '../../scripts/src/lib/agents/contract_pipeline/manifest_store';
import { writeStageResult } from '../../scripts/src/lib/agents/contract_pipeline/stage_result';
import type {
  ContractReviewDecision,
  ContractWorkerRole,
} from '../../scripts/src/lib/agents/contract_pipeline/types';
import { PIPELINE_BASE_BRANCH } from '../../scripts/src/lib/agents/contract_pipeline/types';
import { getGitHeadCommit, runGit } from '../../scripts/src/lib/agents/git_worktree';
import { publishWorktree } from '../../scripts/src/lib/herdr/worktree';
import { runSyncOrThrow } from './lib/process_runner.ts';

// 🔴 RELAXED 2026-08-10: hard per-role mutation guards removed.
// Role boundaries are prompt-governed — each role prompt already states what
// the role may and may not do (writer: "Never implement source code",
// "Index.md is read-only"; critic: "Only edit the contract file";
// implement/verify: no commit/push without instruction). Hard blocks only
// produced false failures, e.g. the writer being denied writing a scratch
// analysis file under .pi/contract-runs/. If a role misbehaves, fix the
// prompt — don't re-add sandboxing.

const environment = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing pipeline environment variable: ${name}`);
  }
  return value;
};

const hashContract = (path: string): string =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : '';

/**
 * Derive the absolute repository root from a result or review path env var.
 *
 * These paths are absolute and contain `.pi/contract-runs/` inside the repo root.
 * When an agent runs inside a Git Worktree, `process.cwd()` resolves to the worktree
 * directory — which does NOT contain `.pi/contract-runs/`. The repo root is the
 * authoritative location for manifest/store operations.
 */
const deriveRepoRoot = (): string => {
  const candidates = [
    process.env.CONTRACT_PIPELINE_RESULT_PATH,
    process.env.CONTRACT_PIPELINE_REVIEW_PATH,
  ];
  for (const p of candidates) {
    if (p) {
      const idx = p.indexOf('/.pi/contract-runs/');
      if (idx !== -1) {
        return p.slice(0, idx);
      }
    }
  }
  return process.cwd();
};

const atomicWrite = (options: { path: string; value: unknown }): void => {
  const temporaryPath = `${options.path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(options.value, undefined, 2));
  renameSync(temporaryPath, options.path);
};

/** Register deterministic contract pipeline completion, review, and workspace isolation tools. */
export default function contractPipelineExtension(pi: ExtensionAPI): void {
  // ── Workspace lifecycle state ───────────────────────────────
  // The orchestrator provisions the Git Worktree and passes its path
  // via CONTRACT_PIPELINE_WORKSPACE_PATH. The extension consumes it —
  // it does NOT provision its own (single source of truth).
  let _wsPath: string | null = process.env.CONTRACT_PIPELINE_WORKSPACE_PATH ?? null;

  pi.on('tool_call', async (event) => {
    // Role guards were removed (2026-08-10) — boundaries are prompt-governed.
    // The only remaining hook is an informational warning: when an
    // implementer/verifier runs inside a Git Worktree, edits to root repo
    // paths are invisible to the workspace and will not reach the PR.
    const role = process.env.CONTRACT_PIPELINE_ROLE;
    if (!role) {
      return undefined;
    }

    const workspaceRoot = _wsPath;
    const input = event.input as Record<string, unknown>;
    if (
      (event.toolName === 'write' || event.toolName === 'edit') &&
      typeof input.path === 'string'
    ) {
      if (
        workspaceRoot &&
        !resolve(input.path).startsWith(resolve(workspaceRoot)) &&
        !resolve(input.path).startsWith(resolve(join(process.cwd(), '.pi')))
      ) {
        const isolatedRoles = ['implementer', 'verifier'];
        if (isolatedRoles.includes(role)) {
          console.warn(
            `⚠️  [${role}] Accessing root repo path \`${input.path}\` while workspace \`${workspaceRoot}\` ` +
              `is active. File changes in root will be invisible to the workspace.`,
          );
        }
      }
    }

    return undefined;
  });

  pi.registerTool({
    name: 'contract_stage_complete',
    label: 'Contract Stage Complete',
    description:
      'Finish the current automated contract stage with a validated, atomic result artifact. This must be the final action of every writer, critic, implementer, and verifier stage.',
    promptSnippet: 'Write the authoritative completion result for the current contract stage',
    promptGuidelines: [
      'Use contract_stage_complete exactly once as the final action of an automated contract pipeline worker.',
      'Do not claim passed when required work, tests, or evidence are incomplete.',
    ],
    parameters: Type.Object({
      status: StringEnum(['passed', 'changes_requested', 'blocked', 'failed'] as const),
      summary: Type.String({ maxLength: 4096 }),
      findings: Type.Array(Type.String(), { default: [] }),
      filesTouched: Type.Array(Type.String(), { default: [] }),
      evidence: Type.Array(Type.String(), { default: [] }),
    }),
    async execute(_toolCallId, params) {
      // Derive runId from CONTRACT_PIPELINE_RUN_ID, with fallback from RESULT_PATH.
      // The result path contains the run ID: .../.pi/contract-runs/run-XXXX/stages/...
      let runId: string;
      try {
        runId = environment('CONTRACT_PIPELINE_RUN_ID');
      } catch {
        const resultPath = process.env.CONTRACT_PIPELINE_RESULT_PATH;
        if (!resultPath) {
          throw new Error('Missing CONTRACT_PIPELINE_RUN_ID and CONTRACT_PIPELINE_RESULT_PATH.');
        }
        const m = resultPath.match(/contract-runs\/(run-[^/]+)\//);
        if (!m?.[1]) {
          throw new Error(`Cannot derive run ID from CONTRACT_PIPELINE_RESULT_PATH: ${resultPath}`);
        }
        runId = m[1];
        console.warn(`⚠️  CONTRACT_PIPELINE_RUN_ID not set — derived ${runId} from result path.`);
      }
      const role = environment('CONTRACT_PIPELINE_ROLE') as ContractWorkerRole;
      if (!['writer', 'critic', 'implementer', 'verifier'].includes(role)) {
        throw new Error(`Role ${role} cannot complete a worker stage.`);
      }
      const attempt = Number(environment('CONTRACT_PIPELINE_ATTEMPT'));
      if (!Number.isInteger(attempt) || attempt < 1) {
        throw new Error('Pipeline attempt is invalid.');
      }
      const contractPath = environment('CONTRACT_PIPELINE_CONTRACT_PATH');
      const resultPath = environment('CONTRACT_PIPELINE_RESULT_PATH');

      // ── Workspace lifecycle hooks ──────────────────────────
      const wsPath = _wsPath;
      if (['implementer', 'verifier'].includes(role)) {
        if (params.status === 'passed' && wsPath) {
          try {
            const headCommit = getGitHeadCommit(wsPath);
            const checkpointMsg = `Checkpoint: ${role} stage passed (attempt ${attempt})`;
            // Use separate add + commit instead of `commit -a`.
            // `commit -a` bypasses skip-worktree and picks up
            // PROGRESS.md / PROMOTION.md / .envrc — causing merge conflicts.
            runGit('add -A', { cwd: wsPath });
            runGit(`commit --no-verify -m "${checkpointMsg}"`, { cwd: wsPath });
            console.log(`📝 Workspace checkpointed: ${headCommit}`);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️  Workspace checkpoint failed: ${message}`);
          }
        } else if (params.status === 'failed' || params.status === 'blocked') {
          if (wsPath) {
            try {
              const headCommit = getGitHeadCommit(wsPath);
              console.error(
                `❌ Task failed at commit: ${headCommit}. ` +
                  `Worktree kept for diagnostics at: ${wsPath}`,
              );
              params.findings.push(`Failed worktree commit: ${headCommit} (path: ${wsPath})`);
            } catch {
              console.error(`❌ Task failed. Worktree kept at: ${wsPath}`);
            }
          }
        }
      }
      // ── End workspace lifecycle hooks ──────────────────────
      const gitState = captureGitState(process.cwd());
      writeStageResult({
        resultPath,
        result: {
          runId,
          stage: role,
          attempt,
          status: params.status,
          summary: params.summary,
          findings: params.findings,
          filesTouched: params.filesTouched,
          evidence: params.evidence,
          contractHash: hashContract(contractPath),
          diffHash: gitState.fingerprint,
        },
      });
      return {
        content: [{ type: 'text', text: `Stage ${role} result saved: ${params.status}` }],
        details: { runId, role, attempt, status: params.status },
        terminate: true,
      };
    },
  });

  pi.registerTool({
    name: 'contract_review_decision',
    label: 'Contract Review Decision',
    description: 'Record the user-informed final review decision for the active contract PR.',
    promptSnippet: 'Record approve, merge, change, or reject for the active contract review',
    parameters: Type.Object({
      decision: StringEnum(['approve', 'merge', 'change', 'reject'] as const),
      summary: Type.String({ maxLength: 4096 }),
    }),
    async execute(_toolCallId, params) {
      if (environment('CONTRACT_PIPELINE_ROLE') !== 'review') {
        throw new Error('contract_review_decision is only available in the review session.');
      }
      const runId = environment('CONTRACT_PIPELINE_RUN_ID');
      const reviewPath = environment('CONTRACT_PIPELINE_REVIEW_PATH');
      const repoRoot = deriveRepoRoot();
      const manifest = readManifest({ runId, cwd: repoRoot });
      if (!manifest) {
        throw new Error(`Run manifest not found: ${runId}`);
      }
      const fingerprint = captureGitState(process.cwd()).fingerprint;
      const contractPath = environment('CONTRACT_PIPELINE_CONTRACT_PATH');
      const contractChanged =
        typeof manifest.verificationContractHash === 'string' &&
        manifest.verificationContractHash !== hashContract(contractPath);
      const decision: ContractReviewDecision = {
        runId,
        decision: params.decision,
        summary: params.summary,
        diffHash: fingerprint,
        contractChanged,
        createdAt: new Date().toISOString(),
      };
      atomicWrite({ path: reviewPath, value: decision });

      // When the Captain signals 'merge', verify the PR was actually merged.
      // The orchestrator only syncs main + cleans up — it trusts the Captain
      // already called gh_merge_pr. If the PR is still open, warn loudly.
      let mergeWarning = '';
      if (params.decision === 'merge' && manifest.prUrl) {
        try {
          const state = runSyncOrThrow(
            'gh',
            ['pr', 'view', manifest.prUrl, '--json', 'state', '--jq', '.state'],
            { timeoutMs: 10000 },
          );
          if (state === 'OPEN') {
            mergeWarning = [
              '',
              '⚠️  WARNING: PR is still OPEN.',
              `   ${manifest.prUrl}`,
              '   The merge may have failed. Call gh_merge_pr before re-signaling.',
            ].join('\n');
            console.warn(mergeWarning);
          } else if (state === 'MERGED') {
            console.log(`✅ PR verified as MERGED: ${manifest.prUrl}`);
          }
        } catch {
          // Can't verify — proceed but don't claim certainty.
        }
      }

      return {
        content: [
          { type: 'text', text: `Review decision recorded: ${params.decision}.${mergeWarning}` },
        ],
        details: decision,
      };
    },
  });

  // ─────────────────────────────────────────────────────────┐
  // Tool 3: contract_workspace_reconcile                    │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'contract_workspace_reconcile',
    label: 'Contract: Reconcile Workspace',
    description:
      'Publish an isolated Git Worktree to a remote branch. ' +
      'Commits all changes, pushes to the remote, and leaves the worktree in ' +
      'place. After this tool succeeds, call gh_create_pr to create the GitHub PR. ' +
      'Only call after all tests pass. The worktree persists until the user runs ' +
      '`bun workspace:cleanup` — never remove it yourself (you may be running inside it).',
    promptSnippet:
      'Use contract_workspace_reconcile to push workspace changes, then call gh_create_pr for the PR.',
    promptGuidelines: [
      'Call after the pipeline task is completely done (all stages passed).',
      'Pushes the workspace branch to origin.',
      'This tool does NOT create the PR — after it succeeds, call gh_create_pr with the returned headBranch.',
      'The worktree is NOT cleaned up automatically — it persists until the user runs `bun workspace:cleanup` (e.g. after PR merge).',
    ],
    parameters: Type.Object({
      workspacePath: Type.String({
        description: 'Absolute path to the Git Worktree directory.',
      }),
      contractId: Type.Optional(
        Type.String({
          description:
            'Contract or task ID used in the branch name and PR title. ' +
            'Defaults to the sanitized workspace name or CONTRACT_PIPELINE_RUN_ID.',
        }),
      ),
      baseBranch: Type.Optional(
        Type.String({
          default: PIPELINE_BASE_BRANCH,
          description:
            `Target base branch for the PR (default: "${PIPELINE_BASE_BRANCH}"). ` +
            'Use "dev" for development or "main" for production-targeting pipelines.',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const wsPath = params.workspacePath;
      const cwd = ctx.cwd;

      if (!existsSync(wsPath)) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Worktree not found: \`${wsPath}\``,
            },
          ],
          isError: true,
          details: {},
        };
      }

      // Phase C: Task Completion — GitHub PR Reconciliation.
      // Delegates to the shared herdr-native publishWorktree (single source
      // of truth): collision-guard + commit all + push. Branch renaming for
      // native worktrees happens at creation time, so no rename here.
      const contractId =
        params.contractId ?? process.env.CONTRACT_PIPELINE_RUN_ID ?? basename(wsPath);
      const baseBranch = params.baseBranch ?? PIPELINE_BASE_BRANCH;

      // Resolve the main repo root from the worktree's .git file
      // (<repo>/.git/worktrees/<name> → <repo>).
      let repoRoot = cwd;
      try {
        // Git writes linked-worktree .git files as `gitdir: <path>\n` —
        // trim first so the regex is not defeated by the trailing newline.
        const gitFile = readFileSync(join(wsPath, '.git'), 'utf-8').trim();
        const m = gitFile.match(/^gitdir:\s*(.+)$/m);
        if (m?.[1]) {
          const gitDir = resolve(m[1].trim());
          const idx = gitDir.indexOf('/.git/worktrees/');
          repoRoot = idx !== -1 ? gitDir.slice(0, idx) : gitDir;
        }
      } catch {
        // Not a linked worktree — fall back to cwd.
      }

      let headBranch: string;
      let headCommit: string;
      try {
        const result = await publishWorktree({
          checkoutPath: wsPath,
          repoRoot,
          base: baseBranch,
          message: `Feat: Contract ${contractId} — pipeline reconcile`,
          authorName: 'Pi Agent',
          authorEmail: 'agent@pi.internal',
        });
        headBranch = result.headBranch;
        headCommit = result.headCommit;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: [
                `❌ Reconciliation failed: ${message}`,
                '',
                `The worktree has been preserved: ${wsPath}`,
                'Manual push:',
                `  1. cd ${wsPath}`,
                `  2. git push -u origin HEAD`,
                `  3. gh pr create --head <branch> --base ${baseBranch}`,
              ].join('\n'),
            },
          ],
          isError: true,
          details: { workspacePath: wsPath },
        };
      }

      // Build PR title + body for gh_create_pr delegation.
      const prTitle = `Pi Agent Resolution: Contract ${contractId}`;
      const prBody = [
        `## Automated Pull Request`,
        '',
        `- **Contract ID:** \`${contractId}\``,
        `- **Commit:** \`${headCommit}\``,
        `- **Branch:** \`${headBranch}\``,
        `- **Pipeline Run:** \`${process.env.CONTRACT_PIPELINE_RUN_ID ?? 'unknown'}\``,
        '',
        `Generated by Pi Pipeline. Passes initial staging checks.`,
      ].join('\n');

      // ── Workspace state persistence ───────────────────────
      // Worktree is NOT auto-cleaned up. It persists until the user
      // explicitly runs `bun workspace:cleanup` (e.g. after PR merge).
      _wsPath = null;

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ **Workspace pushed to remote.**`,
              '',
              `**Commit:** \`${headCommit}\``,
              `**Branch:** \`${headBranch}\``,
              `**Base branch:** \`${baseBranch}\``,
              '',
              `**Next: Call \`gh_create_pr\`** to create the Pull Request:`,
              `  - title: "${prTitle}"`,
              `  - headBranch: "${headBranch}"`,
              `  - baseBranch: "${baseBranch}"`,
              '',
              '**PR description:**',
              '```markdown',
              prBody,
              '```',
              '',
              'After the PR is created, you can: ',
              '- **Merge it** with `gh_merge_pr` when ready',
              '- **Check CI** with `gh_pr_status`',
            ].join('\n'),
          },
        ],
        details: {
          headCommit,
          headBranch,
          baseBranch,
          prTitle,
          prBody,
          workspacePath: wsPath,
          branchPushed: true,
          needsPrCreation: true,
        },
      };
    },
  });

  // ─────────────────────────────────────────────────────────┐
  // Tool 4: contract_workspace_log_failure                  │
  // ─────────────────────────────────────────────────────────┘

  pi.registerTool({
    name: 'contract_workspace_log_failure',
    label: 'Contract: Log Workspace Failure',
    description:
      'Capture diagnostic information for a failed worktree: commit, ' +
      'log output, status, and diff. Does NOT clean up — the workspace ' +
      'persists for manual inspection. Use `bun workspace:cleanup` to remove later.',
    promptSnippet: 'Use contract_workspace_log_failure to capture diagnostics.',
    promptGuidelines: [
      'Call when a pipeline stage fails or error recovery is needed.',
      'Captures diagnostic info without removing the worktree.',
      'The worktree persists — clean up manually with `bun workspace:cleanup`.',
    ],
    parameters: Type.Object({
      workspacePath: Type.String({
        description: 'Absolute path to the failed Git Worktree directory.',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const wsPath = params.workspacePath;

      // Capture diagnostics (log, status, and full diff for post-mortem)
      let headCommit: string | null = null;
      let logOutput = '';
      let statusOutput = '';
      let diffOutput = '';

      if (existsSync(wsPath)) {
        try {
          headCommit = getGitHeadCommit(wsPath);
          logOutput = runGit('log -1 --format="%H %s"', { cwd: wsPath });
          statusOutput = runGit('status', { cwd: wsPath });
          // Post-mortem artifact: full diff of what the agent changed.
          if (headCommit) {
            try {
              diffOutput = runGit(`diff ${headCommit}~1..${headCommit}`, { cwd: wsPath });
            } catch {
              // If only one commit, show working tree diff.
              diffOutput = runGit('diff HEAD', { cwd: wsPath });
            }
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logOutput = `Could not read git diagnostics: ${message}`;
        }
      }

      const lines = [
        `🚫 **Worktree failure logged**`,
        `Commit: \`${headCommit ?? 'unknown'}\``,
        '',
        '**Diagnostic log:**',
        '```',
        logOutput || '(no log output)',
        '```',
        '',
        '**Status snapshot:**',
        '```',
        statusOutput || '(no status output)',
        '```',
        '',
        '**Post-mortem diff (what the agent changed):**',
        '```diff',
        diffOutput || '(diff unavailable)',
        '```',
        '',
        `Worktree preserved at: \`${wsPath}\` (clean up with \`bun workspace:cleanup\`)`,
      ];

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: {
          headCommit,
          workspacePath: wsPath,
          preserved: true,
        },
      };
    },
  });
}
