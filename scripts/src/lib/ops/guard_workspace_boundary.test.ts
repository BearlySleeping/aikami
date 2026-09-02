// scripts/src/lib/ops/guard_workspace_boundary.test.ts
//
// The boundary decision must block exactly one thing — a pipeline worker
// operating on a repo that is not its worktree — and stay out of the way of
// everyone else. A false block here breaks the pipeline's own recovery path.
import { describe, expect, it } from 'bun:test';
import { isOutsideAgentWorkspace } from './guard_workspace_boundary.ts';

const WORKTREE = '/home/dev/.herdr/worktrees/aikami/contract-task-c-457';
const ROOT = '/home/dev/Development/aikami';

describe('isOutsideAgentWorkspace', () => {
  it('blocks a worker operating on the main checkout', () => {
    expect(
      isOutsideAgentWorkspace({
        workspacePath: WORKTREE,
        role: 'implementer',
        repositoryRoot: ROOT,
      }),
    ).toBe(true);
  });

  it.each(['writer', 'critic', 'implementer', 'verifier'])(
    'blocks the %s role specifically',
    (role) => {
      expect(isOutsideAgentWorkspace({ workspacePath: WORKTREE, role, repositoryRoot: ROOT })).toBe(
        true,
      );
    },
  );

  it('allows a worker inside its own worktree', () => {
    expect(
      isOutsideAgentWorkspace({
        workspacePath: WORKTREE,
        role: 'implementer',
        repositoryRoot: WORKTREE,
      }),
    ).toBe(false);
  });

  // 🔴 herdr_adapter gives the review captain repoRoot as its cwd for a normal
  // review — it creates PRs and pushes contract updates to `main` from there.
  // Blocking it would break the pipeline's escalation path.
  it('allows the review captain in root, by design', () => {
    expect(
      isOutsideAgentWorkspace({ workspacePath: WORKTREE, role: 'review', repositoryRoot: ROOT }),
    ).toBe(false);
  });

  it('allows a human — no pipeline env at all', () => {
    expect(
      isOutsideAgentWorkspace({
        workspacePath: undefined,
        role: undefined,
        repositoryRoot: ROOT,
      }),
    ).toBe(false);
  });

  // The orchestrator runs from the user's shell and legitimately commits the
  // approved contract to root; it carries no workspace path.
  it('allows the orchestrator process itself', () => {
    expect(
      isOutsideAgentWorkspace({
        workspacePath: undefined,
        role: 'implementer',
        repositoryRoot: ROOT,
      }),
    ).toBe(false);
  });

  it('allows when not inside a git repository', () => {
    expect(
      isOutsideAgentWorkspace({
        workspacePath: WORKTREE,
        role: 'implementer',
        repositoryRoot: undefined,
      }),
    ).toBe(false);
  });

  it('treats a trailing slash as the same path, not a violation', () => {
    expect(
      isOutsideAgentWorkspace({
        workspacePath: `${WORKTREE}/`,
        role: 'implementer',
        repositoryRoot: WORKTREE,
      }),
    ).toBe(false);
  });
});
