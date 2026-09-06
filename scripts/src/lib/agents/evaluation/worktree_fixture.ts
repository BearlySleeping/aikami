// scripts/src/lib/agents/evaluation/worktree_fixture.ts
//
// C-480: per-attempt isolation for evaluation tasks. `herdr/worktree.ts`
// (C-472) provisions real git worktrees through a live herdr daemon —
// correct for the contract pipeline, but it would make every offline
// runner test depend on network/herdr availability, defeating "offline
// runner tests" (AC-1) and "bounded enough to reset/replay cheaply" (Edge
// Cases). Evaluation tasks are small, self-contained file sets with no git
// history dependency, so isolation here is a plain temp directory per
// attempt instead — same isolation guarantee (a fresh, disposable
// filesystem tree per attempt), no daemon, no network, cheap to reset.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { EvalTask } from './types.ts';

/** Disposable filesystem seeded for exactly one candidate attempt. */
export type TaskSandbox = {
  readonly path: string;
  readonly cleanup: () => Promise<void>;
};

/** Create a fresh isolated directory seeded with `task.base`. */
export const prepareSandbox = async (task: EvalTask): Promise<TaskSandbox> => {
  const dir = await mkdtemp(join(tmpdir(), `aikami-eval-${task.id}-`));

  for (const [relativePath, content] of Object.entries(task.base)) {
    const fullPath = join(dir, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }

  return {
    path: dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
};
