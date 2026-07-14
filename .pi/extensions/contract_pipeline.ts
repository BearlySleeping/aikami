// .pi/extensions/contract_pipeline.ts

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
  ReviewDecision,
} from '../../scripts/src/lib/agents/contract_pipeline/types';
import { getJjChangeId, runJj, sanitizeWorkspaceName } from '../../scripts/src/lib/agents/jj';

const MUTATING_GIT_RE =
  /\bgit\s+(?:add|commit|push|merge|rebase|reset|checkout|switch|clean|stash|tag)\b/i;
const MUTATING_SHELL_RE = /(?:^|[;&|]\s*)(?:rm|mv|cp|mkdir|touch|tee)\b|>{1,2}|\bsed\s+-i\b/i;
const DEPLOY_TOOLS = new Set(['firebase_deploy_functions', 'direnv_switch_mode']);

const environment = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing pipeline environment variable: ${name}`);
  }
  return value;
};

const hashContract = (path: string): string =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : '';

const atomicWrite = (options: { path: string; value: unknown }): void => {
  const temporaryPath = `${options.path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(options.value, undefined, 2));
  renameSync(temporaryPath, options.path);
};

const isFileMutationAllowed = (options: {
  role: string;
  inputPath: string;
  contractPath: string;
}): boolean => {
  if (options.role === 'implementer' || options.role === 'verifier' || options.role === 'review') {
    return true;
  }
  // Writer and critic can edit the contract file (docs/contracts/ only).
  if (options.role === 'writer' || options.role === 'critic') {
    const resolvedInput = resolve(options.inputPath);
    const resolvedContract = resolve(options.contractPath);

    if (resolvedInput === resolvedContract) {
      return true;
    }

    const contractFileName = basename(options.contractPath);
    const inputFileName = basename(options.inputPath);
    const contractId = contractFileName.match(/^(C-\d+|MIG-\d+)/)?.[0];

    if (contractId) {
      // Allow the placeholder (C-315.md) or the slugged name (C-315-*.md)
      if (inputFileName === `${contractId}.md` || inputFileName.startsWith(`${contractId}-`)) {
        return true;
      }
    }

    return false;
  }
  return false;
};

