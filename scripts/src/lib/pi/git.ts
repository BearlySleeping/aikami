// scripts/src/lib/pi/git.ts
//
// Bun-side implementations of the git bridge commands.

import {
  commitAll,
  getGitHeadCommit,
  pushBranch,
  runGit,
  sanitizeBranchName,
} from '../agents/git_worktree.ts';
import { optionalString, requireString, toArgs } from './args.ts';
import type { PiHandlers } from './types.ts';

export const handlers: PiHandlers = {
  'git.run': (payload) => {
    const args = toArgs(payload);
    return runGit(requireString(args, 'command'), { cwd: requireString(args, 'cwd') });
  },

  'git.sanitizeBranch': (payload) => sanitizeBranchName(requireString(toArgs(payload), 'raw')),

  'git.headCommit': (payload) => getGitHeadCommit(requireString(toArgs(payload), 'cwd')),

  'git.commitAll': (payload) => {
    const args = toArgs(payload);
    return commitAll({
      cwd: requireString(args, 'cwd'),
      message: requireString(args, 'message'),
      authorName: optionalString(args, 'authorName'),
      authorEmail: optionalString(args, 'authorEmail'),
    });
  },

  'git.pushBranch': (payload) => {
    const args = toArgs(payload);
    pushBranch({ cwd: requireString(args, 'cwd'), branchName: requireString(args, 'branchName') });
    return null;
  },
};
