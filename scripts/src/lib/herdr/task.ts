#!/usr/bin/env bun

// scripts/src/lib/herdr/task.ts
//
// `bun herdr:task` — parallel pi task sessions in herdr-native git worktrees.
//
// Each task gets:
//   - a git worktree branched from origin/<base> (NEVER the dirty local main)
//     checked out under ~/.herdr/worktrees/<repo>/<slug> — outside the repo,
//     so concurrent sessions on the root checkout are completely unaffected
//   - a herdr workspace (aikami-task-<slug>) auto-grouped with the repo
//   - a pi session running in the worktree's root pane
//
// Usage:
//   bun herdr:task new <slug> [--base main] [--join] [--no-install]
//   bun herdr:task list
//   bun herdr:task pr   [<slug>] [--base main] [--title T] [--body B] [--draft]
//   bun herdr:task rm   <slug>   [--keep-branch] [--force]
//   bun herdr:task prune [--legacy] [--force]
//
// PR flow after a task finishes (from anywhere):
//   bun herdr:task pr my-feature --base main
//     → publishes the worktree branch, then `gh pr create --base main`
//
// Cleanup after merge:
//   bun herdr:task rm my-feature --force
//     → herdr worktree remove + git branch -D (herdr never deletes branches)
//
// Dev services: by default task sessions run WITHOUT ports (typecheck/lint/
// unit tests only — the vast majority of agent work). To run the full
// firebase/client stack FROM the worktree, pass `--with-services` to `new`;
// this records ownership in .pi/dev-stack-owner.json and prints the exact
// restart commands. Exactly one dev stack can exist per mode (ports are
// constants), so claiming it stops whatever the current stack serves.

// biome-ignore-all lint/style/useNamingConvention: HerDr API response field names (snake_case) — must match external API contract
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runGit, sanitizeBranchName } from '../agents/git_worktree.ts';
import { findWorkspace, herdr, herdrJson, wrapCommand } from './session.ts';
import {
  bootstrapWorktree,
  createWorktree,
  findTaskWorkspace,
  listWorktrees,
  openPullRequest,
  publishWorktree,
  removeWorktree,
  TASK_BRANCH_PREFIX,
  TASK_WORKSPACE_PREFIX,
  type TaskWorktree,
} from './worktree.ts';

// ── Constants ──────────────────────────────────────────────

const DEV_STACK_OWNER_FILE = '.pi/dev-stack-owner.json';
const DEFAULT_BASE = 'main';

// ── Helpers ────────────────────────────────────────────────

const ok = (m: string) => console.log(`  ✓ ${m}`);
const warn = (m: string) => console.log(`  ⚠️  ${m}`);

const argValue = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
};

const hasFlag = (args: string[], flag: string): boolean => args.includes(flag);

/** Resolve the repo root (cwd or env). */
const resolveRepoRoot = (): string => {
  const cwd = resolve(process.cwd());
  try {
    return runGit('rev-parse --show-toplevel', { cwd });
  } catch {
    return cwd;
  }
};