/** Register deterministic contract pipeline completion, review, workspace isolation, and role guards. */
export default function contractPipelineExtension(pi: ExtensionAPI): void {
  // ── Workspace lifecycle state ───────────────────────────────
  // The orchestrator provisions the jj workspace and passes its path
  // via CONTRACT_PIPELINE_WORKSPACE_PATH. The extension consumes it —
  // it does NOT provision its own (single source of truth).
  let _wsPath: string | null = process.env.CONTRACT_PIPELINE_WORKSPACE_PATH ?? null;

  pi.on('tool_call', async (event) => {
    const role = process.env.CONTRACT_PIPELINE_ROLE;
    if (!role) {
      return undefined;
    }

    if (DEPLOY_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: `Deployment tool ${event.toolName} is disabled in contract runs.`,
      };
    }

    const workspaceRoot = _wsPath;
    const input = event.input as Record<string, unknown>;
    if (
      (event.toolName === 'write' || event.toolName === 'edit') &&
      typeof input.path === 'string'
    ) {
      const contractPath = environment('CONTRACT_PIPELINE_CONTRACT_PATH');
      if (!isFileMutationAllowed({ role, inputPath: input.path, contractPath })) {
        return {
          block: true,
          reason: `Role ${role} may not mutate ${input.path}.`,
        };
      }
      // Warn if agent accesses root repo paths while workspace is active.
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

    if (event.toolName === 'bash' && typeof input.command === 'string') {
      if (role !== 'review' && MUTATING_GIT_RE.test(input.command)) {
        return { block: true, reason: 'Git mutations are disabled inside contract workers.' };
      }
      if (role === 'writer' && MUTATING_SHELL_RE.test(input.command)) {
        return { block: true, reason: `Mutating shell commands are disabled for ${role}.` };
      }
      // Critic may mutate docs/contracts/ files only (the guard above on
      // write/edit prevents source code mutations, but bash could still
      // mutate files via shell commands).
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
      const runId = environment('CONTRACT_PIPELINE_RUN_ID');
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
            const changeId = getJjChangeId(wsPath);
            const checkpointMsg = `Checkpoint: ${role} stage passed (attempt ${attempt})`;
            runJj(`describe -m "${checkpointMsg}"`, { cwd: wsPath });
            console.log(`📝 Workspace checkpointed: ${changeId}`);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️  Workspace checkpoint failed: ${message}`);
          }
        } else if (params.status === 'failed' || params.status === 'blocked') {
          if (wsPath) {
            try {
              const changeId = getJjChangeId(wsPath);
              console.error(
                `❌ Task failed with change ID: ${changeId}. ` +
                  `Workspace kept for diagnostics at: ${wsPath}`,
              );
              params.findings.push(`Failed workspace change ID: ${changeId} (path: ${wsPath})`);
            } catch {
              console.error(`❌ Task failed. Workspace kept at: ${wsPath}`);
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
    description:
      'Record the user-informed final review decision. Approval is rejected when code changed after independent verification.',
    promptSnippet:
      'Record approve, approve_pr, approve_merge, changes_applied, reject, or blocked for the active contract review',
    parameters: Type.Object({
      decision: StringEnum([
        'approve',
        'approve_pr',
        'approve_merge',
        'changes_applied',
        'reject',
        'blocked',
      ] as const),
      summary: Type.String({ maxLength: 4096 }),
    }),
    async execute(_toolCallId, params) {
      if (environment('CONTRACT_PIPELINE_ROLE') !== 'review') {
        throw new Error('contract_review_decision is only available in the review session.');
      }
      const runId = environment('CONTRACT_PIPELINE_RUN_ID');
      const reviewPath = environment('CONTRACT_PIPELINE_REVIEW_PATH');
      const manifest = readManifest({ runId, cwd: process.cwd() });
      if (!manifest) {
        throw new Error(`Run manifest not found: ${runId}`);
      }
      const fingerprint = captureGitState(process.cwd()).fingerprint;
      const approvingDecisions: ReviewDecision[] = ['approve', 'approve_pr', 'approve_merge'];
      if (
        approvingDecisions.includes(params.decision) &&
        (!manifest.verificationFingerprint || manifest.verificationFingerprint !== fingerprint)
      ) {
        throw new Error(
          'Code changed after verification. Choose changes_applied to request re-verification.',
        );
      }
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
      return {
        content: [{ type: 'text', text: `Review decision recorded: ${params.decision}` }],
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
      'Publish an isolated jj workspace to a remote Git bookmark. ' +
      'Creates a bookmark, pushes to the remote, and cleans up the workspace. ' +
      'After this tool succeeds, call gh_create_pr to create the GitHub PR. ' +
      'Only call after all tests pass.',
    promptSnippet:
      'Use contract_workspace_reconcile to push workspace changes, then call gh_create_pr for the PR.',
    promptGuidelines: [
      'Call after the pipeline task is completely done (all stages passed).',
      'Pushes the workspace change as a remote bookmark (branch).',
      'This tool does NOT create the PR — after it succeeds, call gh_create_pr with the returned headBranch.',
      'Cleans up the workspace directory automatically on success.',
      'If the user approves, use gh_merge_pr to merge. Then jj_sync + jj_new to update the local working copy.',
    ],
    parameters: Type.Object({
      workspacePath: Type.String({
        description: 'Absolute path to the jj workspace directory.',
      }),
      contractId: Type.Optional(
        Type.String({
          description:
            'Contract or task ID used in the bookmark name and PR title. ' +
            'Defaults to the sanitized workspace name or CONTRACT_PIPELINE_RUN_ID.',
        }),
      ),
      baseBranch: Type.Optional(
        Type.String({
          default: 'dev',
          description:
            'Target base branch for the PR (default: "dev"). ' +
            'Use "main" or "master" for production-targeting pipelines.',
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
              text: `❌ Workspace not found: \`${wsPath}\``,
            },
          ],
          isError: true,
          details: {},
        };
      }

      // Phase C: Task Completion — GitHub PR Reconciliation
      let changeId: string;
      try {
        changeId = getJjChangeId(wsPath);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: `❌ Could not read change ID from workspace: ${message}`,
            },
          ],
          isError: true,
          details: {},
        };
      }

      // Derive a safe bookmark name from the contract ID, workspace name,
      // or pipeline run ID. Idempotency guard: if a bookmark with this name
      // already exists on the remote (from a prior partial run), append a
      // timestamp token to avoid non-fast-forward push rejection.
      const contractId =
        params.contractId ?? process.env.CONTRACT_PIPELINE_RUN_ID ?? basename(wsPath);
      const baseBookmark = `contract-task-${sanitizeWorkspaceName(contractId)}`;
      const baseBranch = params.baseBranch ?? 'dev';

      let bookmarkName = baseBookmark;

      // Check if the bookmark already exists on the remote.
      // git ls-remote is used (not jj) because it's a fast read-only check
      // that works from the repo root regardless of workspace state.
      try {
        const remoteCheck = execSync(`git ls-remote --heads origin refs/heads/${baseBookmark}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd,
          timeout: 10000,
        }).trim();
        if (remoteCheck) {
          // Bookmark exists — append a short unique token to avoid collision
          const token = Date.now().toString(36).slice(-6);
          bookmarkName = `${baseBookmark}-${token}`;
          console.log(
            `  ⚠️  Bookmark \`${baseBookmark}\` already exists on remote. Using \`${bookmarkName}\`.`,
          );
        }
      } catch {
        // If we can't check, assume the name is safe and proceed.
        // The subsequent `jj git push` will surface the real error if there is one.
      }

      // Finalize the workspace description
      const finalMsg = `Feat: Completed contract pipeline task — PR as \`${bookmarkName}\` (change: ${changeId})`;
      try {
        runJj(`describe -m "${finalMsg}"`, { cwd: wsPath });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: `❌ Failed to finalize workspace description: ${message}`,
            },
          ],
          isError: true,
          details: {},
        };
      }

      // Step A: Define safe bookmarks — create a jj bookmark pointing at
      // the agent's current working head (@) in the isolated workspace.
      try {
        runJj(`bookmark create ${bookmarkName} -r @`, { cwd: wsPath });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: `❌ Failed to create bookmark \`${bookmarkName}\`: ${message}`,
            },
          ],
          isError: true,
          details: { changeId, bookmarkName },
        };
      }

      // Step B: Push the bookmark to the remote tracked Git repository.
      // Explicit --remote origin prevents headless pipeline hangs when
      // multiple remotes are configured or no default tracking remote is set.
      // The retry/backoff wrapper in runJj handles transient network blips
      // and git lock contention.
      try {
        runJj(`git push --remote origin -b ${bookmarkName}`, { cwd: wsPath });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: [
                `❌ Failed to push bookmark \`${bookmarkName}\` to remote: ${message}`,
                '',
                'The workspace and bookmark have been preserved. Manual push:',
                `  1. cd ${wsPath}`,
                `  2. jj git push -b ${bookmarkName}`,
                `  3. gh pr create --head "${bookmarkName}" --base ${baseBranch}`,
              ].join('\n'),
            },
          ],
          isError: true,
          details: { changeId, bookmarkName, workspacePath: wsPath },
        };
      }

      // Build PR title + body for gh_create_pr delegation.
      // PR creation is delegated to the gh_create_pr tool so the agent
      // can use the full GitHub CLI extension (merge, sync, etc.).
      const prTitle = `Pi Agent Resolution: Contract ${contractId}`;
      const prBody = [
        `## Automated Pull Request`,
        '',
        `- **Contract ID:** \`${contractId}\``,
        `- **Change ID:** \`${changeId}\``,
        `- **Bookmark:** \`${bookmarkName}\``,
        `- **Pipeline Run:** \`${process.env.CONTRACT_PIPELINE_RUN_ID ?? 'unknown'}\``,
        '',
        `Generated by Pi Pipeline. Passes initial staging checks.`,
      ].join('\n');

      // Step C: Teardown — clean up the workspace directory.
      try {
        runJj(`workspace forget ${wsPath}`, { cwd: cwd });
      } catch {
        // Workspace may already be forgotten
      }

      if (existsSync(wsPath)) {
        rmSync(wsPath, { recursive: true, force: true });
      }

      // Reset in-memory state
      _wsPath = null;

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ **Workspace pushed to remote.**`,
              '',
              `**Change ID:** \`${changeId}\``,
              `**Bookmark (branch):** \`${bookmarkName}\``,
              `**Base branch:** \`${baseBranch}\``,
              '',
              `**Next: Call \`gh_create_pr\`** to create the Pull Request:`,
              `  - title: "${prTitle}"`,
              `  - headBranch: "${bookmarkName}"`,
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
              '- **Sync bookmark** with `jj_sync` after merge',
              '- **Move working copy** with `jj_new` to start on updated tip',
            ].join('\n'),
          },
        ],
        details: {
          changeId,
          bookmarkName,
          headBranch: bookmarkName,
          baseBranch,
          prTitle,
          prBody,
          workspacePath: wsPath,
          bookmarkPushed: true,
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
      'Log diagnostic information for a failed workspace. Captures the change ID, ' +
      'log output, and current status. Then cleans up the workspace safely. ' +
      'Use during error recovery (Phase D).',
    promptSnippet: 'Use contract_workspace_log_failure to capture diagnostics before cleanup.',
    promptGuidelines: [
      'Call when a pipeline stage fails or error recovery is needed.',
      'Abandons the change (does NOT delete history) for diagnostic traceability.',
      'Cleans up the workspace directory afterward.',
    ],
    parameters: Type.Object({
      workspacePath: Type.String({
        description: 'Absolute path to the failed jj workspace directory.',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const wsPath = params.workspacePath;
      const cwd = ctx.cwd;

      // Capture diagnostics (log, status, and full diff for post-mortem)
      let changeId: string | null = null;
      let logOutput = '';
      let statusOutput = '';
      let diffOutput = '';

      if (existsSync(wsPath)) {
        try {
          changeId = getJjChangeId(wsPath);
          logOutput = runJj(`log -r @ --no-graph -T 'change_id ++ " " ++ description'`, {
            cwd: wsPath,
          });
          statusOutput = runJj('status', { cwd: wsPath });
          // Post-mortem artifact: full diff of what the agent changed.
          // This lets human supervisors see exactly what code caused the failure
          // without needing to manually reconstruct the workspace.
          if (changeId) {
            try {
              diffOutput = runJj(`diff -r ${changeId}`, { cwd: wsPath });
            } catch {
              diffOutput = '(diff unavailable)';
            }
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logOutput = `Could not read jj diagnostics: ${message}`;
        }
      }

      // Abandon the change (marks as abandoned, keeps history)
      if (changeId) {
        try {
          runJj(`abandon ${changeId}`, { cwd: cwd });
          console.log(`🚫 Abandoned failed change: ${changeId}`);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`⚠️  Could not abandon change ${changeId}: ${message}`);
        }
      }

      // Clean up the workspace directory
      try {
        runJj(`workspace forget ${wsPath}`, { cwd: cwd });
      } catch {
        // May already be forgotten
      }

      if (existsSync(wsPath)) {
        rmSync(wsPath, { recursive: true, force: true });
      }

      // Reset in-memory state
      _wsPath = null;

      const lines = [
        `🚫 **Workspace failure logged**`,
        `Change ID: \`${changeId ?? 'unknown'}\``,
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
        `The change has been abandoned (not deleted) for traceability.`,
        `Workspace directory cleaned up: \`${wsPath}\``,
      ];

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: {
          changeId,
          workspacePath: wsPath,
          abandoned: !!changeId,
        },
      };
    },
  });
}
