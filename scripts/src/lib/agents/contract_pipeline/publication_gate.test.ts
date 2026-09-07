// scripts/src/lib/agents/contract_pipeline/publication_gate.test.ts
import { describe, expect, it } from 'bun:test';
import {
  evaluatePublicationGate,
  formatPublicationBlocks,
  type GitReader,
} from './publication_gate.ts';
import type { RunManifest } from './types.ts';

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);

const gitReader = (overrides: Partial<GitReader> = {}): GitReader => ({
  status: () => '',
  head: () => HEAD,
  branch: () => 'contract-task-c-484-abc',
  remoteHead: () => HEAD,
  ...overrides,
});

const manifestWith = (validation: RunManifest['prePushValidation']): RunManifest =>
  ({ prePushValidation: validation }) as unknown as RunManifest;

const codes = (result: ReturnType<typeof evaluatePublicationGate>): string[] =>
  result.blocks.map((block) => block.code);

describe('evaluatePublicationGate', () => {
  it('allows publication when the tree is clean, validated at HEAD, and pushed', () => {
    const result = evaluatePublicationGate({
      git: gitReader(),
      manifest: manifestWith({ ok: true, output: '', checkedAt: 'now', revision: HEAD }),
    });
    expect(result.ok).toBe(true);
    expect(result.blocks).toEqual([]);
    expect(result.head).toBe(HEAD);
  });

  it('blocks a verdict recorded against an older revision — the C-484 case', () => {
    const result = evaluatePublicationGate({
      git: gitReader(),
      manifest: manifestWith({ ok: true, output: '', checkedAt: 'now', revision: OLDER }),
    });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('stale_validation');
  });

  it('blocks when validation is red at HEAD', () => {
    const result = evaluatePublicationGate({
      git: gitReader(),
      manifest: manifestWith({
        ok: false,
        output: 'client:format',
        checkedAt: 'n',
        revision: HEAD,
      }),
    });
    expect(codes(result)).toEqual(['failed_validation']);
  });

  it('blocks when no verdict was ever recorded', () => {
    const result = evaluatePublicationGate({ git: gitReader(), manifest: undefined });
    expect(codes(result)).toEqual(['never_validated']);
  });

  it('blocks uncommitted changes, which would never reach the PR', () => {
    const result = evaluatePublicationGate({
      git: gitReader({ status: () => ' M apps/frontend/client/src/lib/views/a.svelte\n' }),
      manifest: manifestWith({ ok: true, output: '', checkedAt: 'now', revision: HEAD }),
    });
    expect(codes(result)).toContain('dirty_worktree');
  });

  it('blocks when local commits are not on the remote', () => {
    const result = evaluatePublicationGate({
      git: gitReader({ remoteHead: () => OLDER }),
      manifest: manifestWith({ ok: true, output: '', checkedAt: 'now', revision: HEAD }),
    });
    expect(codes(result)).toEqual(['unpushed_commits']);
  });

  it('blocks when the branch does not exist on the remote at all', () => {
    const result = evaluatePublicationGate({
      git: gitReader({ remoteHead: () => undefined }),
      manifest: manifestWith({ ok: true, output: '', checkedAt: 'now', revision: HEAD }),
    });
    expect(codes(result)).toEqual(['unpushed_commits']);
  });

  it('validates the requested publication branch instead of only the checked-out branch', () => {
    const requestedBranch = 'contract-task-c-484-requested';
    const seenBranches: string[] = [];
    const result = evaluatePublicationGate({
      git: gitReader({
        remoteHead: (branch) => {
          seenBranches.push(branch);
          return branch === requestedBranch ? OLDER : HEAD;
        },
      }),
      manifest: manifestWith({ ok: true, output: '', checkedAt: 'now', revision: HEAD }),
      branch: requestedBranch,
    });
    expect(seenBranches).toEqual([requestedBranch]);
    expect(result.branch).toBe(requestedBranch);
    expect(codes(result)).toEqual(['unpushed_commits']);
  });

  it('allows publication when the requested branch is pushed at validated HEAD', () => {
    const requestedBranch = 'contract-task-c-484-requested';
    const result = evaluatePublicationGate({
      git: gitReader({ remoteHead: (branch) => (branch === requestedBranch ? HEAD : OLDER) }),
      manifest: manifestWith({ ok: true, output: '', checkedAt: 'now', revision: HEAD }),
      branch: requestedBranch,
    });
    expect(result.ok).toBe(true);
    expect(result.branch).toBe(requestedBranch);
  });

  it('reports every unmet precondition in one pass', () => {
    const result = evaluatePublicationGate({
      git: gitReader({ status: () => ' M a.ts\n', remoteHead: () => OLDER }),
      manifest: undefined,
    });
    expect(codes(result)).toEqual(['dirty_worktree', 'never_validated', 'unpushed_commits']);
  });

  it('is indeterminate — and permissive — when git cannot be read', () => {
    const result = evaluatePublicationGate({
      git: gitReader({
        head: () => {
          throw new Error('not a git repository');
        },
      }),
      manifest: undefined,
    });
    expect(result.indeterminate).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('is indeterminate — and permissive — when the remote cannot be read', () => {
    const result = evaluatePublicationGate({
      git: gitReader({
        remoteHead: () => {
          throw new Error('origin unavailable');
        },
      }),
      manifest: undefined,
    });
    expect(result.indeterminate).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('names every block and its remedy in the rendered refusal', () => {
    const result = evaluatePublicationGate({
      git: gitReader({ remoteHead: () => OLDER }),
      manifest: manifestWith({ ok: true, output: '', checkedAt: 'now', revision: OLDER }),
    });
    const text = formatPublicationBlocks(result);
    expect(text).toContain('stale_validation');
    expect(text).toContain('unpushed_commits');
    expect(text).toContain('contract_stage');
  });
});
