#!/usr/bin/env bun

// scripts/src/workspace_cleanup.ts
//
// User-controlled workspace cleanup. Run explicitly when:
//   - A PR has been merged (the branch is on origin — safe to delete)
//   - A failed workspace needs manual pruning
//   - You want to list active workspaces without cleaning
//
// Usage:
//   bun run workspace:cleanup                list workspaces
//   bun run workspace:cleanup --all          clean up ALL workspaces
//   bun run workspace:cleanup <path>         clean a specific workspace
//   bun run workspace:cleanup --pr-merged    clean workspaces whose branch has a merged PR

import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const WORKSPACES_DIR = '.pi/workspaces';

const runGit = (command: string, cwd: string): string => {
  try {
    return execSync(`git ${command}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      timeout: 10000,
    }).trim();
  } catch {
    return '';
  }
};

type WorkspaceInfo = {
  path: string;
  branchName: string;
  headCommit: string;
  description: string;
  prMerged: boolean;
};

const listWorkspaces = (): WorkspaceInfo[] => {
  const wsParent = join(process.cwd(), WORKSPACES_DIR);
  if (!existsSync(wsParent)) {
    return [];
  }

  const items: WorkspaceInfo[] = [];
  const entries = readdirSync(wsParent, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const wsPath = join(wsParent, entry.name);
    try {
      const headCommit = runGit('rev-parse HEAD', wsPath);
      if (!headCommit) {
        continue;
      }
      const branchName = runGit('rev-parse --abbrev-ref HEAD', wsPath);
      const desc = runGit('log -1 --format=%s', wsPath);

      // Check if this branch has a merged PR
      let prMerged = false;
      try {
        const prList = execSync(
          `gh pr list --head "${branchName}" --state merged --json number --jq 'length'`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
        ).trim();
        prMerged = prList !== '0' && prList !== '';
      } catch {
        // gh CLI may not be available — assume not merged
      }

      items.push({
        path: wsPath,
        branchName,
        headCommit: headCommit.slice(0, 12),
        description: desc.trim(),
        prMerged,
      });
    } catch {
      // Skip non-worktree directories
    }
  }
  return items;
};

const cleanupWorkspace = (ws: WorkspaceInfo): void => {
  console.log(`🧹 Cleaning up: ${ws.path} (branch: ${ws.branchName})`);
  try {
    runGit(`worktree remove '${ws.path}' --force`, process.cwd());
    console.log(`   ✅ Worktree removed`);
  } catch {
    // Fall back to rm -rf
    try {
      execSync(`rm -rf '${ws.path}'`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      console.log(`   ✅ Directory removed (force)`);
    } catch {
      console.log(`   ❌ Failed to remove`);
    }
  }
  // Delete the local branch
  try {
    runGit(`branch -D ${ws.branchName}`, process.cwd());
    console.log(`   ✅ Branch deleted: ${ws.branchName}`);
  } catch {
    console.log(`   ⚠️  Branch may already be deleted`);
  }
};

const main = (): void => {
  const args = process.argv.slice(2);
  const workspaces = listWorkspaces();

  // No workspaces
  if (workspaces.length === 0) {
    console.log('No active workspaces found.');
    return;
  }

  // Just list
  if (args.length === 0) {
    console.log(`Active workspaces (${workspaces.length}):\n`);
    for (const ws of workspaces) {
      const merged = ws.prMerged ? ' 🔀 MERGED' : '';
      console.log(`  📂 ${relative(process.cwd(), ws.path)}`);
      console.log(`     Branch: ${ws.branchName}  Commit: ${ws.headCommit}`);
      console.log(`     ${ws.description || '(no description)'}${merged}`);
      console.log();
    }
    console.log('Usage:');
    console.log('  bun run workspace:cleanup --all          Clean ALL workspaces');
    console.log('  bun run workspace:cleanup --pr-merged    Clean only workspaces with merged PRs');
    console.log('  bun run workspace:cleanup <path>         Clean a specific workspace');
    return;
  }

  // Clean all
  if (args.includes('--all')) {
    console.log(`Cleaning up ${workspaces.length} workspace(s)...\n`);
    for (const ws of workspaces) {
      cleanupWorkspace(ws);
    }
    console.log('\nDone.');
    return;
  }

  // Clean only PR-merged
  if (args.includes('--pr-merged')) {
    const merged = workspaces.filter((ws) => ws.prMerged);
    if (merged.length === 0) {
      console.log('No workspaces with merged PRs found.');
      return;
    }
    console.log(`Cleaning up ${merged.length} merged workspace(s)...\n`);
    for (const ws of merged) {
      cleanupWorkspace(ws);
    }
    console.log('\nDone.');
    return;
  }

  // Clean specific path
  const targetPath = args[0];
  const match = workspaces.find(
    (ws) => ws.path === targetPath || relative(process.cwd(), ws.path) === targetPath,
  );
  if (!match) {
    console.log(`Workspace not found: ${targetPath}`);
    console.log('Run without arguments to list workspaces.');
    return;
  }
  cleanupWorkspace(match);
};

main();
