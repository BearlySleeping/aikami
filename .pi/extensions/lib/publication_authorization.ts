// .pi/extensions/lib/publication_authorization.ts
//
// The `authorizePublication` action of the `contract_stage` namespace.
//
// 🔴 Extracted from contract_pipeline.ts to keep that module under the
// source-file-size hard limit. Behaviour is unchanged — the action is a
// factory here purely so it can close over the extension's session state
// (workspace path fallback, run-ID derivation) without importing it.

import { existsSync } from 'node:fs';
import { Type } from 'typebox';
import type { RunManifest } from '../../../scripts/src/lib/agents/contract_pipeline/types';
import { runPiScript } from './bridge.ts';
import { defineAction, type NamespaceAction } from './tool_namespace.ts';

/** Publication-gate verdict as returned by the `contract.publication.evaluate` bridge command. */
export type PublicationSummary = {
  outcome: 'passed' | 'failed' | 'unavailable' | 'cancelled';
  ok: boolean;
  authorized: boolean;
  head?: string;
  branch?: string;
  blocks: string[];
  warnings: string[];
  refusal: string;
  warning?: string;
};

export type AuthorizePublicationDeps = {
  /** Worktree path recorded on the extension's session state. */
  fallbackWorkspacePath: () => string | null;
  /** Resolves the current run ID (env var, with result-path fallback). */
  resolveRunId: () => string;
};

export const createAuthorizePublicationAction = (deps: AuthorizePublicationDeps): NamespaceAction =>
  defineAction({
    action: 'authorizePublication',
    summary:
      'Record explicit user authorization to publish a non-green revision (binds outcome + commit)',
    parameters: Type.Object({
      grantedBy: Type.Optional(
        Type.String({
          description: 'Who granted the authorization (default: "user"). Recorded on the manifest.',
          minLength: 1,
          pattern: '\\S',
        }),
      ),
      workspacePath: Type.Optional(
        Type.String({
          description:
            'Absolute path to the Git Worktree. Defaults to CONTRACT_PIPELINE_WORKSPACE_PATH.',
        }),
      ),
    }),
    // 🔴 The ONLY sanctioned way to publish a non-green verdict. It records
    // a revision-bound authorization (outcome + exact HEAD) so `gh_pr create`
    // can honor THIS commit's red verdict and nothing else. Get explicit
    // user permission BEFORE calling — the name is the affirmation of that.
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const wsPath =
        params.workspacePath ??
        process.env.CONTRACT_PIPELINE_WORKSPACE_PATH ??
        deps.fallbackWorkspacePath();
      if (!wsPath || !existsSync(wsPath)) {
        return {
          content: [{ type: 'text', text: `❌ Worktree not found: \`${wsPath ?? 'unset'}\`` }],
          isError: true,
          details: {},
        };
      }
      const repoRoot = await runPiScript<string>('contract.runRepoRoot', {});
      const runId = deps.resolveRunId();
      const manifest = await runPiScript<RunManifest | null>('contract.manifest.read', {
        runId,
        repoRoot,
      });
      if (!manifest?.prePushValidation) {
        return {
          content: [
            {
              type: 'text',
              text: '❌ No validation verdict is recorded. Run `contract_stage` action `validate` first.',
            },
          ],
          isError: true,
          details: {},
        };
      }
      const validationOutcome =
        manifest.prePushValidation.outcome ?? (manifest.prePushValidation.ok ? 'passed' : 'failed');
      if (validationOutcome === 'passed') {
        return {
          content: [
            {
              type: 'text',
              text: '✅ Validation is already green on this revision — no authorization is needed.',
            },
          ],
          isError: false,
          details: { authorized: false },
        };
      }
      const head = await runPiScript<string>('git.headCommit', { cwd: wsPath });
      if (head !== manifest.prePushValidation.revision) {
        return {
          content: [
            {
              type: 'text',
              text: [
                '❌ The recorded verdict is stale for this revision.',
                '',
                `Verdict covers \`${manifest.prePushValidation.revision.slice(0, 12)}\`, ` +
                  `but HEAD is \`${head.slice(0, 12)}\`.`,
                'Run `contract_stage` action `validate` and authorize the new verdict.',
              ].join('\n'),
            },
          ],
          isError: true,
          details: {},
        };
      }
      const status = await runPiScript<string>('git.run', {
        command: 'status --porcelain',
        cwd: wsPath,
      });
      if (status.trim().length > 0) {
        return {
          content: [
            {
              type: 'text',
              text: '❌ The worktree has uncommitted changes. Validate and commit them before authorizing publication.',
            },
          ],
          isError: true,
          details: {},
        };
      }
      manifest.publicationAuthorization = {
        outcome: validationOutcome,
        revision: head,
        grantedBy: params.grantedBy ?? 'user',
        grantedAt: new Date().toISOString(),
      };
      await runPiScript('contract.manifest.write', { manifest, repoRoot });
      const authorizedHead = await runPiScript<string>('git.headCommit', { cwd: wsPath });
      if (authorizedHead !== manifest.publicationAuthorization.revision) {
        return {
          content: [
            {
              type: 'text',
              text: '❌ HEAD changed while publication was being authorized. Validate and authorize the new revision.',
            },
          ],
          isError: true,
          details: {},
        };
      }
      const authorizedStatus = await runPiScript<string>('git.run', {
        command: 'status --porcelain',
        cwd: wsPath,
      });
      if (authorizedStatus.trim().length > 0) {
        return {
          content: [
            {
              type: 'text',
              text: '❌ The worktree changed while publication was being authorized. Validate and authorize the current tree.',
            },
          ],
          isError: true,
          details: {},
        };
      }
      const branchName = await runPiScript<string>('git.run', {
        command: 'rev-parse --abbrev-ref HEAD',
        cwd: wsPath,
      });
      try {
        await runPiScript('git.pushBranch', { cwd: wsPath, branchName });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            { type: 'text', text: `❌ Authorization recorded, but push failed: ${message}` },
          ],
          isError: true,
          details: { authorized: true, revision: head },
        };
      }
      const publication = await runPiScript<PublicationSummary>('contract.publication.evaluate', {
        workspacePath: wsPath,
        runId,
      });
      return {
        content: [
          {
            type: 'text',
            text: publication.ok
              ? `⚠️  Authorization recorded and revision \`${head.slice(0, 12)}\` pushed — \`gh_pr create\` is now unblocked. CI will repeat the non-green result on the PR.`
              : `❌ Authorization recorded, but the gate still blocks:\n\n${publication.refusal}`,
          },
        ],
        isError: !publication.ok,
        details: { authorized: true, revision: head },
      };
    },
  });
