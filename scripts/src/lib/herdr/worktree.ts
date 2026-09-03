// scripts/src/lib/herdr/worktree.ts
//
// Herdr-native Git Worktree lifecycle — THE single source of truth for
// task/contract worktree provisioning, bootstrapping, publishing, and cleanup.
//
// Why herdr-native instead of raw `git worktree add` (see git_worktree.ts):
//   - `herdr worktree create` makes a real git worktree AND opens it as a
//     herdr workspace, grouped with the parent repo (repo provenance tracked).
//   - Checkouts live in ~/.herdr/worktrees/<repo>/<slug> by default — OUTSIDE
//     the repo — so they never pollute root git state or .gitignore, and the
//     root checkout (possibly mid-refactor by another session) is untouched.
//   - `herdr worktree remove --workspace <id>` tears down herdr state + the
//     checkout together; branch deletion stays a separate git step (herdr
//     never deletes branches by design).
//
// Consumers:
//   1. scripts/src/lib/herdr/task.ts  → `bun herdr:task` CLI (parallel pi sessions)
//   2. contract pipeline (herdr_adapter.ts / orchestrator.ts)
//   3. pi extension tools (contract_workspace_reconcile, task_open_pr)
//
// The low-level git primitives (runGit, commitAll, pushBranch, ...) remain in
// scripts/src/lib/agents/git_worktree.ts — do not fork them.

