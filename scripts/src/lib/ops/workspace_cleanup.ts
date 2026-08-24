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
//   bun run workspace:cleanup --stale        clean every worktree that is provably finished
//   bun run workspace:cleanup --all          clean up ALL workspaces
//   bun run workspace:cleanup <path>         clean a specific workspace
//   bun run workspace:cleanup --pr-merged    clean workspaces whose branch has a merged PR
//   bun run workspace:cleanup --legacy       only legacy .pi/workspaces/ worktrees
//   bun run workspace:cleanup --include-self force-clean the worktree this process runs inside
//
// 🔴 `--stale` is the one to reach for after a PR merges. `--pr-merged` asks
// GitHub whether THIS branch has a merged PR, which misses the most common
// leftover by construction: when a run is restarted, the collision guard in
// herdr_adapter gives the new run a suffixed branch
// (`contract-task-c-432-mt6bz5w8-6djjzf`), that branch gets the PR and the
// merge, and the FIRST run's checkout (`contract-task-c-432-mt6bz5w8`) is left
// behind on a branch that was never pushed and has no PR at all — invisible to
// `--pr-merged` forever. `--stale` instead asks "is there anything left to
// lose here": no open herdr workspace, nothing on origin, no OPEN PR, and no
// uncommitted changes. A checkout that fails any of those is reported, with
// the reason, and kept.
//
// 🔴 Self-guard: a worktree this process is running inside (the review/worker
// tab of a contract pipeline, a herdr:task session, etc.) is NEVER removed —
// cleanup would kill the very session that invoked it. Skipped entries print
// a loud reason; pass --include-self to override.
//
// 🔴 Drive off `git worktree list --porcelain` — the AUTHORITATIVE source.
// Covers BOTH legacy .pi/workspaces/ checkouts AND herdr-native worktrees
// (~/.herdr/worktrees/<repo>/). herdr-native worktrees are also removed via
// `herdr worktree remove` (closes herdr workspace state + checkout together).

import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
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

/** The worktree this process is running inside (resolved), if any. */
const selfWorktreePath = (): string | undefined => {
  const pipelineWs = process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
  return pipelineWs ? resolve(pipelineWs) : undefined;
};

/** True when `child` is `parent` itself or lies beneath it (path-aware). */
const isSameOrDescendant = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** True when removing `path` would kill the session that invoked this CLI.
 *  Detected via the pipeline workspace env (set on every worker/review tab)
 *  and/or the process cwd (running from inside the checkout). Either anchor
 *  matches when `path` is the anchor itself OR lies beneath it. */
