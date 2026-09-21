// scripts/src/lib/pi/worktree.ts
//
// Bun-side implementations of the worktree bridge commands.

import {
  bootstrapWorktree,
  createWorktree,
  listWorktrees,
  removeWorktree,
} from '../herdr/worktree.ts';
import { optionalBoolean, optionalString, requireString, toArgs } from './args.ts';
import type { PiHandlers } from './types.ts';

export const handlers: PiHandlers = {
  'worktree.list': (payload) => listWorktrees(requireString(toArgs(payload), 'repoRoot')),

  'worktree.create': (payload) => {
    const args = toArgs(payload);
    return createWorktree({
      slug: requireString(args, 'slug'),
      repoRoot: requireString(args, 'repoRoot'),
      branch: optionalString(args, 'branch'),
      base: optionalString(args, 'base'),
      label: optionalString(args, 'label'),
      focus: optionalBoolean(args, 'focus'),
    });
  },

  'worktree.bootstrap': (payload) =>
    bootstrapWorktree({
      checkoutPath: requireString(toArgs(payload), 'checkoutPath'),
      repoRoot: requireString(toArgs(payload), 'repoRoot'),
      install: optionalBoolean(toArgs(payload), 'install'),
      seed: optionalBoolean(toArgs(payload), 'seed'),
    }),

  'worktree.remove': (payload) => {
    const args = toArgs(payload);
    return removeWorktree({
      workspaceId: optionalString(args, 'workspaceId'),
      checkoutPath: optionalString(args, 'checkoutPath'),
      branch: optionalString(args, 'branch'),
      deleteRemoteBranch: optionalBoolean(args, 'deleteRemoteBranch'),
      force: optionalBoolean(args, 'force'),
      repoRoot: requireString(args, 'repoRoot'),
    });
  },
};