// biome-ignore-all lint/style/useNamingConvention: HerDr API response field names (snake_case) — must match external API contract
import { execFileSync, execSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { contractPortOffset, PORTS } from '../../../../packages/shared/constants/src/index.ts';
import {
  commitAll,
  pushBranch,
  remoteBranchExists,
  runGit,
  sanitizeBranchName,
} from '../agents/git_worktree.ts';
import { APP_CONFIG } from '../deploy/deployment_config.ts';
import { hasDirenv } from '../env/direnv_detect';
import { reportInfraIssue } from '../ops/infra_report.ts';
import {
  CONTRACT_WORKSPACE_PREFIX,
  findWorkspace,
  getWorkspaceTabs,
  herdr,
  herdrJson,
  KNOWN_SERVICES,
  killPort,
  SERVICE_DEFS,
  TASK_WORKSPACE_PREFIX,
} from './session.ts';

// ── Types ──────────────────────────────────────────────────

export type TaskWorktree = {
  /** Short human slug (task/<slug> → branch, aikami-task-<slug> → label). */
  slug: string;
  /** Git branch the worktree has checked out (e.g. task/my-feature). */
  branch: string;
  /** Absolute checkout path (~/.herdr/worktrees/<repo>/<dir>). */
  checkoutPath: string;
  /** herdr workspace id for the worktree ("" if not open). */
  workspaceId: string;
  /** Root pane id of the worktree workspace ("" if not open). */
  rootPaneId: string;
  /** Root tab id of the worktree workspace ("" if unknown). */
  tabId: string;
  /** Absolute path of the parent repo checkout (the main working copy). */
  repoRoot: string;
};

export type WorktreeEntry = {
  branch: string;
  path: string;
  label: string;
  openWorkspaceId?: string;
  isLinked: boolean;
  isDetached: boolean;
  isPrunable: boolean;
};

export type BootstrapOptions = {
  checkoutPath: string;
  repoRoot: string;
  /** Run `bun install --frozen-lockfile` (default true). */
  install?: boolean;
  /** Copy gitignored-but-required seed files (.env*, paraglide, .secrets). */
  seed?: boolean;
  /** Install timeout in ms (default 180_000 — cold worktrees are slow). */
  installTimeoutMs?: number;
};

export type RemoveWorktreeResult = {
  /** True when the checkout (and herdr state) was removed AND, when
   *  requested, the branch was deleted. False otherwise. */
  removed: boolean;
  /** Human-readable reason when `removed` is false. */
  reason?: string;
};

export type RemoveWorktreeOptions = {
  /** herdr workspace id (when the worktree is open as a workspace). */
  workspaceId?: string;
  /** Checkout path — used for fallback removal if no workspace id. */
  checkoutPath?: string;
  /** Branch to delete locally (and remotely when requested). */
  branch?: string;
  /** Also delete the remote branch (git push origin --delete). */
  deleteRemoteBranch?: boolean;
  /** Force removal (dirty checkout). */
  force?: boolean;
  repoRoot: string;
};

export type PublishOptions = {
  checkoutPath: string;
  repoRoot: string;
  /** Base branch for PR + collision-guard naming (default: current branch). */
  base?: string;
  /** Final commit message (default: descriptive generic). */
  message?: string;
  authorName?: string;
  authorEmail?: string;
};

export type PullRequestOptions = {
  headBranch: string;
  base: string;
  title: string;
  body?: string;
  draft?: boolean;
};

// ── Constants ──────────────────────────────────────────────

// TASK_WORKSPACE_PREFIX is declared in session.ts (beside
// CONTRACT_WORKSPACE_PREFIX) and re-exported here for the existing importers.
export { TASK_WORKSPACE_PREFIX };
export const TASK_BRANCH_PREFIX = 'task/';

/**
 * Tracked files that must not be committed from a worktree. They are
 * workspace-local state (direnv delegation, pi settings, shared progress
 * docs) — `git add -A` would otherwise sweep them into every PR.
 * Marked skip-worktree during bootstrap (git worktrees use a .git FILE,
 * so .git/info/exclude is unavailable — skip-worktree is the only
 * reliable mechanism).
 */
export const WORKTREE_SKIP_WORKTREE_PATHS = [
  '.envrc',
  '.pi/settings.json',
  '.context/llms.txt',
  'docs/contracts/PROGRESS.md',
  'docs/contracts/PROMOTION.md',
];

type WorktreeSeedEntry = {
  from: string;
  to: string;
  kind: 'file' | 'dir';
  optional?: boolean;
};

/** Per-app env files a worktree may need. Missing ones are silently skipped
 *  (optional: true below), so it's safe to list every suffix for every app
 *  rather than tracking which app actually has which file on disk. */
const ENV_FILE_SUFFIXES = [
  '.env.emulator',
  '.env.local',
  '.env.staging',
  '.env.production',
  '.env.testing',
];

/**
 * Env-file seed entries for every app in APP_CONFIG, derived from its `path`
 * so a new app or a new env file automatically gets seeded into worktrees
 * without touching this file — this is what fixed C-417's missing
 * `apps/frontend/site/.env.emulator` (added by hand and immediately went
 * stale for `hub`, `docs`, etc.). Dedupes by path since `client-tauri`
 * reuses `client`'s path.
 */
const appConfigEnvSeedPaths = (): WorktreeSeedEntry[] => {
  const seenPaths = new Set<string>();
  const entries: WorktreeSeedEntry[] = [];
  for (const config of Object.values(APP_CONFIG)) {
    if (seenPaths.has(config.path)) {
      continue;
    }
    seenPaths.add(config.path);
    for (const suffix of ENV_FILE_SUFFIXES) {
      const relPath = `${config.path}/${suffix}`;
      entries.push({ from: relPath, to: relPath, kind: 'file', optional: true });
    }
  }
  return entries;
};

/**
 * Gitignored-but-required files copied from the root checkout during
 * bootstrap. Without these, dev servers / typecheck / tests can't run
 * in a worktree (they are gitignored, so a fresh checkout lacks them).
 * Each entry: { from (relative to repoRoot), to (relative to checkout),
 * kind: 'file' | 'dir', optional: true }.
 */
export const WORKTREE_SEED_PATHS: WorktreeSeedEntry[] = [
  // Root env files
  { from: '.env', to: '.env', kind: 'file', optional: true },
  { from: '.env.emulator', to: '.env.emulator', kind: 'file', optional: true },
  { from: '.env.local', to: '.env.local', kind: 'file', optional: true },
  // Per-app env files (client, site, hub, docs, ...) — see APP_CONFIG.
  ...appConfigEnvSeedPaths(),
  // E2E + scripts env (not APP_CONFIG entries)
  { from: 'apps/e2e/.env', to: 'apps/e2e/.env', kind: 'file', optional: true },
  { from: 'scripts/.env', to: 'scripts/.env', kind: 'file', optional: true },
  // GCP service-account keys (needed by gcloud deploys)
  { from: '.secrets', to: '.secrets', kind: 'dir', optional: true },
  // Paraglide generated i18n files — gitignored, required for client
  // typecheck/build/dev (Vite re-generates them, but only when running).
  {
    from: 'apps/frontend/client/src/lib/paraglide',
    to: 'apps/frontend/client/src/lib/paraglide',
    kind: 'dir',
    optional: true,
  },
];

// ── Herdr CLI result shapes ────────────────────────────────

type WorktreeCreateResult = {
  result: {
    type: 'worktree_created';
    workspace: {
      workspace_id: string;
      label: string;
      worktree?: {
        checkout_path: string;
        repo_root: string;
      };
    };
    worktree: {
      branch: string;
      path: string;
      is_linked_worktree: boolean;
    };
    tab: { tab_id: string };
    root_pane: {
      pane_id: string;
    };
  };
};

type WorktreeListResult = {
  result: {
    worktrees: Array<{
      branch: string;
      path: string;
      label: string;
      open_workspace_id?: string;
      is_linked_worktree: boolean;
      is_detached: boolean;
      is_prunable: boolean;
    }>;
  };
};

type WorktreeRemoveResult = {
  result: {
    type: 'worktree_removed';
    path: string;
    workspace_id: string;
    forced: boolean;
  };
};

type WorktreeOpenResult = {
  result: {
    workspace: {
      workspace_id: string;
      label: string;
      worktree?: { checkout_path: string; repo_root: string };
    };
    worktree?: { branch: string; path: string };
    root_pane: { pane_id: string };
  };
};

// ── Helpers ────────────────────────────────────────────────

/** Root checkout directory of the MAIN repo for a worktree (from .git file). */
export const worktreeRepoRoot = (checkoutPath: string): string => {
  try {
    const gitFile = readFileSync(join(checkoutPath, '.git'), 'utf-8').trim();
    const m = gitFile.match(/^gitdir:\s*(.+)$/m);
    if (m?.[1]) {
      const gitDir = resolve(m[1].trim());
      // <repo>/.git/worktrees/<name> → repo root is everything before
      // "/.git/worktrees/". Fall back to walking up 3 levels for other
      // layouts (<repo>/.git/worktrees/name → ../../.. → <repo>).
      const idx = gitDir.indexOf('/.git/worktrees/');
      if (idx !== -1) {
        return gitDir.slice(0, idx);
      }
      return resolve(gitDir, '../../..');
    }
  } catch {
    // Not a linked worktree — fall back to rev-parse.
  }
  try {
    return runGit('rev-parse --show-toplevel', { cwd: checkoutPath });
  } catch {
    throw new Error(`Cannot determine repo root for ${checkoutPath}`);
  }
};

const ensureGitRepo = (repoRoot: string): void => {
  try {
    runGit('rev-parse --git-dir', { cwd: repoRoot });
  } catch {
    throw new Error(`Not a git repository: ${repoRoot}`);
  }
};

// ── Worktree lifecycle ─────────────────────────────────────

/**
 * Create a herdr-native Git Worktree.
 *
 * Branches from `origin/<base>` (fetched fresh) so the worktree NEVER
 * includes uncommitted work or unpushed commits from the root checkout —
 * critical when another session is refactoring on main concurrently.
 *
 * The worktree is automatically opened as a herdr workspace grouped with
 * the parent repo. Returns workspace id + checkout path + root pane id.
 */
export const createWorktree = async (options: {
  slug: string;
  /** Explicit branch name. Default: task/<slug>. */
  branch?: string;
  /** Base ref to branch from. Default: current branch of repo root. */
  base?: string;
  /** Workspace label. Default: aikami-task-<slug>. */
  label?: string;
  repoRoot: string;
  focus?: boolean;
}): Promise<TaskWorktree> => {
  ensureGitRepo(options.repoRoot);
  const slug = sanitizeBranchName(options.slug);
  if (!slug) {
    throw new Error('Worktree slug must be a non-empty identifier (a-z, 0-9, -).');
  }

  const currentBranch = runGit('rev-parse --abbrev-ref HEAD', { cwd: options.repoRoot });
  const base = options.base ?? (currentBranch === 'HEAD' ? 'main' : currentBranch);

  // Fetch the base ref so the worktree starts from origin, not a dirty local.
  try {
    runGit('fetch origin', { cwd: options.repoRoot });
  } catch {
    // Non-fatal — may not have a remote configured.
  }

  // Resolve origin/<base> first; fall back to the local ref.
  let baseRef = `origin/${base}`;
  try {
    runGit(`rev-parse --verify ${baseRef}`, { cwd: options.repoRoot });
  } catch {
    baseRef = base;
  }

  const branch = options.branch ?? `${TASK_BRANCH_PREFIX}${slug}`;
  const label = options.label ?? `${TASK_WORKSPACE_PREFIX}${slug}`;

  // `--cwd` is REQUIRED: herdr resolves commands without an explicit
  // workspace/cwd against the server's CURRENTLY FOCUSED workspace, which may
  // be a plain shell (e.g. `~`) rather than a git work tree — herdr then
  // rejects the call with `not_git_worktree`. Pointing --cwd at the repo root
  // makes worktree creation deterministic regardless of focus. `worktree
  // create` performs a git checkout under the hood, so allow well beyond the
  // default 3s CLI timeout.
  const args = [
    'worktree',
    'create',
    '--cwd',
    options.repoRoot,
    '--branch',
    branch,
    '--base',
    baseRef,
    '--label',
    label,
  ];
  if (options.focus) {
    args.push('--focus');
  } else {
    args.push('--no-focus');
  }

  const r = await herdrJson<WorktreeCreateResult>(args, { timeoutMs: 60_000 });
  const checkoutPath = r?.result?.workspace?.worktree?.checkout_path ?? r?.result?.worktree?.path;
  if (!(r?.result?.workspace && checkoutPath)) {
    throw new Error(
      `herdr worktree create failed for slug "${slug}" (branch ${branch}). ` +
        'Check the [herdr] warnings above for the real herdr error — a common ' +
        'cause is herdr resolving the command against a non-git workspace ' +
        '(e.g. `~` instead of the repo).',
    );
  }

  return {
    slug,
    branch: r.result.worktree?.branch ?? branch,
    checkoutPath,
    workspaceId: r.result.workspace.workspace_id,
    rootPaneId: r.result.root_pane?.pane_id ?? '',
    tabId: r.result.tab?.tab_id ?? '',
    repoRoot: options.repoRoot,
  };
};

/**
 * Re-open an existing worktree checkout as a herdr workspace.
 * Recovery path: the checkout survives but its herdr workspace was closed
 * (herdr `workspace close` closes state only).
 */
export const openWorktree = async (options: {
  checkoutPath: string;
  label?: string;
  repoRoot?: string;
  focus?: boolean;
}): Promise<TaskWorktree> => {
  if (!existsSync(join(options.checkoutPath, '.git'))) {
    throw new Error(`Not a git worktree: ${options.checkoutPath}`);
  }
  const root = options.repoRoot ?? worktreeRepoRoot(options.checkoutPath);
  const branch = runGit('rev-parse --abbrev-ref HEAD', { cwd: options.checkoutPath });

  // Same `--cwd` requirement as createWorktree — herdr worktree commands
  // resolve against the focused workspace unless pointed at the repo root.
  // Use the MAIN repo root (not the checkout): the checkout path is itself a
  // linked worktree, not the repo's primary working tree.
  const args = ['worktree', 'open', '--cwd', root, '--path', options.checkoutPath];
  if (options.label) {
    args.push('--label', options.label);
  }
  if (options.focus) {
    args.push('--focus');
  } else {
    args.push('--no-focus');
  }

  const r = await herdrJson<WorktreeOpenResult>(args, { timeoutMs: 60_000 });
  if (!r?.result?.workspace) {
    throw new Error(`herdr worktree open failed for ${options.checkoutPath}`);
  }

  return {
    slug: sanitizeBranchName(branch.replace(/^task\//, '')),
    branch,
    checkoutPath: options.checkoutPath,
    workspaceId: r.result.workspace.workspace_id,
    rootPaneId: r.result.root_pane?.pane_id ?? '',
    tabId: '',
    repoRoot: root,
  };
};

/** List all herdr-tracked worktrees for the repo (with provenance). */
export const listWorktrees = async (repoRoot?: string): Promise<WorktreeEntry[]> => {
  const args = repoRoot ? ['worktree', 'list', '--cwd', repoRoot] : ['worktree', 'list'];
  const r = await herdrJson<WorktreeListResult>(args, { timeoutMs: 15_000 });
  if (!r?.result?.worktrees) {
    return [];
  }
  return r.result.worktrees.map((w) => ({
    branch: w.branch,
    path: w.path,
    label: w.label,
    openWorkspaceId: w.open_workspace_id,
    isLinked: w.is_linked_worktree,
    isDetached: w.is_detached,
    isPrunable: w.is_prunable,
  }));
};

/** Find a worktree by branch name (herdr-native lookup, repo-scoped). */
export const findWorktreeByBranch = async (
  branch: string,
  repoRoot?: string,
): Promise<WorktreeEntry | null> => {
  const worktrees = await listWorktrees(repoRoot);
  return worktrees.find((w) => w.branch === branch) ?? null;
};

/**
 * Bootstrap a worktree checkout so pi, moon, bun, and dev servers work:
 *   1. skip-worktree for workspace-local tracked files (never in PRs) —
 *      applied FIRST, before anything writes to those paths
 *   2. .envrc delegating to the repo root (flake.nix is git-tracked there)
 *   3. .pi/npm/node_modules symlink (pi extensions deps)
 *   4. seed gitignored-but-required files (.env*, paraglide, .secrets)
 *   5. bun install --frozen-lockfile
 *
 * Refuses to run when checkoutPath === repoRoot (see the guard below) —
 * this is a worktree-only bootstrap, never valid against the root checkout.
 */
export const bootstrapWorktree = async (
  options: BootstrapOptions,
): Promise<{ installed: boolean }> => {
  const { checkoutPath, repoRoot, seed = true } = options;
  if (!existsSync(checkoutPath)) {
    throw new Error(`Cannot bootstrap missing checkout: ${checkoutPath}`);
  }

  // 🔴 Hard guard: bootstrapWorktree overwrites .envrc unconditionally below.
  // Called against the repo root itself (checkoutPath === repoRoot — root
  // mode, or a future caller passing the wrong path) that write would
  // clobber the REAL .envrc with the worktree-delegation stub. This is
  // exactly how 763da4d6 merged a corrupted `.envrc` to main (C-400):
  // realpathSync.native() both sides so a trailing slash, symlink, or
  // drive-letter case difference can't slip past the check on Windows
  // (path.resolve alone would still treat `C:\Repo` and `c:\repo` as
  // different paths), then compare case-insensitively on Windows.
  const canonicalCheckout = realpathSync.native(checkoutPath);
  const canonicalRoot = realpathSync.native(repoRoot);
  const samePath =
    process.platform === 'win32'
      ? canonicalCheckout.toLowerCase() === canonicalRoot.toLowerCase()
      : canonicalCheckout === canonicalRoot;
  if (samePath) {
    throw new Error(
      `bootstrapWorktree refused: checkoutPath equals repoRoot (${repoRoot}). ` +
        'This would overwrite the real .envrc with the worktree-delegation stub. ' +
        'bootstrapWorktree is for worktree checkouts only — root-mode runs must not call it.',
    );
  }

  // ── 1. skip-worktree — workspace-local tracked files stay local ──
  // Applied BEFORE the .envrc write below so there is no window where the
  // corrupted content sits in the index unprotected. Per path: `git
  // update-index --skip-worktree` fails the WHOLE invocation if any listed
  // path is not in the index, so one missing file would disable the bit for
  // all of them — apply one at a time. `.envrc` and `.pi/settings.json`
  // always exist and must never fail silently: a failure here is exactly
  // the upstream cause of the corrupted-.envrc-on-main incident (C-400),
  // so it is reported loudly instead of swallowed.
  const ALWAYS_PRESENT_SKIP_WORKTREE_PATHS = new Set(['.envrc', '.pi/settings.json']);
  for (const path of WORKTREE_SKIP_WORKTREE_PATHS) {
    try {
      runGit(`update-index --skip-worktree '${path}'`, { cwd: checkoutPath });
    } catch (err: unknown) {
      if (ALWAYS_PRESENT_SKIP_WORKTREE_PATHS.has(path)) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `❌ skip-worktree failed for ${path} — this path can now leak into commits from ` +
            `this worktree (${checkoutPath}). ${msg}`,
        );
        reportInfraIssue({
          component: 'worktree_bootstrap',
          operation: `skip-worktree ${path}`,
          error: err,
          context: { checkoutPath },
          cwd: repoRoot,
        });
      }
      // Otherwise non-fatal — the file may not exist in older revisions.
    }
  }

  // ── 2. .envrc — delegate to repo root where flake.nix is git-tracked ──
  writeFileSync(
    join(checkoutPath, '.envrc'),
    `# Worktree direnv — delegate to repo root where flake.nix is Git-tracked
source_env ${repoRoot}
export CONTRACT_PIPELINE_WORKTREE=1
`,
  );
  try {
    execSync('direnv allow', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: checkoutPath,
      timeout: 5000,
      // Windows: hide the cmd.exe console window this spawn would otherwise flash.
      windowsHide: true,
    });
  } catch (err: unknown) {
    // direnv may not be installed — not fatal. The .envrc stays in place
    // for machines that DO use direnv; everyone else runs on their own
    // shell env (manual tool installs + .env.local fallback).
    if (hasDirenv()) {
      // direnv IS installed but `direnv allow` still failed — that's a real
      // degradation (the worktree won't get the flake devShell env even
      // though the tool is present), worth surfacing.
      reportInfraIssue({
        component: 'worktree_bootstrap',
        operation: 'direnv allow',
        error: err,
        context: { checkoutPath },
        cwd: repoRoot,
      });
    }
  }
  if (!hasDirenv()) {
    console.log(
      `ℹ️  direnv not installed — worktree runs with your shell env (no flake devShell). ` +
        'Install tools manually or set up direnv + nix (`bun run setup`).',
    );
  }

  // ── 3. .pi deps — symlink node_modules so pi + extensions resolve deps ──
  // `.pi/node_modules` is bun's resolution path when loading extension files
  // from .pi/extensions/; `.pi/npm/node_modules` serves the pi-extensions
  // package. Both are gitignored and absent in a fresh checkout — link them
  // to the root copies (shared bun cache makes a local install unnecessary).
  //
  // 🔴 A real directory symlink ('dir') needs SeCreateSymbolicLinkPrivilege
  // on Windows — without Developer Mode enabled or an elevated shell,
  // symlinkSync throws EPERM, and the old code swallowed that silently
  // ("already exists or unsupported — fall through"), leaving the worktree
  // with no .pi deps and every pi extension failing to resolve with no
  // message pointing at the cause. A junction needs no privilege on Windows
  // for directories specifically (POSIX ignores the type argument and
  // treats it as 'dir'), so it is the correct type on every platform here —
  // this isn't a fallback, it removes the privilege requirement entirely.
  const dirSymlinkType = process.platform === 'win32' ? 'junction' : 'dir';
  mkdirSync(join(checkoutPath, '.pi'), { recursive: true });
  for (const rel of ['.pi/node_modules', '.pi/npm/node_modules']) {
    const src = join(repoRoot, rel);
    const dst = join(checkoutPath, rel);
    if (existsSync(src) && !existsSync(dst)) {
      try {
        symlinkSync(src, dst, dirSymlinkType);
      } catch (err: unknown) {
        // Last resort: a copy is stale the moment the root's deps change,
        // but a worktree with stale deps beats one with none and no
        // indication why. Reported either way — this should be rare now
        // that Windows uses a junction, so a hit here is worth investigating.
        try {
          cpSync(src, dst, { recursive: true });
          console.warn(
            `⚠️  Could not symlink ${rel} (${err instanceof Error ? err.message : String(err)}) — ` +
              `copied instead. This copy will go stale if root deps change; re-run bootstrap to refresh.`,
          );
        } catch (copyErr: unknown) {
          console.warn(
            `⚠️  Could not link or copy ${rel} into ${checkoutPath} — pi extensions may fail to resolve deps there.`,
          );
          reportInfraIssue({
            component: 'worktree_bootstrap',
            operation: `link .pi deps: ${rel}`,
            error: copyErr,
            context: {
              checkoutPath,
              symlinkError: err instanceof Error ? err.message : String(err),
            },
            cwd: repoRoot,
          });
        }
      }
    }
  }

  // ── 4. Seed gitignored-but-required files ──
  if (seed) {
    seedWorktreeFiles({ checkoutPath, repoRoot });
  }

  // ── 5. Seed worktree deps (workaround for bun 1.4.0 Windows bug) ──
  // 🔴 bun 1.4.0 on Windows fails to install workspace packages with `/` in
  // their names (e.g. `@aikami/frontend/engine`) with "is not a valid install
  // folder name". Fix: create node_modules as a real directory, copy .bun cache
  // from root, create @aikami symlinks to worktree's own source dirs, and
  // junction per-app node_modules for vite/pixi.js.
  let installed = false;
  if (options.install !== false) {
    const worktreeNodeModules = join(checkoutPath, 'node_modules');
    if (!existsSync(worktreeNodeModules)) {
      mkdirSync(worktreeNodeModules, { recursive: true });
      // Junction .bun cache from root (non-workspace deps)
      // 🔴 cpSync fails with EPERM on symlinks inside the cache. Use junction instead.
      const rootBunCache = join(repoRoot, 'node_modules', '.bun');
      if (existsSync(rootBunCache)) {
        try {
          symlinkSync(rootBunCache, join(worktreeNodeModules, '.bun'), 'junction');
        } catch (err: unknown) {
          console.warn(
            `⚠️  Could not junction .bun cache: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      // Create @aikami symlinks to worktree's own workspace source dirs
      const aikamiDir = join(worktreeNodeModules, '@aikami');
      mkdirSync(aikamiDir, { recursive: true });
      const workspaces =
        (
          JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
            workspaces?: string[];
          }
        ).workspaces ?? [];
      for (const wsGlob of workspaces) {
        const base = wsGlob.replace(/\*$/, '');
        const dir = join(checkoutPath, base);
        if (!existsSync(dir)) {
          continue;
        }
        for (const entry of readdirSync(dir)) {
          const pkgPath = join(dir, entry, 'package.json');
          if (!existsSync(pkgPath)) {
            continue;
          }
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
          if (!pkg.name?.startsWith('@aikami/')) {
            continue;
          }
          const parts = pkg.name.slice('@aikami/'.length).split('/');
          const targetDir = join(aikamiDir, ...parts);
          const srcDir = join(dir, entry);
          mkdirSync(join(targetDir, '..'), { recursive: true });
          try {
            symlinkSync(srcDir, targetDir, 'junction');
          } catch (err: unknown) {
            console.warn(
              `⚠️  Could not link ${pkg.name}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
      // ── node_modules/.bin — required for the pre-commit hook ──
      // 🔴 Without this the worktree has no `moon`, `biome` or `tsc` on its
      // resolution path, so `bun run pre-commit` (from .moon/hooks/pre-commit,
      // which every worktree inherits via the shared core.hooksPath) dies at
      // step 2 and the implementer agent's own commits go through unchecked.
      //
      // A link to root's `.bin` is correct rather than a copy: the shims
      // inside are RELATIVE symlinks (`moon -> ../@moonrepo/cli/moon.js`), so
      // they resolve against root's real node_modules where those packages
      // actually live. Moon still treats the worktree as its own workspace
      // root — it walks up from cwd for `.moon/`, which the worktree has —
      // so the checks run against worktree code, not root's.
      const rootBin = join(repoRoot, 'node_modules', '.bin');
      const worktreeBin = join(worktreeNodeModules, '.bin');
      if (existsSync(rootBin) && !existsSync(worktreeBin)) {
        try {
          symlinkSync(rootBin, worktreeBin, dirSymlinkType);
        } catch (err: unknown) {
          console.warn(
            `⚠️  Could not link node_modules/.bin (${err instanceof Error ? err.message : String(err)}) — ` +
              'pre-commit checks will be skipped in this worktree.',
          );
        }
      }

      // Junction per-app node_modules from root (vite, pixi.js, etc.)
      for (const wsGlob of workspaces) {
        const base = wsGlob.replace(/\*$/, '');
        const rootDir = join(repoRoot, base);
        const worktreeDir = join(checkoutPath, base);
        if (!existsSync(rootDir) || !existsSync(worktreeDir)) {
          continue;
        }
        for (const entry of readdirSync(rootDir)) {
          const srcNm = join(rootDir, entry, 'node_modules');
          const dstNm = join(worktreeDir, entry, 'node_modules');
          if (existsSync(srcNm) && !existsSync(dstNm)) {
            try {
              symlinkSync(srcNm, dstNm, 'junction');
            } catch {
              // skip
            }
          }
        }
      }
      installed = true;
    } else {
      // node_modules already exists — run bun install normally
      const timeoutMs = options.installTimeoutMs ?? 180_000;
      try {
        execSync('bun install --frozen-lockfile', {
          cwd: checkoutPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: timeoutMs,
          windowsHide: true,
        });
        installed = true;
      } catch (err: unknown) {
        console.warn(
          `⚠️  bun install failed in ${checkoutPath}. Run it manually: cd ${checkoutPath} && bun install`,
        );
        reportInfraIssue({
          component: 'worktree_bootstrap',
          operation: 'bun install --frozen-lockfile',
          error: err,
          context: { checkoutPath },
          cwd: repoRoot,
        });
      }
    }
  }

  return { installed };
};

/** Copy gitignored-but-required files from the root checkout into the worktree. */
export const seedWorktreeFiles = (options: { checkoutPath: string; repoRoot: string }): void => {
  const { checkoutPath, repoRoot } = options;
  for (const entry of WORKTREE_SEED_PATHS) {
    const src = join(repoRoot, entry.from);
    const dst = join(checkoutPath, entry.to);
    if (!existsSync(src)) {
      if (!entry.optional) {
        console.warn(`⚠️  Required seed file missing in root: ${entry.from}`);
      }
      continue;
    }
    try {
      if (entry.kind === 'dir') {
        if (!existsSync(dst)) {
          cpSync(src, dst, { recursive: true });
        }
      } else {
        mkdirSync(join(dst, '..'), { recursive: true });
        if (!existsSync(dst)) {
          copyFileSync(src, dst);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Could not seed ${entry.from} → ${entry.to}: ${message}`);
    }
  }
};

/**
 * Last resort: free a finished contract's dev-server ports so a leftover
 * process (implementer left `client` running) doesn't block the
 * next contract that happens to land on the same offset. Derives the
 * contract ID from the worktree folder name (e.g.
 * `contract-task-c-379-msqg9jqx`, hence case-insensitive) and reuses
 * `killPort()`'s existing process-name safety check — never touches a port
 * held by something that isn't one of our own dev tools. Best-effort: never
 * throws, never blocks the removal it runs after.
 */
const killContractPorts = async (checkoutPath: string): Promise<void> => {
  const contractId = checkoutPath.match(/(c-\d+|mig-\d+)/i)?.[0];
  const offset = contractPortOffset(contractId);
  if (offset === 0) {
    return;
  }
  const ports = [
    PORTS.emulator.client,
    PORTS.emulator.hub,
    PORTS.emulator.site,
    PORTS.emulator.auth,
    PORTS.emulator.functions,
    PORTS.emulator.hosting,
    PORTS.emulator.pubsub,
    PORTS.emulator.storage,
    PORTS.emulator.emulatorHub,
  ];
  await Promise.all(ports.map((port) => killPort(port + offset).catch(() => {})));
};

/**
 * Refuse the rmSync removal fallback unless `checkoutPath` is a genuine
 * non-root git-linked worktree. Two checks, both must pass:
 *  1. canonical checkoutPath !== canonical repoRoot (case-insensitive on
 *     Windows) — rmSync(repoRoot) would recursively delete the ENTIRE repo.
 *  2. a `.git` FILE marker exists at the target — linked worktrees get a
 *     `.git` file (gitdir: ...), while repo roots get a `.git` directory;
 *     without the marker the target is not a managed git worktree and
 *     rmSync would eat arbitrary user data.
 */
const assertManagedWorktreeTarget = (checkoutPath: string, repoRoot: string): void => {
  const canonicalPath = realpathSync.native(checkoutPath);
  const canonicalRoot = realpathSync.native(repoRoot);
  const samePath =
    process.platform === 'win32'
      ? canonicalPath.toLowerCase() === canonicalRoot.toLowerCase()
      : canonicalPath === canonicalRoot;
  if (samePath) {
    throw new Error(
      `refusing to rm -rf ${checkoutPath}: it equals the repo root (${repoRoot}) — ` +
        'this would delete the entire repository.',
    );
  }
  let gitMarker: ReturnType<typeof statSync> | undefined;
  try {
    gitMarker = statSync(join(checkoutPath, '.git'));
  } catch {
    gitMarker = undefined;
  }
  if (!gitMarker?.isFile()) {
    throw new Error(
      `refusing to rm -rf ${checkoutPath}: no git-worktree .git marker file found — ` +
        'the target is not a non-root managed git worktree.',
    );
  }
};

/**
 * Stop everything the contract owns that would otherwise still be running
 * INSIDE the checkout when we try to delete it.
 *
 * 🔴 This is the single biggest cause of "cannot delete worktree". Dev
 * services started from an implementer/verifier/review tab run with their cwd
 * inside the checkout (that is the point — they serve the branch's code), and
 * a live vite keeps writing into `.svelte-kit`/`node_modules` while the
 * removal is in flight. `git worktree remove` then reports the tree as
 * modified and refuses, and herdr's own right-click "delete worktree" — which
 * does not force — fails the same way. Killing the services first turns a
 * flaky removal into a deterministic one.
 *
 * Best-effort throughout: this runs ahead of a removal that must proceed
 * regardless, so nothing here throws.
 */
const stopServicesInCheckout = async (checkoutPath: string): Promise<void> => {
  const contractId = checkoutPath.match(/(C-\d+|MIG-\d+)/i)?.[0]?.toUpperCase();
  if (!contractId) {
    return;
  }
  // One workspace per contract (CONTRACT_WORKSPACE_PREFIX) — closing its
  // dev-service tabs kills the pane shells and, with them, the servers.
  const workspaceId = await findWorkspace(`${CONTRACT_WORKSPACE_PREFIX}${contractId}`).catch(
    () => null,
  );
  if (workspaceId) {
    const serviceNames = new Set(KNOWN_SERVICES.map((service) => SERVICE_DEFS[service].name));
    for (const tab of await getWorkspaceTabs(workspaceId).catch(() => [])) {
      if (serviceNames.has(tab.label)) {
        await herdr(['tab', 'close', tab.tab_id]).catch(() => {});
      }
    }
  }
  // Belt and braces: a server that outlived its pane still holds the port
  // (and its cwd inside the checkout). killPort only kills our own dev-tool
  // process names, never a bystander.
  await killContractPorts(checkoutPath);
};

/**
 * Remove a worktree: herdr state + checkout together, then optionally the
 * local and/or remote branch. herdr `worktree remove` NEVER deletes the
 * branch — that is always a separate explicit git step here.
 */
export const removeWorktree = async (
  options: RemoveWorktreeOptions,
): Promise<RemoveWorktreeResult> => {
  const { repoRoot } = options;
  ensureGitRepo(repoRoot);

  let workspaceId = options.workspaceId;
  let checkoutPath = options.checkoutPath;
  // Resolve whichever of the pair the caller did not supply. Both matter:
  // the workspace id drives herdr's own removal, and the checkout path is
  // what every fallback below needs — without it, a failed herdr removal has
  // nowhere to fall back TO and the orphan survives.
  if (!(workspaceId && checkoutPath)) {
    const worktrees = await listWorktrees(repoRoot).catch(() => []);
    const entry = checkoutPath
      ? worktrees.find((w) => w.path === checkoutPath)
      : worktrees.find((w) => w.openWorkspaceId === workspaceId);
    workspaceId = workspaceId ?? entry?.openWorkspaceId;
    checkoutPath = checkoutPath ?? entry?.path;
  }

  // 🔴 Kill what is running inside the checkout BEFORE trying to delete it.
  // See stopServicesInCheckout — a live dev server in there is what makes a
  // removal fail (and then silently leave an orphan behind).
  if (checkoutPath) {
    await stopServicesInCheckout(checkoutPath).catch(() => {});
  }

  let checkoutRemoved = false;
  let reason: string | undefined;
  if (workspaceId) {
    const args = ['worktree', 'remove', '--workspace', workspaceId];
    if (options.force) {
      args.push('--force');
    }
    const r = await herdrJson<WorktreeRemoveResult>(args, { timeoutMs: 30_000 });
    if (r?.result) {
      checkoutRemoved = true;
    } else {
      reason = `herdr worktree remove returned no result for workspace ${workspaceId}`;
    }
  }
  // 🔴 Not `else if`. When a workspace id WAS known but herdr's removal
  // failed, the old code stopped here and reported failure — no git fallback
  // was ever attempted, so the checkout stayed on disk and `git worktree
  // list` kept an entry for it forever. That is exactly how a repo
  // accumulates a pile of dead `contract-task-c-NNN-*` worktrees: herdr's
  // remove refuses a dirty tree (the common state after a run), and nothing
  // downstream picked the job back up. Every path now falls through to the
  // git-level removal below.
  if (!checkoutRemoved && checkoutPath) {
    try {
      runGit(`worktree remove '${checkoutPath}' --force`, { cwd: repoRoot });
      checkoutRemoved = true;
      reason = undefined;
    } catch (gitErr: unknown) {
      try {
        // 🔴 Validate BEFORE the recursive delete. git worktree remove just
        // failed, so the only thing standing between this path and
        // rmSync(checkoutPath) is this guard — without it, a checkoutPath
        // equal to repoRoot would recursively delete the entire repository
        // and a plain directory would be deleted as arbitrary user data.
        assertManagedWorktreeTarget(checkoutPath, repoRoot);
        // 🔴 node:fs rmSync, not `execSync('rm -rf ...')` — the latter never
        // worked on Windows (no `rm` binary) and, independent of that, hand
        // POSIX-quoting a path for cmd.exe leaks the literal quote
        // characters into the argument instead of protecting it (F-02).
        // rmSync needs neither a shell nor an external binary, so there is
        // nothing to quote and nothing platform-specific to get wrong.
        rmSync(checkoutPath, { recursive: true, force: true });
        checkoutRemoved = true;
        reason = undefined;
        reportInfraIssue({
          component: 'worktree_remove',
          operation: 'git worktree remove (fell back to rmSync)',
          error: gitErr,
          context: { checkoutPath },
          cwd: repoRoot,
        });
      } catch (rmErr: unknown) {
        const g = gitErr instanceof Error ? gitErr.message : String(gitErr);
        const r2 = rmErr instanceof Error ? rmErr.message : String(rmErr);
        reason = `git worktree remove failed (${g}); rm -rf failed (${r2})`;
      }
    }
  }
  if (!(checkoutRemoved || checkoutPath || workspaceId)) {
    reason = 'No workspace id or checkout path provided';
  }

  if (checkoutRemoved && workspaceId) {
    // Only herdr's own `worktree remove` closes the workspace as part of the
    // removal. When we got here via the git/rmSync fallback the workspace is
    // still open — on a checkout that no longer exists — so its tabs linger
    // in the switcher as a dead entry the user then has to close by hand.
    await herdr(['workspace', 'close', workspaceId]).catch(() => {});
  }

  if (checkoutRemoved && checkoutPath) {
    // The directory is gone, but git still holds an administrative record of
    // it under .git/worktrees/. Without this prune, `git worktree list` (and
    // therefore `bun run workspace:cleanup`, and herdr's own worktree list)
    // keeps reporting a checkout that no longer exists, and re-creating a
    // worktree on the same branch fails with "already checked out".
    try {
      runGit('worktree prune', { cwd: repoRoot });
    } catch {
      // Best-effort — never fail a successful removal over bookkeeping.
    }
    await killContractPorts(checkoutPath);
  }

  let branchDeleted = !options.branch;
  if (options.branch) {
    // Quote the branch — git refnames permit shell metacharacters.
    const quoted = `'${options.branch.replaceAll("'", "'\\''")}'`;
    if (options.deleteRemoteBranch) {
      try {
        runGit(`push origin --delete ${quoted}`, { cwd: repoRoot });
      } catch {
        // Branch may not exist on remote.
      }
    }
    try {
      runGit(`branch -D ${quoted}`, { cwd: repoRoot });
      branchDeleted = true;
    } catch {
      reason = reason ?? `local branch ${options.branch} could not be deleted`;
    }
  }

  const removed = checkoutRemoved && branchDeleted;
  return { removed, reason: removed ? undefined : (reason ?? 'removal incomplete') };
};

// ── Publishing ─────────────────────────────────────────────

/**
 * Publish a worktree: collision-guard the branch name, commit all changes,
 * push to origin with upstream tracking. Returns the final head branch.
 *
 * Mirrors the contract pipeline's reconcile step but operates on the
 * EXISTING worktree (no re-provisioning).
 */
export const publishWorktree = async (
  options: PublishOptions,
): Promise<{
  headBranch: string;
  headCommit: string;
  checkoutPath: string;
}> => {
  const { checkoutPath, repoRoot } = options;
  if (!existsSync(checkoutPath)) {
    throw new Error(`Cannot publish missing worktree: ${checkoutPath}`);
  }

  let headBranch = runGit('rev-parse --abbrev-ref HEAD', { cwd: checkoutPath });
  if (headBranch === 'HEAD' || headBranch.startsWith('(detached')) {
    // Detached — create a branch at the current commit so push can work.
    const short = runGit('rev-parse --short HEAD', { cwd: checkoutPath });
    headBranch = `task/${sanitizeBranchName(short)}`;
    try {
      runGit(`switch -c ${headBranch}`, { cwd: checkoutPath });
    } catch {
      // Fall through — push will fail loudly if the branch is unusable.
    }
  }

  // Idempotency guard: if the branch already exists on the remote, prefer
  // updating it when the remote ref is an ancestor of the local head (same
  // task, re-publish → the existing PR updates). Only create a new branch
  // on true divergence (rewritten history / unrelated push).
  if (remoteBranchExists({ branchName: headBranch, repoRoot })) {
    try {
      runGit(`fetch origin ${headBranch}`, { cwd: checkoutPath });
    } catch {
      // Non-fatal — ref may already be present locally.
    }
    let isAncestor = false;
    try {
      runGit(`merge-base --is-ancestor origin/${headBranch} HEAD`, { cwd: checkoutPath });
      isAncestor = true;
    } catch {
      // Not an ancestor → divergence.
    }
    if (!isAncestor) {
      const token = Date.now().toString(36).slice(-6);
      const renamed = `${headBranch}-${token}`;
      try {
        runGit(`branch -m ${headBranch} ${renamed}`, { cwd: checkoutPath });
        headBranch = renamed;
      } catch {
        // Rename failed — leave as-is; push will surface the real error.
      }
    }
  }

  const message =
    options.message ??
    `Feat: ${sanitizeBranchName(headBranch.replace(/^task\//, ''))} (${headBranch})`;
  const headCommit = commitAll({
    cwd: checkoutPath,
    message,
    authorName: options.authorName,
    authorEmail: options.authorEmail,
    protectedPaths: WORKTREE_SKIP_WORKTREE_PATHS,
  });
  pushBranch({ cwd: checkoutPath, branchName: headBranch });

  return { headBranch, headCommit, checkoutPath };
};

/**
 * Open a GitHub PR (headBranch → base). Thin wrapper over `gh pr create`
 * so both the CLI and pi extension tools share one implementation.
 */
export const openPullRequest = async (
  options: PullRequestOptions,
): Promise<{ prUrl: string; prNumber: string }> => {
  const args = [
    'pr',
    'create',
    '--head',
    options.headBranch,
    '--base',
    options.base,
    '--title',
    options.title,
  ];
  if (options.body) {
    args.push('--body', options.body);
  }
  if (options.draft) {
    args.push('--draft');
  }
  // 🔴 execFileSync with an argv array, not a hand POSIX-quoted execSync
  // string. `options.title`/`options.body` are free text and can contain
  // anything — the manual `'…'` escaping here only ever protected POSIX
  // shells; on Windows execSync runs through cmd.exe, where a single quote
  // is a literal character, so every quote leaked straight into `gh`'s
  // argv instead of delimiting an argument (F-02). execFileSync never
  // invokes a shell, so there is nothing to escape on either platform.
  const result = execFileSync('gh', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
    // Windows: hide the cmd.exe console window (no-op on POSIX).
    windowsHide: true,
  }).trim();
  const m = result.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  return { prUrl: m?.[0] ?? result, prNumber: m?.[1] ?? '' };
};

/** Convenience: publish + open PR in one call (used by task_open_pr tool). */
export const publishAndOpenPr = async (
  options: PublishOptions & Omit<PullRequestOptions, 'headBranch'>,
): Promise<{
  headBranch: string;
  headCommit: string;
  prUrl: string;
  prNumber: string;
}> => {
  const { headBranch, headCommit } = await publishWorktree(options);
  const { prUrl, prNumber } = await openPullRequest({
    headBranch,
    base: options.base,
    title: options.title,
    body: options.body,
    draft: options.draft,
  });
  return { headBranch, headCommit, prUrl, prNumber };
};

// ── Lookup helpers ─────────────────────────────────────────

/** Find an open task worktree by slug (workspace label aikami-task-<slug>). */
export const findTaskWorkspace = async (slug: string): Promise<string | null> =>
  findWorkspace(`${TASK_WORKSPACE_PREFIX}${sanitizeBranchName(slug)}`);

/** Get a TaskWorktree for an open task workspace label (repo-scoped). */
export const getTaskWorktreeByLabel = async (
  label: string,
  repoRoot?: string,
): Promise<TaskWorktree | null> => {
  const wsId = await findWorkspace(label);
  if (!wsId) {
    return null;
  }
  const entry = (await listWorktrees(repoRoot)).find((w) => w.openWorkspaceId === wsId);
  if (!entry) {
    return null;
  }
  const branch = runGit('rev-parse --abbrev-ref HEAD', { cwd: entry.path });
  return {
    slug: sanitizeBranchName(label.replace(TASK_WORKSPACE_PREFIX, '')),
    branch,
    checkoutPath: entry.path,
    workspaceId: wsId,
    rootPaneId: '',
    tabId: '',
    repoRoot: worktreeRepoRoot(entry.path),
  };
};
