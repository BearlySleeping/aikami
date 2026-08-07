#!/usr/bin/env bun

// scripts/src/lib/ops/workspace_cleanup.ts
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
//   bun run workspace:cleanup --legacy       only legacy .pi/workspaces/ worktrees
//
// 🔴 Drive off `git worktree list --porcelain` — the AUTHORITATIVE source.
// Covers BOTH legacy .pi/workspaces/ checkouts AND herdr-native worktrees
// (~/.herdr/worktrees/<repo>/). herdr-native worktrees are also removed via
// `herdr worktree remove` (closes herdr workspace state + checkout together).

import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { removeWorktree } from '../herdr/worktree.ts';

/** Run an argv array with execFileSync — no shell interpolation of values. */
const runArgv = (command: string, args: string[], cwd: string): string => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      timeout: 10000,
    }).trim();
  } catch {
    return '';
  }
};

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
  isLegacy: boolean;
  herdrWorkspaceId?: string;
};

/** Parse `git worktree list --porcelain` into entries. */
const listAllWorktrees = (): Array<{ path: string; branch?: string; detached?: boolean }> => {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  }).trim();
  if (!out) {
    return [];
  }

  const entries: Array<{ path: string; branch?: string; detached?: boolean }> = [];
  let current: { path: string; branch?: string; detached?: boolean } | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) {
        entries.push(current);
      }
      current = { path: line.slice('worktree '.length).trim() };
    } else if (line.startsWith('branch ')) {
      if (current) {
        current.branch = line.slice('branch '.length).replace('refs/heads/', '');
      }
    } else if (line === 'detached') {
      if (current) {
        current.detached = true;
      }
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
};

const prMergedForBranch = (branchName: string): boolean => {
  const prList = runArgv(
    'gh',
    ['pr', 'list', '--head', branchName, '--state', 'merged', '--json', 'number', '--jq', 'length'],
    process.cwd(),
  );
  return prList !== '' && prList !== '0';
};

const listWorkspaces = async (): Promise<WorkspaceInfo[]> => {
  const repoRoot = resolve(process.cwd());
  const legacyParent = join(repoRoot, '.pi', 'workspaces');
  const worktrees = listAllWorktrees().filter((w) => w.path !== repoRoot); // skip main checkout

  const items: WorkspaceInfo[] = [];
  for (const wt of worktrees) {
    if (!existsSync(wt.path)) {
      continue;
    }
    const headCommit = runGit('rev-parse HEAD', wt.path);
    if (!headCommit) {
      continue;
    }
    const branchName = wt.branch ?? '(detached)';
    const desc = runGit('log -1 --format=%s', wt.path);
    // Path-boundary check: exactly the legacy parent or a child directory,
    // NOT a sibling like `.pi/workspaces-old`.
    const isLegacy = wt.path === legacyParent || wt.path.startsWith(`${legacyParent}${sep}`);

    // Resolve the herdr workspace id for herdr-native worktrees so cleanup
    // can tear herdr state + checkout together.
    let herdrWorkspaceId: string | undefined;
    if (!isLegacy) {
      try {
        const r = runArgv('herdr', ['worktree', 'list', '--cwd', repoRoot], process.cwd());
        if (r) {
          const parsed = JSON.parse(r) as {
            result: { worktrees: Array<{ path: string; open_workspace_id?: string }> };
          };
          herdrWorkspaceId = parsed.result.worktrees.find(
            (w) => w.path === wt.path,
          )?.open_workspace_id;
        }
      } catch {
        // herdr unavailable — fall back to plain git removal.
      }
    }

    items.push({
      path: wt.path,
      branchName,
      headCommit: headCommit.slice(0, 12),
      description: desc.trim(),
      prMerged: prMergedForBranch(branchName),
      isLegacy,
      herdrWorkspaceId,
    });
  }
  return items;
};

const cleanupWorkspace = async (ws: WorkspaceInfo, repoRoot: string): Promise<void> => {
  console.log(`🧹 Cleaning up: ${ws.path} (branch: ${ws.branchName})`);
  await removeWorktree({
    workspaceId: ws.herdrWorkspaceId,
    checkoutPath: ws.path,
    branch: ws.branchName === '(detached)' ? undefined : ws.branchName,
    deleteRemoteBranch: false,
    force: true,
    repoRoot,
  });
  console.log(`   ✅ Removed worktree${ws.herdrWorkspaceId ? ' + herdr workspace' : ''}`);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  // Flags and the optional target path are parsed independently so
  // `--legacy <path>` cleans that path with legacy filtering applied.
  const FLAG_SET = new Set(['--all', '--pr-merged', '--legacy', '--force']);
  const flags = args.filter((a) => FLAG_SET.has(a));
  const targetPath = args.find((a) => !FLAG_SET.has(a));
  const legacyOnly = flags.includes('--legacy');

  const repoRoot = resolve(process.cwd());
  const workspaces = await listWorkspaces();
  const filtered = legacyOnly ? workspaces.filter((ws) => ws.isLegacy) : workspaces;

  if (filtered.length === 0) {
    console.log(
      legacyOnly ? 'No legacy .pi/workspaces/ worktrees found.' : 'No active worktrees found.',
    );
    return;
  }

  // Just list
  if (flags.length === 0 && !targetPath) {
    console.log(`Active worktrees (${filtered.length}):\n`);
    for (const ws of filtered) {
      const merged = ws.prMerged ? ' 🔀 MERGED' : '';
      const herdr = ws.herdrWorkspaceId ? ' [herdr]' : '';
      const legacy = ws.isLegacy ? ' [legacy]' : '';
      console.log(`  📂 ${relative(repoRoot, ws.path)}`);
      console.log(`     Branch: ${ws.branchName}  Commit: ${ws.headCommit}`);
      console.log(`     ${ws.description || '(no description)'}${merged}${herdr}${legacy}`);
      console.log();
    }
    console.log('Usage:');
    console.log('  bun run workspace:cleanup --all          Clean ALL worktrees');
    console.log('  bun run workspace:cleanup --pr-merged    Clean only worktrees with merged PRs');
    console.log('  bun run workspace:cleanup --legacy       Clean only legacy .pi/workspaces/');
    console.log('  bun run workspace:cleanup <path>         Clean a specific worktree');
    return;
  }

  // Clean all (optionally legacy-filtered: `--legacy --all`)
  if (flags.includes('--all')) {
    console.log(`Cleaning up ${filtered.length} worktree(s)...\n`);
    for (const ws of filtered) {
      await cleanupWorkspace(ws, repoRoot);
    }
    console.log('\nDone.');
    return;
  }

  // Clean only PR-merged (optionally legacy-filtered)
  if (flags.includes('--pr-merged')) {
    const merged = filtered.filter((ws) => ws.prMerged);
    if (merged.length === 0) {
      console.log('No worktrees with merged PRs found.');
      return;
    }
    console.log(`Cleaning up ${merged.length} merged worktree(s)...\n`);
    for (const ws of merged) {
      await cleanupWorkspace(ws, repoRoot);
    }
    console.log('\nDone.');
    return;
  }

  // Clean specific path (`--legacy <path>` keeps the legacy filter)
  if (!targetPath) {
    console.log('Run without arguments to list worktrees.');
    return;
  }
  const match = filtered.find(
    (ws) => ws.path === targetPath || relative(repoRoot, ws.path) === targetPath,
  );
  if (!match) {
    console.log(`Worktree not found: ${targetPath}`);
    console.log('Run without arguments to list worktrees.');
    return;
  }
  await cleanupWorkspace(match, repoRoot);
};

await main();