/** Resolve the task slug + checkout from CLI args or the current directory. */
const resolveTask = async (args: string[]): Promise<{ slug: string; w: TaskWorktree }> => {
  const positional = args.filter((a) => !a.startsWith('-'));
  const repoRoot = resolveRepoRoot();

  let slug: string | undefined;
  let checkoutPath: string | undefined;

  if (positional.length > 0) {
    slug = sanitizeBranchName(positional[0]);
  }

  if (!checkoutPath && !slug) {
    // Running inside a worktree? Derive from the current checkout.
    const cwd = resolve(process.cwd());
    try {
      const top = runGit('rev-parse --show-toplevel', { cwd });
      if (top !== repoRoot) {
        checkoutPath = top;
        const branch = runGit('rev-parse --abbrev-ref HEAD', { cwd: top });
        slug = sanitizeBranchName(branch.replace(/^task\//, '').replace(/^worktree\//, ''));
      }
    } catch {
      // Not in a git repo — slug will remain undefined.
    }
  }

  if (!slug) {
    throw new Error('Task slug required. Use: bun herdr:task <command> <slug>');
  }
  if (!checkoutPath) {
    const wsId = await findTaskWorkspace(slug);
    const entry = wsId
      ? (await listWorktrees()).find((w) => w.openWorkspaceId === wsId)
      : (await listWorktrees()).find((w) => w.branch === `${TASK_BRANCH_PREFIX}${slug}`);
    if (!entry) {
      throw new Error(
        `No open worktree for task "${slug}". Start one with: bun herdr:task new ${slug}`,
      );
    }
    checkoutPath = entry.path;
  }

  const branch = runGit('rev-parse --abbrev-ref HEAD', { cwd: checkoutPath });
  return {
    slug,
    w: {
      slug,
      branch,
      checkoutPath,
      workspaceId: (await findWorkspace(`${TASK_WORKSPACE_PREFIX}${slug}`)) ?? '',
      rootPaneId: '',
      repoRoot,
    },
  };
};

/** Launch pi in the worktree's root pane (mirrors start_pi.ts). */
const launchPiInWorktree = async (w: TaskWorktree): Promise<void> => {
  if (!w.workspaceId || !w.rootPaneId) {
    throw new Error('Task workspace is not open — cannot launch pi.');
  }
  const r = await herdrJson<{ result: { pane_id: string } }>(['pane', 'get', w.rootPaneId]);
  const paneId = r?.result?.pane_id ?? w.rootPaneId;
  await herdr(['tab', 'rename', `${w.workspaceId}:1`, 'pi']);
  await herdr(['pane', 'run', paneId, wrapCommand('pi')]);
  ok(`pi running in workspace ${w.workspaceId} (tab "pi")`);
};

// ── Subcommands ────────────────────────────────────────────

const cmdNew = async (args: string[]): Promise<void> => {
  const positional = args.filter((a) => !a.startsWith('-'));
  const slug = positional.length > 0 ? sanitizeBranchName(positional[0]) : undefined;
  if (!slug) {
    throw new Error('Usage: bun herdr:task new <slug> [--base main] [--join] [--no-install]');
  }

  const repoRoot = resolveRepoRoot();
  const base = argValue(args, '--base') ?? DEFAULT_BASE;
  const doJoin = hasFlag(args, '--join');
  const doInstall = !hasFlag(args, '--no-install');
  const withServices = hasFlag(args, '--with-services');

  // Guard: reject if a worktree for this slug already exists.
  if (
    (await findTaskWorkspace(slug)) ||
    (await listWorktrees()).some((w) => w.branch === `${TASK_BRANCH_PREFIX}${slug}`)
  ) {
    throw new Error(`Task "${slug}" already exists. Use a different slug or remove it first.`);
  }

  console.log(`🚀 Creating task worktree "${slug}" (base: ${base})...`);
  const w = await createWorktree({ slug, base, repoRoot });
  ok(`worktree: ${w.checkoutPath} (branch ${w.branch})`);
  ok(`workspace: ${w.workspaceId} (label ${TASK_WORKSPACE_PREFIX}${slug})`);

  console.log(
    `\n🔧 Bootstrapping worktree (direnv, seeds, ${doInstall ? 'bun install' : 'skipping install'})...`,
  );
  await bootstrapWorktree({
    checkoutPath: w.checkoutPath,
    repoRoot,
    install: doInstall,
  });
  ok('bootstrap complete');

  if (withServices) {
    // Record dev-stack ownership. The stack itself must be restarted by the
    // user — ports are per-mode constants, exactly one stack can run, and
    // restarting it would kill the current owner's servers.
    const owner = {
      checkoutPath: w.checkoutPath,
      branch: w.branch,
      mode: process.env.AIKAMI_MODE ?? 'emulator',
      claimedAt: new Date().toISOString(),
    };
    const ownerPath = join(repoRoot, DEV_STACK_OWNER_FILE);
    mkdirSync(join(repoRoot, '.pi'), { recursive: true });
    writeFileSync(ownerPath, JSON.stringify(owner, undefined, 2));
    warn(
      `dev stack ownership recorded for ${w.branch}. To serve the stack FROM this worktree:\n` +
        `    bun herdr:stop all && bun herdr:start all\n` +
        `  after cd ${w.checkoutPath} (or pass --mode explicitly).`,
    );
  }

  await launchPiInWorktree(w);
  ok(`task "${slug}" ready`);

  console.log(`\nAttach:  herdr session attach default`);
  console.log(`PR:      bun herdr:task pr ${slug} --base ${base}`);
  console.log(`Remove:  bun herdr:task rm ${slug}`);

  if (doJoin) {
    await herdr(['workspace', 'focus', w.workspaceId]);
    const proc = spawn('herdr', ['session', 'attach', 'default'], { stdio: 'inherit' });
    await new Promise<number>((res) => proc.on('exit', res));
  }
};

const cmdList = async (): Promise<void> => {
  const repoRoot = resolveRepoRoot();
  const worktrees = await listWorktrees(repoRoot);
  const taskWts = worktrees.filter((w) => w.branch.startsWith(TASK_BRANCH_PREFIX));

  if (taskWts.length === 0) {
    console.log('No task worktrees. Start one: bun herdr:task new <slug>');
    return;
  }

  const Green = '\x1b[32m';
  const Yellow = '\x1b[33m';
  const Dim = '\x1b[2m';
  const Reset = '\x1b[0m';

  for (const w of taskWts) {
    const open = w.openWorkspaceId ? `${Green}● open${Reset}` : `${Dim}○ closed${Reset}`;
    const dirty = (() => {
      try {
        return runGit('status --porcelain', { cwd: w.path }).length > 0
          ? `${Yellow}✚ dirty${Reset}`
          : '';
      } catch {
        return '';
      }
    })();
    console.log(`  ${w.branch}  ${open} ${dirty}`);
    console.log(`      ${Dim}${w.path}${Reset}`);
  }
  console.log(`\n${Dim}PR: bun herdr:task pr <slug> | Remove: bun herdr:task rm <slug>${Reset}`);
};

const cmdPr = async (args: string[]): Promise<void> => {
  const { w } = await resolveTask(args);
  const base = argValue(args, '--base') ?? DEFAULT_BASE;
  const title = argValue(args, '--title') ?? `Task: ${w.slug}`;
  const body = argValue(args, '--body');
  const draft = hasFlag(args, '--draft');

  console.log(`📦 Publishing ${w.branch} → origin (base ${base})...`);
  const { headBranch, headCommit } = await publishWorktree({
    checkoutPath: w.checkoutPath,
    repoRoot: w.repoRoot,
    base,
    message: `Feat: ${w.slug}`,
    authorName: 'Pi Agent',
    authorEmail: 'agent@pi.internal',
  });
  ok(`pushed ${headBranch} @ ${headCommit.slice(0, 7)}`);

  console.log(`🔀 Opening PR → ${base}...`);
  const { prUrl, prNumber } = await openPullRequest({
    headBranch,
    base,
    title,
    body,
    draft,
  });
  ok(`PR #${prNumber}: ${prUrl}`);
  console.log(`\nReview:  gh pr view ${prNumber} | Merge: bun herdr:task rm ${w.slug}`);
};

const cmdRm = async (args: string[]): Promise<void> => {
  const { w } = await resolveTask(args);
  const keepBranch = hasFlag(args, '--keep-branch');
  const force = hasFlag(args, '--force');

  console.log(`🧹 Removing task "${w.slug}"...`);
  await removeWorktree({
    workspaceId: w.workspaceId || undefined,
    checkoutPath: w.checkoutPath,
    branch: keepBranch ? undefined : w.branch,
    deleteRemoteBranch: false,
    force,
    repoRoot: w.repoRoot,
  });
  ok(`removed ${w.checkoutPath}${keepBranch ? ' (branch kept)' : ` and branch ${w.branch}`}`);

  // Also clear dev-stack ownership if this worktree owned it.
  const ownerPath = join(w.repoRoot, DEV_STACK_OWNER_FILE);
  if (existsSync(ownerPath)) {
    try {
      const owner = JSON.parse(readFileSync(ownerPath, 'utf-8')) as { checkoutPath?: string };
      if (owner.checkoutPath === w.checkoutPath) {
        writeFileSync(ownerPath, JSON.stringify({ claimedAt: null }, undefined, 2));
        ok('dev-stack ownership cleared');
      }
    } catch {
      // Non-fatal.
    }
  }
};

const cmdPrune = async (args: string[]): Promise<void> => {
  const repoRoot = resolveRepoRoot();
  const legacy = hasFlag(args, '--legacy');
  const force = hasFlag(args, '--force');

  if (legacy) {
    // Legacy: .pi/workspaces/* worktrees from the old provisioning code.
    console.log('🏗️  Legacy .pi/workspaces/ worktrees:');
    const all = await listWorktrees(repoRoot);
    const legacyWts = all.filter((w) => w.path.includes('/.pi/workspaces/'));
    if (legacyWts.length === 0) {
      console.log('  none found — nothing to prune.');
      return;
    }
    for (const w of legacyWts) {
      console.log(`  ${w.branch}  ${w.path}`);
    }
    if (force) {
      console.log('\nRemoving legacy worktrees...');
      for (const w of legacyWts) {
        await removeWorktree({
          workspaceId: w.openWorkspaceId,
          checkoutPath: w.path,
          branch: w.branch,
          deleteRemoteBranch: false,
          force: true,
          repoRoot,
        });
        ok(`removed ${w.branch}`);
      }
      try {
        runGit('worktree prune', { cwd: repoRoot });
      } catch {}
    } else {
      console.log('\nDry run — pass --force to remove them.');
    }
    return;
  }

  // Standard: prunable + closed task worktrees.
  const all = await listWorktrees(repoRoot);
  const candidates = all.filter(
    (w) => w.branch.startsWith(TASK_BRANCH_PREFIX) && (w.isPrunable || !w.openWorkspaceId),
  );
  if (candidates.length === 0) {
    console.log('No prunable task worktrees.');
    return;
  }
  for (const w of candidates) {
    console.log(`  ${w.branch}  ${w.path}${w.isPrunable ? ' (prunable)' : ''}`);
  }
  if (force) {
    for (const w of candidates) {
      await removeWorktree({
        workspaceId: w.openWorkspaceId,
        checkoutPath: w.path,
        branch: w.branch,
        force: true,
        repoRoot,
      });
      ok(`removed ${w.branch}`);
    }
  } else {
    console.log('\nDry run — pass --force to remove them.');
  }
};

// ── Main ───────────────────────────────────────────────────

const [subcommand, ...rest] = process.argv.slice(2);

const handlers: Record<string, (args: string[]) => Promise<void>> = {
  new: cmdNew,
  list: cmdList,
  pr: cmdPr,
  rm: cmdRm,
  prune: cmdPrune,
  help: async () => {
    console.log(`herdr:task — parallel pi sessions in herdr-native git worktrees

Usage:
  bun herdr:task new <slug> [--base main] [--join] [--no-install] [--with-services]
      Create a worktree (branched from origin/<base>), bootstrap it, launch pi.
  bun herdr:task list
      Show task worktrees + open/dirty state.
  bun herdr:task pr [<slug>] [--base main] [--title T] [--body B] [--draft]
      Publish the worktree branch and open a PR to <base>. Resolves the task
      from the current directory when no slug is given.
  bun herdr:task rm <slug> [--keep-branch] [--force]
      Remove worktree + herdr workspace + local branch.
  bun herdr:task prune [--legacy] [--force]
      Remove prunable/closed task worktrees. --legacy targets the old
      .pi/workspaces/ worktrees from the previous provisioning code.

Dev services: default task sessions run WITHOUT ports (typecheck/lint/tests).
--with-services records dev-stack ownership for serving the stack from the
worktree (exactly one stack per mode — ports are constants).`);
  },
};

try {
  if (!subcommand || !handlers[subcommand]) {
    await handlers.help([]);
    process.exit(subcommand ? 1 : 0);
  }
  await handlers[subcommand](rest);
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ ${message}`);
  process.exit(1);
}