const isSelfWorktree = (path: string): boolean => {
  const resolved = resolve(path);
  if (isSameOrDescendant(resolved, resolve(process.cwd()))) {
    return true;
  }
  const self = selfWorktreePath();
  return self !== undefined && isSameOrDescendant(resolved, self);
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
    } else if (line === 'detached' && current) {
      current.detached = true;
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

/** True when `branchName` still exists on origin. */
const remoteBranchExists = (branchName: string): boolean =>
  runArgv('git', ['ls-remote', '--heads', 'origin', branchName], process.cwd()) !== '';

/**
 * True when this head branch still has an OPEN PR.
 *
 * Deliberately not `--state all`: a merged (or closed) PR is precisely the
 * signal that the worktree is finished — treating any PR as a reason to keep
 * the checkout would exclude the single most common case this command exists
 * for, "the PR merged, clean it up". Only a PR someone could still review or
 * merge protects the branch.
 */
const openPrForBranch = (branchName: string): boolean => {
  const count = runArgv(
    'gh',
    ['pr', 'list', '--head', branchName, '--state', 'open', '--json', 'number', '--jq', 'length'],
    process.cwd(),
  );
  return count !== '' && count !== '0';
};

/**
 * Why a worktree is (or is not) safe to delete without asking.
 *
 * "Safe" means there is provably nothing left to lose: nobody is working in
 * it (no open herdr workspace), its commits are not on origin, no open PR
 * depends on its branch, and it holds no uncommitted edits. Any single failure
 * keeps it — the cost of a wrong delete (unpushed work, a branch backing an
 * open PR) dwarfs the cost of one stale directory surviving another day.
 */
type StaleVerdict = { stale: true } | { stale: false; keepReason: string; overridable: boolean };

const staleVerdict = (ws: WorkspaceInfo): StaleVerdict => {
  if (ws.branchName === '(detached)') {
    return {
      stale: false,
      keepReason: 'detached HEAD — cannot identify the work',
      overridable: false,
    };
  }
  if (ws.herdrWorkspaceId) {
    return { stale: false, keepReason: 'still open as a herdr workspace', overridable: false };
  }
  if (remoteBranchExists(ws.branchName)) {
    return { stale: false, keepReason: 'branch still exists on origin', overridable: false };
  }
  if (openPrForBranch(ws.branchName)) {
    return { stale: false, keepReason: 'branch has an open PR on GitHub', overridable: false };
  }
  // 🔴 Last gate, and the only overridable one. Everything above says the
  // work reached origin or is still live; this one says it never left the
  // checkout. A contract worktree is dirty far more often than not (paraglide
  // output, .svelte-kit, a `bun add` the implementer ran), so refusing every
  // dirty tree would make --stale useless — but silently deleting uncommitted
  // SOURCE edits that exist nowhere else is the one mistake this command must
  // never make on its own. Report the count and let --force decide.
  const dirty = runGit('status --porcelain', ws.path);
  if (dirty !== '') {
    const count = dirty.split('\n').length;
    return {
      stale: false,
      keepReason: `${count} uncommitted change(s), never pushed — re-run with --force to delete anyway`,
      overridable: true,
    };
  }
  return { stale: true };
};

const listWorkspaces = async (options?: {
  /** Resolve merged-PR status via `gh pr list` per worktree. 🔴 Expensive —
   *  each call spawns gh with a 10s timeout, so bare listings enable it only
   *  so the 🔀 MERGED marker renders accurately; `--all` skips it. */
  checkPrMerged?: boolean;
}): Promise<WorkspaceInfo[]> => {
  const checkPrMerged = options?.checkPrMerged ?? false;
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
      prMerged: checkPrMerged ? prMergedForBranch(branchName) : false,
      isLegacy,
      herdrWorkspaceId,
    });
  }
  return items;
};

