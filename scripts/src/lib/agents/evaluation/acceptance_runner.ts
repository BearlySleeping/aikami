// scripts/src/lib/agents/evaluation/acceptance_runner.ts
//
// C-480 AC-1: runs a task's frozen acceptance oracle. `task.acceptance` is
// a function reference captured from the host's task_registry import graph
// — it is never read from, or replaced by, anything inside the sandbox a
// candidate edited. A patch that overwrites a same-named "checker" file
// inside the sandbox has no effect: this module never opens any file in
// the sandbox except through the frozen `task.acceptance(sandboxPath)`
// call the candidate cannot substitute.

import type { AcceptanceOutcome, EvalTask } from './types.ts';

export const runAcceptance = async (options: {
  task: EvalTask;
  sandboxPath: string;
}): Promise<AcceptanceOutcome> => {
  try {
    return await options.task.acceptance(options.sandboxPath);
  } catch (err) {
    return {
      accepted: false,
      diagnostics: `Acceptance check threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
