// scripts/src/lib/pi/herdr.test.ts
//
// `herdr.worktree.openPr` is the bridge command behind the `task_pr` pi tool —
// a PR-opening path with no publication gate. These tests pin the one thing
// that must never happen: a contract-pipeline worker using it to publish
// around the gate `gh_pr create` enforces.

import { afterEach, describe, expect, test } from 'bun:test';
import { handlers } from './herdr.ts';

const savedRole = process.env.CONTRACT_PIPELINE_ROLE;

const setRole = (role: string | undefined): void => {
  if (role === undefined) {
    delete process.env.CONTRACT_PIPELINE_ROLE;
  } else {
    process.env.CONTRACT_PIPELINE_ROLE = role;
  }
};

afterEach(() => {
  setRole(savedRole);
});

describe('herdr.worktree.openPr publication guard', () => {
  test('refuses inside a contract-pipeline worker, naming the gated path', () => {
    setRole('review');
    // The guard runs BEFORE any gh invocation, so this never shells out.
    expect(() =>
      handlers['herdr.worktree.openPr']?.({
        headBranch: 'task/x',
        base: 'main',
        title: 't',
      }),
    ).toThrow(/publication gate/);
  });

  test('refuses for every pipeline role, not just review', () => {
    for (const role of ['implementer', 'verifier', 'writer', 'critic']) {
      setRole(role);
      expect(() =>
        handlers['herdr.worktree.openPr']?.({
          headBranch: 'task/x',
          base: 'main',
          title: 't',
        }),
      ).toThrow(/gh_pr/);
    }
  });

  test('does not refuse outside a pipeline worker', () => {
    setRole(undefined);
    // No PR is created: the guard passes and the handler fails later on the
    // missing required field, which is proof the guard itself did not throw.
    expect(() => handlers['herdr.worktree.openPr']?.({ base: 'main' })).toThrow(
      /headBranch|Missing|required/i,
    );
  });
});