const cleanupWorkspace = async (
  ws: WorkspaceInfo,
  repoRoot: string,
  options?: { deleteRemoteBranch?: boolean; includeSelf?: boolean },
): Promise<void> => {
  // Self-guard: refuse unless the explicit --include-self override was passed.
  if (!options?.includeSelf && isSelfWorktree(ws.path)) {
    console.warn(`⛔ Refusing to remove ${ws.path} — this process is running inside it.`);
    return;
  }
  console.log(`🧹 Cleaning up: ${ws.path} (branch: ${ws.branchName})`);
  await removeWorktree({
    workspaceId: ws.herdrWorkspaceId,
    checkoutPath: ws.path,
    branch: ws.branchName === '(detached)' ? undefined : ws.branchName,
    deleteRemoteBranch: options?.deleteRemoteBranch ?? false,
    force: true,
    repoRoot,
  });
  console.log(`   ✅ Removed worktree${ws.herdrWorkspaceId ? ' + herdr workspace' : ''}`);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  // Flags and the optional target path are parsed independently so
  // `--legacy <path>` cleans that path with legacy filtering applied.
  const FLAG_SET = new Set([
    '--all',
    '--stale',
    '--pr-merged',
    '--legacy',
    '--force',
    '--include-self',
  ]);
  const flags = args.filter((a) => FLAG_SET.has(a));
  const targetPath = args.find((a) => !FLAG_SET.has(a));
  const legacyOnly = flags.includes('--legacy');

  const repoRoot = resolve(process.cwd());
  const workspaces = await listWorkspaces({
    checkPrMerged: flags.includes('--pr-merged') || (flags.length === 0 && !targetPath),
  });
  const filtered = legacyOnly ? workspaces.filter((ws) => ws.isLegacy) : workspaces;

  // 🔴 Self-guard: never remove the worktree this process is running inside.
  const includeSelf = flags.includes('--include-self');
  const selfWorktrees = filtered.filter((ws) => isSelfWorktree(ws.path));
  const targets = includeSelf ? filtered : filtered.filter((ws) => !isSelfWorktree(ws.path));
  if (selfWorktrees.length > 0 && !includeSelf) {
    console.warn(
      `⚠️  Skipping ${selfWorktrees.length} worktree(s) this process is running inside ` +
        '(removing them would kill this session — e.g. the contract review tab).',
    );
    for (const ws of selfWorktrees) {
      console.warn(`      - ${relative(repoRoot, ws.path)} (${ws.branchName})`);
    }
    console.log();
  }

  if (targets.length === 0) {
    console.log(
      legacyOnly ? 'No legacy .pi/workspaces/ worktrees found.' : 'No active worktrees found.',
    );
    return;
  }

  // Just list
  if (flags.length === 0 && !targetPath) {
    console.log(`Active worktrees (${targets.length}):\n`);
    for (const ws of targets) {
      const merged = ws.prMerged ? ' 🔀 MERGED' : '';
      const herdr = ws.herdrWorkspaceId ? ' [herdr]' : '';
      const legacy = ws.isLegacy ? ' [legacy]' : '';
      console.log(`  📂 ${relative(repoRoot, ws.path)}`);
      console.log(`     Branch: ${ws.branchName}  Commit: ${ws.headCommit}`);
      console.log(`     ${ws.description || '(no description)'}${merged}${herdr}${legacy}`);
      console.log();
    }
    console.log('Usage:');
    console.log(
      '  bun run workspace:cleanup --stale        Clean every worktree with nothing left to lose',
    );
    console.log(
      '  bun run workspace:cleanup --stale --force  ...including ones with uncommitted changes',
    );
    console.log('  bun run workspace:cleanup --all          Clean ALL worktrees');
    console.log('  bun run workspace:cleanup --pr-merged    Clean only worktrees with merged PRs');
    console.log('  bun run workspace:cleanup --legacy       Clean only legacy .pi/workspaces/');
    console.log('  bun run workspace:cleanup <path>         Clean a specific worktree');
    return;
  }

  // Clean everything provably finished — the post-merge default.
  if (flags.includes('--stale')) {
    const force = flags.includes('--force');
    const verdicts = targets.map((ws) => ({ ws, verdict: staleVerdict(ws) }));
    const isTarget = (v: (typeof verdicts)[number]): boolean =>
      v.verdict.stale || (force && v.verdict.overridable);
    const stale = verdicts.filter(isTarget).map((v) => v.ws);
    for (const { ws, verdict } of verdicts) {
      if (verdict.stale || isTarget({ ws, verdict })) {
        continue;
      }
      console.log(
        `  ⏭  Keeping ${relative(repoRoot, ws.path)} (${ws.branchName}) — ${verdict.keepReason}`,
      );
    }
    if (stale.length === 0) {
      console.log('\nNothing stale to clean.');
      return;
    }
    console.log(`\nCleaning up ${stale.length} finished worktree(s)...\n`);
    for (const ws of stale) {
      // Merged branches are gone from origin already (that is part of what
      // made them stale), so there is no remote branch left to delete.
      await cleanupWorkspace(ws, repoRoot, { includeSelf });
    }
    console.log('\nDone.');
    return;
  }

  // Clean all (optionally legacy-filtered: `--legacy --all`)
  if (flags.includes('--all')) {
    console.log(`Cleaning up ${targets.length} worktree(s)...\n`);
    for (const ws of targets) {
      await cleanupWorkspace(ws, repoRoot, { includeSelf });
    }
    console.log('\nDone.');
    return;
  }

  // Clean only PR-merged (optionally legacy-filtered). Merged branches are
  // safe to delete from the remote too — the PR already consumed them.
  if (flags.includes('--pr-merged')) {
    const merged = targets.filter((ws) => ws.prMerged);
    if (merged.length === 0) {
      console.log('No worktrees with merged PRs found.');
      return;
    }
    console.log(`Cleaning up ${merged.length} merged worktree(s)...\n`);
    for (const ws of merged) {
      await cleanupWorkspace(ws, repoRoot, { deleteRemoteBranch: true, includeSelf });
    }
    console.log('\nDone.');
    return;
  }

  // Clean specific path (`--legacy <path>` keeps the legacy filter)
  if (!targetPath) {
    console.log('Run without arguments to list worktrees.');
    return;
  }
  const match = targets.find(
    (ws) => ws.path === targetPath || relative(repoRoot, ws.path) === targetPath,
  );
  if (!match) {
    console.log(`Worktree not found: ${targetPath}`);
    console.log('Run without arguments to list worktrees.');
    return;
  }
  await cleanupWorkspace(match, repoRoot, { includeSelf });
};

await main();
