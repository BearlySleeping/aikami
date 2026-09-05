// scripts/src/lib/agents/contract_pipeline/herdr_adapter.ts
// biome-ignore-all lint/style/useNamingConvention: Herdr JSON fields mirror the external CLI contract

import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { contractPortOffset } from '../../../../../packages/shared/constants/src/index.ts';
import { resolveAikamiMode } from '../../env/mode';
import { getScriptsEnv } from '../../env/scripts_env';
import { findBash, posixQuote } from '../../env/which';
import {
  bashScriptForPane,
  CONTRACT_WORKSPACE_PREFIX,
  detectPaneShell,
  ensureServer,
  findWorkspace,
  herdr,
  herdrJson,
  isIdleShellName,
} from '../../herdr/session.ts';
import {
  bootstrapWorktree,
  createWorktree,
  listWorktrees,
  openWorktree,
  removeWorktree,
} from '../../herdr/worktree.ts';
import { remoteBranchExists, runGit } from '../git_worktree.ts';
import { logPath } from './manifest_store.ts';
import { getContractModelForRole, getContractThinkingForRole } from './models.ts';
import { canSendToReviewPane, readComposer } from './review_pane.ts';
import type { ContractWorkerRole, WorkerLaunchRequest } from './types.ts';
import { PIPELINE_BASE_BRANCH } from './types.ts';

type WorkspaceCreateResult = {
  result: {
    workspace: { workspace_id: string };
    tab: { tab_id: string };
    root_pane: { pane_id: string };
  };
};

type PaneMoveResult = {
  result: {
    move_result: {
      /** The pane AFTER the move — its id differs from the pre-move one. */
      pane: { pane_id: string };
      previous_workspace_id?: string;
    };
  };
};

type TabCreateResult = {
  result: {
    tab: { tab_id: string };
    root_pane: { pane_id: string };
  };
};

type TabListResult = {
  result: { tabs: Array<{ tab_id: string; label: string }> };
};

type PaneListResult = {
  result: { panes: Array<{ pane_id: string; tab_id: string; agent_status?: string }> };
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * Convert a Windows path (`C:\Users\…`) to the Git-Bash form (`/c/Users/…`)
 * that the temp bash script understands. No-op on POSIX, where the path is
 * already forward-slash.
 */
const toGitBashPath = (path: string): string => {
  if (process.platform !== 'win32') {
    return path;
  }
  return path
    .replace(/^([A-Za-z]):[\\/]/, (_match, drive: string) => `/${drive.toLowerCase()}/`)
    .replaceAll('\\', '/');
};

/**
 * Build a pane command that tails the pipeline log.
 *
 * Windows herdr panes (PowerShell here) have no `tail` — the raw command
 * fails with "The term 'tail' is not recognized". Route through bash (Git
 * bash ships with Git on PATH) when available, exactly like wrapCommand does
 * for service panes; the Windows path is converted to Git-Bash form
 * (`/c/…`) before quoting. On POSIX the pane shell is bash, so plain tail
 * works.
 *
 * When bash is missing entirely, PowerShell panes get the native equivalent
 * `Get-Content -LiteralPath '…' -Tail 10 -Wait` (and cmd panes get the same
 * via `powershell -Command …`) instead of a `tail` that cannot exist there;
 * only POSIX/Nushell panes keep plain `tail -f`.
 *
 * 🔴 The pipeline/worktree pane this runs in is NOT created with the
 * `--env PATH=…` forwarding that worker/review tabs get (see
 * `inheritedPathEnv` below) — herdr hands new panes whatever baseline PATH
 * the daemon itself started with, which on Windows routinely lacks Git's
 * `usr\bin`. `findBash()` resolving an absolute bash.exe path sidesteps that
 * for launching bash itself, but a non-login, non-interactive `bash
 * script.sh` never sources `/etc/profile`, so once inside, `tail` still
 * resolves against that same PATH-less pane env and fails with "tail:
 * command not found". Prepending bash's own directory — where `tail.exe`
 * lives alongside it in every Git-for-Windows layout — fixes it without
 * depending on pane env inheritance at all.
 */
const logTailCommand = async (paneId: string, log: string): Promise<string> => {
  const bash = findBash();
  if (bash) {
    const bashBinDir = toGitBashPath(dirname(bash));
    return bashScriptForPane(
      paneId,
      `PATH="${bashBinDir}:$PATH" tail -f ${posixQuote(toGitBashPath(log))}`,
    );
  }
  const shell = await detectPaneShell(paneId);
  if (shell === 'posix' || shell === 'nushell') {
    return `tail -f ${shellQuote(log)}`;
  }
  const psSafeLog = log.replaceAll("'", "''");
  if (shell === 'cmd') {
    return `powershell -NoProfile -NonInteractive -Command "Get-Content -LiteralPath '${psSafeLog}' -Tail 10 -Wait"`;
  }
  return `Get-Content -LiteralPath '${psSafeLog}' -Tail 10 -Wait`;
};

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const AGENT_READY_TIMEOUT_MS = 120_000;
const MAX_SEND_ATTEMPTS = 5;
const SHELL_READY_TIMEOUT_MS = 90_000;

type PaneProcessInfoResult = {
  result: { process_info: { foreground_processes: Array<{ name: string }> } };
};

const isShellIdle = async (paneId: string): Promise<boolean> => {
  const info = await herdrJson<PaneProcessInfoResult>(['pane', 'process-info', '--pane', paneId]);
  const procs = info?.result.process_info.foreground_processes;
  return procs ? procs.every((c) => isIdleShellName(c.name)) : false;
};

const isCommandRunning = async (paneId: string): Promise<boolean> => {
  const info = await herdrJson<PaneProcessInfoResult>(['pane', 'process-info', '--pane', paneId]);
  const procs = info?.result.process_info.foreground_processes;
  return procs ? procs.some((c) => !isIdleShellName(c.name)) : false;
};

const waitForShellReady = async (paneId: string): Promise<boolean> => {
  const deadline = Date.now() + SHELL_READY_TIMEOUT_MS;
  let consecutiveIdle = 0;
  let delay = 500;
  while (Date.now() < deadline) {
    const idle = await isShellIdle(paneId).catch(() => false);
    consecutiveIdle = idle ? consecutiveIdle + 1 : 0;
    if (consecutiveIdle >= 2) {
      return true;
    }
    await sleep(delay);
    delay = Math.min(delay * 1.25, 3_000);
  }
  return false;
};

const runPaneCommand = async (options: { paneId: string; command: string }): Promise<void> => {
  const ready = await waitForShellReady(options.paneId);
  if (!ready) {
    console.warn(`⚠️  Pane ${options.paneId} shell never became idle`);
  }
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    await runHerdr(['pane', 'run', options.paneId, options.command]);
    const dl = Date.now() + 10_000;
    while (Date.now() < dl) {
      if (await isCommandRunning(options.paneId).catch(() => false)) {
        return;
      }
      await sleep(500);
    }
    await sleep(1_000 * attempt);
  }
  console.warn(`⚠️  Command never observed in pane ${options.paneId}`);
};

const runHerdr = async (args: string[]): Promise<void> => {
  const result = await herdr(args);
  if (result.code !== 0) {
    // Include stderr — herdr CLI errors (e.g. not_git_worktree) land there
    // and were previously dropped, producing useless "command failed" errors.
    const detail = (result.stderr.trim() || result.stdout.trim()).slice(0, 500);
    throw new Error(`Herdr command failed: herdr ${args.join(' ')}${detail ? ` — ${detail}` : ''}`);
  }
};

/** Expand base tab args with --env KEY=VALUE entries (shared by workers + review). */
const withEnvArgs = (base: string[], env: string[]): string[] => {
  const args = [...base];
  for (const kv of env) {
    args.push('--env', kv);
  }
  return args;
};

/**
 * 🔴 Force the same PATH the orchestrator itself resolved with into every
 * worker/review pane. Without this, a freshly created herdr tab depends on
 * whatever PATH the herdr daemon (or that pane's own shell-init/direnv hook
 * timing) happens to produce — which is NOT guaranteed to match the
 * direnv/nix-loaded shell `bun run contract` was launched from. Diverging
 * PATH here is the root cause behind "Bun is not defined" / "herdr MCP
 * tooling cannot resolve bun" errors surfacing inside worker and review
 * panes even when `bun` is on the operator's own PATH: the pane silently
 * inherited a different, bun-less PATH and pi's extension host fell back to
 * plain Node instead of shelling out to `bun` (per `.pi/settings.json`'s
 * `npmCommand: ["bun"]`). The orchestrator's own process is always launched
 * via `bun run ...`, so its PATH is trustworthy — propagate it verbatim.
 */
const inheritedPathEnv = (): string[] => (process.env.PATH ? [`PATH=${process.env.PATH}`] : []);

/**
 * Path of the per-run GH_TOKEN file — never passed as a CLI arg (readable
 * via `ps`/`/proc/<pid>/cmdline`). `mode: 0o600` on write restricts it on
 * POSIX; Node ignores that mode bit on Windows beyond read-only, so on
 * Windows the real trust boundary is the user-profile ACL (same as any
 * other file under the repo checkout) rather than a POSIX permission bit.
 * Deleted by the orchestrator's terminal `finally` (see runContractPipeline)
 * once the run reaches any end state — it has no reason to outlive the run.
 */
export const ghTokenFilePath = (options: { repoRoot: string; runId: string }): string =>
  join(options.repoRoot, '.pi/contract-runs', options.runId, 'gh-token');

const atomicWrite = (options: { path: string; content: string }): void => {
  const temporaryPath = `${options.path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, options.content);
  renameSync(temporaryPath, options.path);
};

const extractContractId = (contractPath: string): string => {
  const match = contractPath.match(/(C-\d+|MIG-\d+)/);
  return match?.[0] ?? contractPath.split('/').pop() ?? contractPath;
};

const buildSessionId = (options: { contractId: string; runId: string; role: string }): string =>
  `pi-${options.contractId}-${options.runId}-agent-${options.role}`;

/**
 * Tool filtering per role.
 *
 * Role behavior is prompt-governed (not sandboxed) — each role prompt states
 * what it may/may not do. However, pipeline workers don't need GitHub admin
 * tools (project mutation, workflow, release management) — that's for the
 * review captain only. This coarse split reduces prompt-tax without false
 * failures from role boundary violations.
 *
 * 🔴 Note: if a tool sandboxes by role and returns an error, the worker may
 * stop without calling contract_stage_complete. Only prompt-based guidance
 * can fail a stage; tool unavailability just kills the worker. So this split
 * MUST be advisory: all tools load, prompt forbids their use.
 */
const toolsForRole = (_role: ContractWorkerRole): string[] | undefined => {
  // The tool loader isn't exposed, so just return undefined (all tools load).
  // The prompt-governance will prevent misuse. TODO: revisit if tool sandboxing
  // becomes available without error-without-completion risk.
  return undefined;
};

// ── Adapter interface ───────────────────────────────────────

/** Outcome of spawning the review pane. */
export type ReviewStartResult = {
  paneId: string;
  /**
   * Whether the initial task text actually reached the captain. False means
   * the pane exists but is sitting at an empty prompt — the ONLY case where
   * the orchestrator may type into the review pane on a later resume.
   */
  taskDelivered: boolean;
};

export type ContractHerdrAdapterInterface = {
  initialize(): Promise<{ workspaceId: string; pipelinePaneId: string }>;
  getWorkspaceId(): string;
  getWorkspacePath(): string;
  /** Branch the herdr-native worktree has checked out (worktree mode only). */
  getWorktreeBranch(): string;
  launchWorker(request: WorkerLaunchRequest): Promise<{ paneId: string }>;
  isWorkerActive(paneId: string): Promise<boolean>;
  nudgeWorker(options: { paneId: string; message: string }): Promise<void>;
  isPaneAlive(paneId: string): Promise<boolean>;
  startReview(options: {
    prompt: string;
    contractPath: string;
    reviewDecisionPath: string;
    yolo?: boolean;
    /** Blocked-review recovery (fallback-recovery / post-verify-failure):
     *  the captain diagnoses or recovers (push/PR) instead of a plain
     *  status review. Passed explicitly — never inferred from yolo. */
    blockedReview?: boolean;
    useWorktreeCwd?: boolean;
  }): Promise<ReviewStartResult>;
  /** Guarded write to the human-shared review pane. Resolves false when the
   *  guard refused (agent busy, or the user has unsent text). */
  sendReviewMessage(options: { paneId: string; message: string }): Promise<boolean>;
  /** Herdr `agent_status` for a pane, or undefined when unreported. */
  getAgentStatus(paneId: string): Promise<string | undefined>;
  /** Visible terminal snapshot, or null when the read failed. */
  readPaneText(paneId: string): Promise<string | null>;
};

// ── Implementation ──────────────────────────────────────────

/**
 * Build the Herdr workspace label used by the contract pipeline.
 *
 * Root mode reuses the standard `aikami-{mode}` workspace so all stages run
 * from the repo root; otherwise a per-contract workspace is used. The
 * orchestrator's lock staleness check must build the SAME label — extract it
 * here so the two can never drift.
 *
 * 🔴 In worktree mode this is the SAME label `herdr/session.ts`'s
 * `buildSessionName(emulator, contractId)` produces, and deliberately so:
 * one contract = one workspace, holding the pipeline tabs, the agent tabs
 * AND every dev service an agent starts. Both sides build it from the shared
 * CONTRACT_WORKSPACE_PREFIX so they cannot drift apart.
 *
 * The mode is not in the worktree-mode label: contract-scoped dev services
 * are emulator-only by construction (see `buildSessionName`), so there is
 * never a second, differently-moded contract workspace to disambiguate from.
 *
 * @param contractId - Contract ID (e.g. `C-372`), only used in worktree mode.
 * @param rootMode   - Whether the run executes on the root branch.
 */
export const buildWorkspaceLabel = (options: {
  contractId: string;
  rootMode?: boolean;
}): string => {
  const mode = resolveAikamiMode();
  return options.rootMode ? `aikami-${mode}` : `${CONTRACT_WORKSPACE_PREFIX}${options.contractId}`;
};

export class ContractHerdrAdapter implements ContractHerdrAdapterInterface {
  private readonly _repoRoot: string;
  private readonly _runId: string;
  private readonly _contractId: string;
  private readonly _workspaceLabel: string;
  private readonly _headless: boolean;
  /** When true, the writer stage runs in interactive TUI mode so the user can
   *  chat directly with the writer pi session to describe the feature. Other
   *  stages remain headless JSON. */
  private readonly _interactiveWriter: boolean;
  /** When true, use the standard aikami-{mode} workspace and skip
   *  git worktree provisioning. All stages run from the repo root. */
  private readonly _rootMode: boolean;
  /** The herdr pane this orchestrator process is itself running in, when
   *  `bun run contract` launched it into one (see `launchBackground`). It
   *  becomes the `pipeline` tab — see {@link _installPipelinePane}.
   *
   *  🔴 Never defaulted from `HERDR_PANE_ID`. That env var is set in EVERY
   *  herdr pane, including the user's own terminal — so a foreground
   *  `bun run contract --no-background` typed into their working tab would
   *  yank that tab out of their workspace and into the contract's. Only the
   *  launcher, which created a pane specifically to host this process, is
   *  allowed to say "this pane is yours". */
  private readonly _hostPaneId: string;
  private _workspaceId = '';
  private _pipelinePaneId = '';
  private _workspacePath = '';
  private _worktreeBranch = '';

  constructor(options: {
    repoRoot: string;
    runId: string;
    contractId: string;
    headless?: boolean;
    interactiveWriter?: boolean;
    rootMode?: boolean;
    /** Pane created by the launcher to host this process, if any — it becomes
     *  the `pipeline` tab. Only the launcher may set this; see _hostPaneId. */
    hostPaneId?: string;
  }) {
    this._repoRoot = options.repoRoot;
    this._runId = options.runId;
    this._contractId = options.contractId;
    this._workspaceLabel = buildWorkspaceLabel({
      contractId: options.contractId,
      rootMode: options.rootMode,
    });
    this._headless = options.headless ?? process.env.CONTRACT_PIPELINE_HEADLESS !== '0';
    this._interactiveWriter = options.interactiveWriter ?? false;
    this._rootMode = options.rootMode ?? false;
    this._hostPaneId = options.hostPaneId ?? '';
  }

  async initialize(): Promise<{ workspaceId: string; pipelinePaneId: string }> {
    await ensureServer();
    const label = this._workspaceLabel;
    let existingWorkspaceId = await findWorkspace(label);

    // 🔴 Stale-workspace guard (worktree mode only). The workspace label is
    // contract-scoped (aikami-contract-C-XXX), NOT run-scoped — a leftover
    // workspace from a TERMINAL run of the same contract would otherwise be
    // adopted below, silently handing the new run the OLD run's checkout and
    // branch (cross-run contamination). The branch embeds the runId token
    // (contract-task-c-XXX-<runToken>), so the branch is the discriminator:
    // adopt only when it matches THIS run; otherwise tear the stale workspace
    // down and provision fresh. Root mode is exempt — aikami-{mode} is shared
    // with dev services and must never be closed.
    if (existingWorkspaceId && !this._rootMode) {
      const expected = this._baseContractBranch();
      const singleSuffix = new RegExp(`^${expected}-[0-9a-z]{1,6}$`);
      const entry = (await listWorktrees(this._repoRoot)).find(
        (wt) => wt.openWorkspaceId === existingWorkspaceId,
      );
      // Only tear down when the branch mismatch is CONFIRMED. An absent
      // entry (workspace open but no worktree record) is unknown — never
      // destroy a workspace whose branch we cannot verify.
      const isStale =
        entry !== undefined && entry.branch !== expected && !singleSuffix.test(entry.branch);
      if (isStale) {
        console.log(
          `🧹 Removing stale contract workspace (branch ${entry?.branch ?? 'unknown'} ≠ ${expected}).`,
        );
        try {
          await removeWorktree({
            workspaceId: existingWorkspaceId,
            repoRoot: this._repoRoot,
            // Keep the old branch — it may back an open PR (pr_created).
            // Only the workspace + checkout go away; `bun run workspace:cleanup`
            // handles branches.
            branch: undefined,
          });
          // Give herdr a beat to reap the workspace before we recreate it.
          await sleep(500);
          existingWorkspaceId = null;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `⚠️  Could not remove stale workspace ${existingWorkspaceId}: ${msg.slice(0, 200)} — ` +
              'proceeding with the existing workspace (recovery path).',
          );
        }
      }
    }
    if (existingWorkspaceId) {
      const tabs = await herdrJson<TabListResult>([
        'tab',
        'list',
        '--workspace',
        existingWorkspaceId,
      ]);
      const panes = await herdrJson<PaneListResult>([
        'pane',
        'list',
        '--workspace',
        existingWorkspaceId,
      ]);
      const pipelineTab = tabs?.result.tabs.find((t) => t.label === 'pipeline');
      const pipelinePane = pipelineTab
        ? panes?.result.panes.find((p) => p.tab_id === pipelineTab.tab_id)
        : undefined;
      this._workspaceId = existingWorkspaceId;
      await this._installPipelinePane({
        workspaceId: existingWorkspaceId,
        reuseTabId: pipelineTab?.tab_id,
        reusePaneId: pipelinePane?.pane_id,
      });
      if (!this._rootMode) {
        await this._provisionHerdrWorktree(existingWorkspaceId);
      }
      return { workspaceId: this._workspaceId, pipelinePaneId: this._pipelinePaneId };
    }

    if (this._rootMode) {
      // Root mode: standard aikami-{mode} workspace at the repo root, no worktree.
      const result = await herdrJson<WorkspaceCreateResult>([
        'workspace',
        'create',
        '--cwd',
        this._repoRoot,
        '--label',
        label,
        '--no-focus',
      ]);
      if (!result?.result) {
        throw new Error(`Failed to create Herdr workspace for ${this._runId}.`);
      }
      this._workspaceId = result.result.workspace.workspace_id;
      // Unhosted: the fresh root pane becomes the `tail -f` pipeline tab.
      // Hosted: this process's own pane is moved in as `pipeline` and this
      // root tab is closed — see _installPipelinePane.
      await runHerdr(['tab', 'rename', result.result.tab.tab_id, 'pipeline']);
      await this._installPipelinePane({
        workspaceId: this._workspaceId,
        reuseTabId: result.result.tab.tab_id,
        reusePaneId: this._hostPaneId ? undefined : result.result.root_pane.pane_id,
      });
      return { workspaceId: this._workspaceId, pipelinePaneId: this._pipelinePaneId };
    }

    // ── Worktree mode: `herdr worktree create` provisions the checkout AND
    //    opens it as a herdr workspace grouped with the parent repo. The
    //    worktree workspace IS the pipeline workspace — no separate
    //    root-scoped workspace, no custom .pi/workspaces provisioning.
    //    Checkouts live in ~/.herdr/worktrees/<repo>/<slug> (outside the
    //    repo), so concurrent sessions on the root checkout are unaffected.
    const baseBranchName = this._baseContractBranch();
    // Collision guard: a LOCAL branch with the same name (surviving a prior
    // run that was never pushed, or whose remote branch was deleted) breaks
    // `herdr worktree create --branch <existing>` just like a remote one.
    const localExists = ((): boolean => {
      try {
        runGit(`rev-parse --verify refs/heads/${baseBranchName}`, { cwd: this._repoRoot });
        return true;
      } catch {
        return false;
      }
    })();
    const branch =
      localExists || remoteBranchExists({ branchName: baseBranchName, repoRoot: this._repoRoot })
        ? `${baseBranchName}-${Date.now().toString(36).slice(-6)}`
        : baseBranchName;

    // Retire earlier runs' checkouts for this contract before adding another.
    await this._pruneAbandonedContractWorktrees(branch);

    const w = await createWorktree({
      slug: this._runId,
      branch,
      base: this._worktreeSourceBranch(),
      label,
      repoRoot: this._repoRoot,
    });
    this._workspaceId = w.workspaceId;
    this._pipelinePaneId = w.rootPaneId;
    this._workspacePath = w.checkoutPath;
    this._worktreeBranch = w.branch;

    await bootstrapWorktree({ checkoutPath: w.checkoutPath, repoRoot: this._repoRoot });
    console.log(
      `🔧 herdr worktree: ${w.checkoutPath} (branch: ${w.branch}, workspace: ${w.workspaceId})`,
    );

    // Rename the worktree's root tab by its real tab id (positional
    // `${workspaceId}:1` selectors can drift). Hosted runs then move this
    // process's own pane in as `pipeline` and close this tab instead.
    const rootTabId = w.tabId || `${this._workspaceId}:1`;
    await runHerdr(['tab', 'rename', rootTabId, 'pipeline']);
    await this._installPipelinePane({
      workspaceId: this._workspaceId,
      reuseTabId: rootTabId,
      reusePaneId: this._hostPaneId ? undefined : w.rootPaneId,
    });
    return { workspaceId: this._workspaceId, pipelinePaneId: this._pipelinePaneId };
  }

  /**
   * Make the workspace's `pipeline` tab exist and point `_pipelinePaneId` at
   * it. Two shapes, one tab either way:
   *
   *  - **Hosted** (the normal `bun run contract` launch). The orchestrator
   *    process is itself running in a herdr pane — `launchBackground` put it
   *    there so it would survive the launching terminal closing. That pane is
   *    MOVED into the contract workspace and labelled `pipeline`, so the tab
   *    you open is the live process, not a view of it.
   *
   *    🔴 This is what removed the second tab. Before, the hosted pane was
   *    relocated as its own `launcher` tab while a separate `pipeline` tab ran
   *    `tail -f` on the run log — two tabs for one pipeline, showing two
   *    different halves of its output (console-only in one, `pipelineLog`
   *    milestones in the other), and no single place to read the run. The log
   *    file is no longer the poorer copy: `teePipelineLog` mirrors this
   *    process's stdout/stderr into it, so the file is a superset and the tab
   *    is the live view of it.
   *
   *  - **Unhosted** (`--no-background`, or a resume driven from a plain
   *    terminal). There is no pane to adopt, so a tab is created running
   *    `tail -f` on the run log, exactly as before.
   *
   * @param options.workspaceId - Contract workspace to install the tab into.
   * @param options.reuseTabId - An existing `pipeline` tab: reused when
   *   unhosted, retired when hosted (the adopted pane replaces it).
   * @param options.reusePaneId - That tab's pane, if known.
   */
  private async _installPipelinePane(options: {
    workspaceId: string;
    reuseTabId?: string;
    reusePaneId?: string;
  }): Promise<void> {
    const { workspaceId, reuseTabId, reusePaneId } = options;

    if (this._hostPaneId) {
      const moved = await herdrJson<PaneMoveResult>([
        'pane',
        'move',
        this._hostPaneId,
        '--new-tab',
        '--workspace',
        workspaceId,
        '--label',
        'pipeline',
        '--no-focus',
      ]);
      // 🔴 The pane gets a NEW id on the far side of the move (ids are
      // workspace-scoped: `w70:p1` becomes `w81:p2`), even though the PTY and
      // the process inside it are the same. Reusing `_hostPaneId` here would
      // leave every later `pane read` / `process-info` call pointing at an id
      // that no longer resolves. Take the id herdr reports back.
      const movedPaneId = moved?.result?.move_result?.pane?.pane_id;
      if (movedPaneId) {
        this._pipelinePaneId = movedPaneId;
        // Retire whatever tab was going to be the pipeline view: a stale
        // `tail -f` tab from a previous run, or the empty root tab herdr
        // created with the workspace. Losing either is the point.
        if (reuseTabId) {
          await herdr(['tab', 'close', reuseTabId]).catch(() => {});
        }
        // The pane's previous workspace is the throwaway
        // `aikami-launcher-<token>` one. `pane move` auto-closes a workspace
        // it empties (confirmed against herdr 0.8.2, which reports it as
        // `closed_workspace_id`), so this is a defensive second pass, not the
        // primary cleanup — and it must never fire against the workspace we
        // just moved INTO.
        const vacated = moved.result.move_result.previous_workspace_id;
        if (vacated && vacated !== workspaceId) {
          await herdr(['workspace', 'close', vacated]).catch(() => {});
        }
        return;
      }
      // Never fail a run over tab cosmetics — fall through to the tail tab,
      // which leaves the hosted pane where it is (its own workspace). The
      // pipeline itself is unaffected either way.
      console.warn(
        '⚠️  Could not adopt the hosting pane as the pipeline tab — ' +
          'falling back to a `tail -f` tab (the launcher pane stays in its own workspace).',
      );
    }

    const command = async (paneId: string): Promise<string> =>
      logTailCommand(paneId, logPath({ runId: this._runId, cwd: this._repoRoot }));

    if (reusePaneId) {
      // Restart `tail -f` if it died (reboot, herdr restart).
      const active = await isCommandRunning(reusePaneId).catch(() => false);
      this._pipelinePaneId = reusePaneId;
      if (!active) {
        await runPaneCommand({ paneId: reusePaneId, command: await command(reusePaneId) });
      }
      return;
    }

    if (reuseTabId) {
      // A `pipeline` tab exists but has no pane (herdr state half-torn-down
      // by a crash). Retire it rather than ending up with two tabs of the
      // same name, only one of which shows anything.
      await herdr(['tab', 'close', reuseTabId]).catch(() => {});
    }
    const created = await herdrJson<TabCreateResult>([
      'tab',
      'create',
      '--workspace',
      workspaceId,
      '--cwd',
      this._repoRoot,
      '--label',
      'pipeline',
      '--no-focus',
    ]);
    if (!created?.result) {
      throw new Error(`Failed to create the pipeline tab for ${this._runId}.`);
    }
    this._pipelinePaneId = created.result.root_pane.pane_id;
    await runPaneCommand({
      paneId: this._pipelinePaneId,
      command: await command(this._pipelinePaneId),
    });
  }

  getWorkspaceId(): string {
    if (!this._workspaceId) {
      throw new Error('Herdr workspace is not initialized.');
    }
    return this._workspaceId;
  }
  getWorkspacePath(): string {
    return this._workspacePath;
  }
  /** Branch the worktree has checked out (worktree mode only). */
  getWorktreeBranch(): string {
    return this._worktreeBranch;
  }

  /**
   * Resolve the herdr-native worktree state for an existing pipeline
   * workspace (recovery after a crash / resume). The checkout survives
   * `workspace close` — re-derive its path from herdr provenance and
   * re-open it if the workspace was closed.
   */
  private async _provisionHerdrWorktree(workspaceId: string): Promise<void> {
    if (this._rootMode) {
      this._workspacePath = '';
      return;
    }
    const worktrees = await listWorktrees(this._repoRoot);
    // 1. Look up the open worktree by workspace id.
    let entry = worktrees.find((w) => w.openWorkspaceId === workspaceId);
    // 2. Fall back: the workspace may have been closed but the checkout
    //    persists — find it by branch name and re-open it. Accept only the
    //    exact branch or its single collision-suffix form, and prefer the
    //    exact name (publishWorktree may append a further suffix after a
    //    remote collision, so a looser tail is tolerated for the exact base).
    if (!entry) {
      const branch = this._baseContractBranch();
      const singleSuffix = new RegExp(`^${branch}-[0-9a-z]{1,6}$`);
      const candidates = worktrees.filter(
        (w) => w.branch === branch || singleSuffix.test(w.branch),
      );
      const candidate =
        candidates.find((w) => w.branch === branch) ??
        candidates.sort((a, b) => b.branch.localeCompare(a.branch))[0];
      if (candidate) {
        const opened = await openWorktree({
          checkoutPath: candidate.path,
          label: this._workspaceLabel,
          repoRoot: this._repoRoot,
        });
        if (opened.workspaceId !== workspaceId) {
          // The workspace changed — the old `_pipelinePaneId` points into a
          // closed workspace. Re-create the pipeline tab in the new one so
          // `_workspaceId` and `_pipelinePaneId` stay consistent.
          this._workspaceId = opened.workspaceId;
          const tab = await herdrJson<TabCreateResult>([
            'tab',
            'create',
            '--workspace',
            opened.workspaceId,
            '--cwd',
            this._repoRoot,
            '--label',
            'pipeline',
            '--no-focus',
          ]);
          if (tab?.result) {
            this._pipelinePaneId = tab.result.root_pane.pane_id;
            await runPaneCommand({
              paneId: this._pipelinePaneId,
              command: await logTailCommand(
                this._pipelinePaneId,
                logPath({ runId: this._runId, cwd: this._repoRoot }),
              ),
            });
          }
        } else {
          this._workspaceId = opened.workspaceId;
        }
        entry = candidate;
        entry.openWorkspaceId = opened.workspaceId;
      }
    }
    if (!entry) {
      throw new Error(
        `Cannot recover herdr worktree for run ${this._runId} (workspace ${workspaceId}). ` +
          'The checkout was removed externally — start a fresh run.',
      );
    }
    this._workspacePath = entry.path;
    this._worktreeBranch = entry.branch;
    console.log(
      `🔧 herdr worktree recovered: ${entry.path} (branch: ${entry.branch}, workspace: ${this._workspaceId})`,
    );
  }

  /** Base branch name for this run's worktree (no collision suffix). */

  /**
   * Source ref the herdr worktree is checked out from — deliberately NOT
   * `PIPELINE_BASE_BRANCH` (that constant is the pipeline's *PR target*,
   * always `main`; see its doc comment in types.ts).
   *
   * Launching a contract from a feature branch should hand the worker a
   * checkout of THAT branch's current code, not silently rebase them onto
   * `origin/main` — otherwise the implementer/verifier never see your
   * in-flight branch work, and the run diverges from what you were doing
   * when you launched it. `createWorktree()` itself already defaults to the
   * repo root's current branch when `base` is omitted (see
   * `herdr/worktree.ts`'s `createWorktree`) — this mirrors that so the
   * pipeline stops overriding it with a hardcoded `main`.
   *
   * `CONTRACT_PIPELINE_BASE_BRANCH`, when set, is an explicit operator
   * choice and wins over the current branch. Detached HEAD (rare — a CI
   * checkout, a rebase in progress) falls back to `PIPELINE_BASE_BRANCH`
   * since there is no current branch to read.
   */
  private _worktreeSourceBranch(): string {
    if (process.env.CONTRACT_PIPELINE_BASE_BRANCH) {
      return PIPELINE_BASE_BRANCH;
    }
    try {
      const current = runGit('rev-parse --abbrev-ref HEAD', { cwd: this._repoRoot });
      return current === 'HEAD' ? PIPELINE_BASE_BRANCH : current;
    } catch {
      return PIPELINE_BASE_BRANCH;
    }
  }

  /**
   * Remove checkouts left behind by EARLIER runs of this same contract.
   *
   * 🔴 The branch (and therefore the worktree) is per-RUN, not per-contract:
   * `contract-task-c-428-<runToken>`. So every restart of a contract —
   * `--fresh`, a crash-and-relaunch, a blocked run the user re-ran — provisions
   * a brand new checkout, while the previous run's checkout stays on disk
   * forever. The stale-workspace guard in `initialize()` only catches the case
   * where the old run's herdr WORKSPACE is still open; once that was closed
   * (herdr restart, user closed it, machine reboot) nothing looked at the
   * checkout again. Measured on a real repo: seven dead
   * `contract-task-c-*` worktrees across four contracts, none of them
   * reachable by `workspace:cleanup --pr-merged`, because the merged PR was
   * on the NEXT run's suffixed branch and these branches were never pushed
   * at all.
   *
   * Only unambiguously dead checkouts are removed: no open herdr workspace
   * (a concurrent run for the same contract must survive), no branch on
   * origin, and no PR. Anything that fails those tests is reported and left
   * alone — losing unpushed work to a housekeeping sweep would be far worse
   * than leaving a directory behind.
   */
  private async _pruneAbandonedContractWorktrees(keepBranch: string): Promise<void> {
    const contractId = extractContractId(this._contractId).toLowerCase();
    const prefix = `contract-task-${contractId}-`;
    const worktrees = await listWorktrees(this._repoRoot).catch(() => []);
    for (const entry of worktrees) {
      if (!entry.branch.startsWith(prefix) || entry.branch === keepBranch) {
        continue;
      }
      if (entry.openWorkspaceId) {
        // Another pipeline for this contract may be live in it.
        continue;
      }
      if (remoteBranchExists({ branchName: entry.branch, repoRoot: this._repoRoot })) {
        console.log(
          `ℹ️  Keeping earlier checkout ${entry.branch} — it is still pushed to origin ` +
            '(clean it up with `bun run workspace:cleanup` once its PR is settled).',
        );
        continue;
      }
      const result = await removeWorktree({
        checkoutPath: entry.path,
        repoRoot: this._repoRoot,
        branch: entry.branch,
        force: true,
      });
      console.log(
        result.removed
          ? `🧹 Removed abandoned checkout from an earlier ${this._contractId} run: ${entry.branch}`
          : `⚠️  Could not remove abandoned checkout ${entry.branch}: ${result.reason ?? 'unknown'}`,
      );
    }
  }

  private _baseContractBranch(): string {
    const contractId = extractContractId(this._contractId);
    const runToken = this._runId.replace(/^run-/, '').split('-')[0];
    return `contract-task-${contractId.toLowerCase()}-${runToken}`;
  }

  private async _closeTabByLabel(label: string): Promise<void> {
    const tabs = await herdrJson<TabListResult>(['tab', 'list', '--workspace', this._workspaceId]);
    const existing = tabs?.result.tabs.find((t) => t.label === label);
    if (existing) {
      await runHerdr(['tab', 'close', existing.tab_id]);
    }
  }

  private async _getAgentStatus(paneId: string): Promise<string | undefined> {
    const panes = await herdrJson<PaneListResult>([
      'pane',
      'list',
      '--workspace',
      this._workspaceId,
    ]);
    return panes?.result.panes.find((p) => p.pane_id === paneId)?.agent_status;
  }

  /** Public read of Herdr's `agent_status`, or undefined when unreported. */
  async getAgentStatus(paneId: string): Promise<string | undefined> {
    return this._getAgentStatus(paneId).catch(() => undefined);
  }

  /**
   * Visible terminal snapshot of a pane, or null when the read failed.
   * Callers treat null as "unknown" and must fail safe — see
   * {@link hasPendingUserInput}.
   */
  async readPaneText(paneId: string): Promise<string | null> {
    try {
      const result = await herdr([
        'pane',
        'read',
        paneId,
        '--source',
        'visible',
        '--format',
        'text',
      ]);
      if (result.code !== 0) {
        return null;
      }
      return result.stdout;
    } catch {
      return null;
    }
  }

  private async _waitForAgentStatus(o: {
    paneId: string;
    statuses: readonly string[];
    timeoutMs: number;
  }): Promise<boolean> {
    const dl = Date.now() + o.timeoutMs;
    let delay = 500;
    while (Date.now() < dl) {
      const s = await this._getAgentStatus(o.paneId).catch(() => undefined);
      if (s !== undefined && o.statuses.includes(s)) {
        return true;
      }
      await sleep(delay);
      delay = Math.min(delay * 1.5, 5_000);
    }
    return false;
  }

  /**
   * Send task text to a pane, with retry if the prompt is not acknowledged.
   * Text is sent ONCE (never re-sent — duplicates would fill the input buffer).
   * Only Enter is retried with exponential backoff.
   *
   * @returns whether the text was actually delivered. A `false` here is what
   *   lets the caller distinguish "the agent has its task" from "the agent is
   *   sitting at an empty prompt" — the only situation in which nudging the
   *   review pane later is legitimate.
   */
  private async _sendTaskText(options: { paneId: string; text: string }): Promise<boolean> {
    // Double-idle check: two consecutive idle observations are much stronger
    // evidence that pi's input handler is truly ready. If agent_status is
    // unavailable (pi doesn't report it to herdr), fall back to a fixed delay.
    for (const delay of [0, 500]) {
      await sleep(delay);
      const ready = await this._waitForAgentStatus({
        paneId: options.paneId,
        statuses: ['idle', 'blocked'],
        timeoutMs: AGENT_READY_TIMEOUT_MS,
      });
      if (ready) {
        continue;
      }
      // Agent status may not be reported by this pi session.
      // If pi is running in the pane, proceed after a brief init delay.
      if (await isCommandRunning(options.paneId).catch(() => false)) {
        console.warn(
          `⚠️  Pane ${options.paneId} agent_status unavailable — proceeding with fixed delay.`,
        );
        await sleep(5000);
        break;
      }
      console.warn(`⚠️  Pane ${options.paneId} never became receptive — skipping send.`);
      return false;
    }

    // 🔴 Herdr bug: pane send-text drops the first character — prepend space.
    await runHerdr(['pane', 'send-text', options.paneId, ` ${options.text}`]);

    // Dynamic buffer delay: proportional to text length, 500ms min, 2000ms max.
    const bufferWaitMs = Math.min(Math.max(500, options.text.length * 2), 2000);
    await sleep(bufferWaitMs);

    // 🔴 PTY reliability: send Enter multiple times with backoff.
    // herdr pane send-keys Enter is unreliable — the first press may not
    // register. Multiple presses are harmless (extra newlines in pi's
    // input are either processed as empty turns or ignored).
    // No acceptance check — isCommandRunning always true for pi itself.
    for (const delay of [200, 400, 800, 1600]) {
      await runHerdr(['pane', 'send-keys', options.paneId, 'Enter']);
      await sleep(delay);
    }
    return true;
  }

  /** JSON mode (no PTY): headless AND not an interactive writer.
   *  Hoisted so both _buildWorkerCommand and _createWorkerTab
   *  use the same decision — prevents the latent bug where one
   *  site builds a TUI command but the other skips the PTY send. */
  private _useJsonMode(role: ContractWorkerRole): boolean {
    return this._headless && !(this._interactiveWriter && role === 'writer');
  }

  private _buildWorkerCommand(
    request: WorkerLaunchRequest,
    sessionId: string | undefined,
    taskMessagePath: string,
  ): { command: string; env: string[] } {
    const pd = join(this._repoRoot, '.pi/contract-runs', request.runId, 'prompts');
    mkdirSync(pd, { recursive: true });
    const pp = join(pd, `${request.stage}-${request.attempt}.md`);
    atomicWrite({ path: pp, content: request.prompt });
    // Env vars are passed via `tab create --env KEY=VALUE` (herdr sets them
    // on the tab's shell) instead of inline `KEY=V pi ...` shell prefixes.
    // This eliminates the inline-env first-character-drop hazard entirely.
    // Same offset formula as scripts/src/lib/herdr/session.ts's dev-service
    // tabs — a pure function of the contract ID, so both sides land on the
    // same value independently. Lets chrome_devtools.ts (running in this
    // pi tab) inspect the correct per-contract client instance.
    const portOffset = contractPortOffset(extractContractId(request.contractPath));
    const env: string[] = [
      `CONTRACT_PIPELINE_RUN_ID=${request.runId}`,
      `CONTRACT_PIPELINE_ROLE=${request.role}`,
      `CONTRACT_PIPELINE_STAGE=${request.stage}`,
      `CONTRACT_PIPELINE_ATTEMPT=${String(request.attempt)}`,
      `CONTRACT_PIPELINE_CONTRACT_PATH=${request.contractPath}`,
      `CONTRACT_PIPELINE_RESULT_PATH=${request.resultPath}`,
      `PUBLIC_EMULATOR_PORT_OFFSET=${portOffset}`,
      'HERDR_DISABLE_SOUND=1',
      ...inheritedPathEnv(),
    ];
    if (request.generation !== undefined) {
      env.push(`CONTRACT_PIPELINE_GENERATION=${String(request.generation)}`);
    }
    if (this._workspacePath) {
      env.push(`CONTRACT_PIPELINE_WORKSPACE_PATH=${this._workspacePath}`);
    }
    // 🔴 GH_TOKEN is a secret — never pass it as a `--env` CLI argument
    // (readable via ps /proc/<pid>/cmdline). Write it to a mode-0600 file
    // and let the worker shell export it from there.
    let ghExport = '';
    const ghToken = getScriptsEnv('GH_TOKEN') || getScriptsEnv('GITHUB_TOKEN');
    if (ghToken) {
      const ghFile = ghTokenFilePath({ repoRoot: this._repoRoot, runId: request.runId });
      mkdirSync(dirname(ghFile), { recursive: true });
      writeFileSync(ghFile, ghToken, { mode: 0o600 });
      env.push(`GH_TOKEN_FILE=${ghFile}`);
      ghExport = `export GH_TOKEN="$(cat '${ghFile}' 2>/dev/null)"; `;
    }
    const ta = toolsForRole(request.role) ? ['--tools', toolsForRole(request.role)?.join(',')] : [];
    const sa = sessionId !== undefined ? ['--session-id', shellQuote(sessionId)] : [];
    const ma = [
      '--model',
      shellQuote(getContractModelForRole(request.role)),
      '--thinking',
      getContractThinkingForRole(request.role),
    ];
    // 🔴 Default: use JSON mode for pipeline workers — PTY keystroke injection
    // (send-text + send-keys Enter) is fundamentally unreliable. The prompt
    // is passed via -p and the task message via $(cat ...).
    //
    // Exceptions:
    // - CONTRACT_PIPELINE_HEADLESS=0 → TUI for all stages (manual debugging)
    // - interactiveWriter + writer role → TUI so the user can chat directly
    //   with the writer pi session to describe the feature
    //
    // This command is bash syntax (`export ...; pi ...`) — the caller wraps
    // it via `bashScriptForPane` before sending, since a pane's actual shell
    // may be PowerShell on Windows, not bash (see `_createWorkerTab`).
    const useHeadless = this._useJsonMode(request.role);
    if (useHeadless) {
      const cf = `$(cat ${shellQuote(taskMessagePath)})`;
      return {
        command: [
          ghExport,
          'pi',
          '--mode',
          'json',
          '--approve',
          ...ma,
          ...sa,
          '--append-system-prompt',
          shellQuote(pp),
          ...ta,
          '-p',
          `"${cf}"`,
        ].join(' '),
        env,
      };
    }
    // TUI mode — no -p, prompt is sent via _sendTaskText to the PTY.
    return {
      command: [
        ghExport,
        'pi',
        '--approve',
        ...ma,
        ...sa,
        '--append-system-prompt',
        shellQuote(pp),
        ...ta,
      ].join(' '),
      env,
    };
  }

  private async _createWorkerTab(options: {
    tabLabel: string;
    sessionId: string | undefined;
    request: WorkerLaunchRequest;
  }): Promise<{ paneId: string }> {
    const isolationRoles: ContractWorkerRole[] = ['implementer', 'verifier'];
    const cwd =
      isolationRoles.includes(options.request.role) && this._workspacePath
        ? this._workspacePath
        : this._repoRoot;
    if (cwd !== this._repoRoot && existsSync(options.request.contractPath)) {
      const wcp = join(cwd, relative(this._repoRoot, options.request.contractPath));
      mkdirSync(dirname(wcp), { recursive: true });
      copyFileSync(options.request.contractPath, wcp);
    }
    // (Paraglide + .env seeding moved to bootstrapWorktree — it runs once
    // at initialize(), so worker tabs no longer need to copy them.)
    const { command, env } = this._buildWorkerCommand(
      options.request,
      options.sessionId,
      this._taskMessagePath(options.request),
    );
    const tabArgs = withEnvArgs(
      [
        'tab',
        'create',
        '--workspace',
        this._workspaceId,
        '--cwd',
        cwd,
        '--label',
        options.tabLabel,
        '--no-focus',
      ],
      env,
    );
    const tab = await herdrJson<TabCreateResult>(tabArgs);
    if (!tab?.result) {
      throw new Error(`Failed to create ${options.request.role} worker tab.`);
    }
    const paneId = tab.result.root_pane.pane_id;

    const contractId = extractContractId(options.request.contractPath);
    const isRetry = options.request.attempt > 1;
    const parts: string[] = [];

    // Interactive writer: wait for user to describe the feature, then create the contract.
    const isInteractiveWriter =
      this._interactiveWriter && options.request.role === 'writer' && !isRetry;

    let stagePreamble: string;
    if (isRetry) {
      stagePreamble = [
        `Continue the ${options.request.role} stage for ${contractId} (attempt ${options.request.attempt}).`,
        '',
        '🔴 RETRY CHECK: Before doing any work, verify whether you already completed this stage:',
        '1. Check if the result file exists AT THE EXACT PATH in the CONTRACT_PIPELINE_RESULT_PATH',
        "   env var for THIS attempt — not a previous attempt's file sitting in the same directory.",
        '2. If it exists there with status `passed` or `changes_requested`, that is real completed',
        '   work product — just call `contract_stage_complete` with that same status. Do NOT redo work.',
        "3. A previous attempt's `blocked` result does NOT satisfy this check, even if you find one:",
        '   `blocked` reflects an external precondition (contract status, missing dependency, service',
        '   down, etc.) that may have changed since. Re-run the Preflight checks fresh and only report',
        '   `blocked` again if the condition still actually holds right now.',
        '4. Otherwise, do new work.',
      ].join('\n');
    } else if (isInteractiveWriter) {
      stagePreamble = [
        `👋 Direct contract drafting for ${contractId}.`,
        '',
        'You are WAITING for the user to describe their feature in this chat.',
        '',
        '🔴 DO NOT DO ANY WORK YET:',
        '- Do NOT inspect the codebase, scan the backlog, or write any file.',
        '- Do NOT call `contract_stage_complete` before the contract is written.',
        '',
        'The input box is empty. The user will type their feature description',
        'and press Enter — THAT is your input to act on.',
        '',
        'Once the user has described the feature:',
        '',
        '1. Derive a short slug from the described feature (lowercase, hyphens,',
        '   max ~60 chars, e.g. "npc-free-text-dialogue").',
        `2. Create the real contract at \`docs/contracts/${contractId}-<slug>.md\`.`,
        `   This renames the placeholder \`docs/contracts/${contractId}.md\``,
        '   (the pipeline removes the placeholder file automatically).',
        '3. Read `docs/contracts/TEMPLATE.md` — the canonical v2.0.0 template.',
        '   Direct drafts have NO docs/TODO.md entry, so do NOT call',
        '   `contract_generate` (it only works for backlog IDs).',
        '4. Inspect the codebase to fill in architecture directives, data models,',
        '   and baseline evidence.',
        '5. Write concrete Given/When/Then acceptance criteria. Fill every',
        '   section — no TBD or placeholders.',
        '6. Set status to `draft` and call `contract_stage_complete` with',
        '   status `passed`.',
        '',
        '🔴 Your LAST action MUST call contract_stage_complete.',
      ].join('\n');
    } else {
      stagePreamble = `Begin the ${options.request.role} stage for ${contractId}. Assess the current state against the system prompt and ensure the stage is complete.`;
    }
    parts.push(stagePreamble);
    if (options.request.userMessage) {
      parts.push(options.request.userMessage);
    }
    if (!isInteractiveWriter) {
      parts.push(
        'Your LAST action MUST call contract_stage_complete. Even if already complete, call it with passed.',
        'Printing a text summary without the tool call will block the pipeline forever.',
        'Do not ask questions — if blocked, finish with status blocked.',
      );
    }

    const taskMessagePath = this._taskMessagePath(options.request);
    mkdirSync(dirname(taskMessagePath), { recursive: true });
    atomicWrite({ path: taskMessagePath, content: parts.join('\n\n') });

    // `command` is bash syntax (`export ...; pi ...`) — wrap it for the
    // pane's actual shell (PowerShell on Windows never understands `export`
    // or `2>/dev/null`; sending it raw silently drops GH_TOKEN and prints
    // parse errors). 🔴 Herdr PTY drops the first character via `pane run` —
    // keep the leading newline so the dropped char is never load-bearing.
    const wrappedCommand = `\n${await bashScriptForPane(paneId, command)}`;
    await runPaneCommand({ paneId, command: wrappedCommand });

    if (!this._useJsonMode(options.request.role)) {
      // TUI mode — send task text via PTY.
      if (isRetry) {
        await this._sendTaskText({
          paneId,
          text: `${parts[0]} Read your full task brief at ${taskMessagePath} FIRST. Pick up where you left off. Your LAST action MUST call contract_stage_complete. Do not ask questions; if blocked, finish with status blocked.`,
        });
      } else if (isInteractiveWriter) {
        // 🔴 Leave the input box EMPTY and do not send anything. The agent
        // must not take a turn — it would start working (or abort) before the
        // user has described their feature. The user types their description
        // into the empty chat field and presses Enter themselves.
      } else {
        await this._sendTaskText({
          paneId,
          text: `${parts[0]} Read your full task brief at ${taskMessagePath} FIRST, then execute it. Your LAST action MUST call contract_stage_complete — a text summary without the tool call blocks the pipeline forever. Do not ask questions; if blocked, finish with status blocked.`,
        });
      }
    }
    return { paneId };
  }

  /** Path of the worker task brief (written by _createWorkerTab). */
  private _taskMessagePath(request: WorkerLaunchRequest): string {
    return join(
      this._repoRoot,
      '.pi/contract-runs',
      request.runId,
      'prompts',
      `${request.stage}-${request.attempt}-task.md`,
    );
  }

  async launchWorker(request: WorkerLaunchRequest): Promise<{ paneId: string }> {
    if (!this._workspaceId) {
      throw new Error('Herdr workspace is not initialized.');
    }
    const contractId = extractContractId(request.contractPath);
    const sessionId = buildSessionId({ contractId, runId: request.runId, role: request.role });
    await this._closeTabByLabel(request.role);
    return this._createWorkerTab({ tabLabel: request.role, sessionId, request });
  }

  async startReview(options: {
    prompt: string;
    contractPath: string;
    reviewDecisionPath: string;
    yolo?: boolean;
    /** Blocked-review recovery (fallback-recovery / post-verify-failure). */
    blockedReview?: boolean;
    /** Run the review pane from the worktree checkout instead of the repo
     *  root. Needed whenever the captain must inspect or touch the actual
     *  implementation (YOLO, post-verify-failure, fallback-recovery) —
     *  everything it would push/test lives on the worktree's branch, not
     *  root. Plain READY-mode reviews stay at the repo root: their job is
     *  GH-admin (gh_create_pr / gh pr ready), and running `gh` from inside a
     *  linked worktree is a known source of "worktree" errors (see
     *  yolo-overrides.md's merge-fallback note) — not worth the risk when
     *  there's no code to inspect yet. */
    useWorktreeCwd?: boolean;
  }): Promise<ReviewStartResult> {
    if (!this._workspaceId) {
      throw new Error('Herdr workspace is not initialized.');
    }
    const contractId = extractContractId(options.contractPath);
    const sessionId = buildSessionId({ contractId, runId: this._runId, role: 'review' });
    await this._closeTabByLabel('review');

    // Review env vars via tab --env (same mechanism as workers).
    const reviewEnv: string[] = [
      `CONTRACT_PIPELINE_RUN_ID=${this._runId}`,
      'CONTRACT_PIPELINE_ROLE=review',
      `CONTRACT_PIPELINE_CONTRACT_PATH=${options.contractPath}`,
      `CONTRACT_PIPELINE_REVIEW_PATH=${options.reviewDecisionPath}`,
      `PUBLIC_EMULATOR_PORT_OFFSET=${contractPortOffset(contractId)}`,
      ...inheritedPathEnv(),
    ];
    if (this._workspacePath) {
      reviewEnv.push(`CONTRACT_PIPELINE_WORKSPACE_PATH=${this._workspacePath}`);
    }
    // GH_TOKEN via a mode-0600 file — never as a --env CLI arg (see
    // _buildWorkerCommand for the same pattern).
    let ghExport = '';
    const ghToken = getScriptsEnv('GH_TOKEN') || getScriptsEnv('GITHUB_TOKEN');
    if (ghToken) {
      const ghFile = ghTokenFilePath({ repoRoot: this._repoRoot, runId: this._runId });
      mkdirSync(dirname(ghFile), { recursive: true });
      writeFileSync(ghFile, ghToken, { mode: 0o600 });
      reviewEnv.push(`GH_TOKEN_FILE=${ghFile}`);
      ghExport = `export GH_TOKEN="$(cat '${ghFile}' 2>/dev/null)"; `;
    }

    const tabArgs = withEnvArgs(
      [
        'tab',
        'create',
        '--workspace',
        this._workspaceId,
        '--cwd',
        (options.useWorktreeCwd ?? options.yolo ?? options.blockedReview) && this._workspacePath
          ? this._workspacePath
          : this._repoRoot,
        '--label',
        'review',
        '--no-focus',
      ],
      reviewEnv,
    );
    const tab = await herdrJson<TabCreateResult>(tabArgs);
    if (!tab?.result) {
      throw new Error('Failed to create review tab.');
    }

    const promptPath = join(
      this._repoRoot,
      '.pi/contract-runs',
      this._runId,
      'prompts',
      'review.md',
    );
    mkdirSync(dirname(promptPath), { recursive: true });
    mkdirSync(dirname(options.reviewDecisionPath), { recursive: true });
    atomicWrite({ path: promptPath, content: options.prompt });

    // Review captain runs in TUI mode — needs interactivity to inspect
    // findings, interrupt if needed, and manually intervene. JSON mode
    // is for automated workers only.
    //
    // This is bash syntax (`export ...; pi ...`) — wrap it for the pane's
    // actual shell (PowerShell on Windows never understands `export` or
    // `2>/dev/null`; sending it raw silently drops GH_TOKEN and prints parse
    // errors). 🔴 Herdr PTY drops the first character via `pane run` — keep
    // the leading newline so the dropped char is never load-bearing.
    const command = [
      ghExport,
      'pi',
      '--approve',
      '--model',
      shellQuote(getContractModelForRole('review')),
      '--thinking',
      getContractThinkingForRole('review'),
      '--session-id',
      shellQuote(sessionId),
      '--append-system-prompt',
      shellQuote(promptPath),
    ].join(' ');

    const paneId = tab.result.root_pane.pane_id;
    const wrappedCommand = `\n${await bashScriptForPane(paneId, command)}`;
    await runPaneCommand({ paneId, command: wrappedCommand });
    let reviewText: string;
    if (options.blockedReview) {
      reviewText = `Review contract run ${this._runId}. RECOVERY MODE: the pipeline is blocked — diagnose the failure from the manifest and findings, then recover it (push/PR creation, small fix) or hand off with a precise summary. Do NOT re-run the verifier's tests. Your LAST action MUST call contract_review_decision.`;
    } else if (options.yolo) {
      reviewText = `Review contract run ${this._runId}. YOLO MODE: Create the PR immediately (draft=false). Wait for CodeRabbit review. Apply autofixes. Validate. Merge. Do NOT wait for the user.`;
    } else {
      reviewText = `Review contract run ${this._runId}. Present the verified status from the manifest. Do NOT re-run tests — the verifier already passed them. Wait for the user.`;
    }
    const taskDelivered = await this._sendTaskText({
      paneId,
      text: reviewText,
    });
    return { paneId, taskDelivered };
  }

  /**
   * Type into the review pane — the ONE pane a human shares with us.
   *
   * 🔴 Unlike worker panes this is never unconditional. The C-390 incident
   * (see review_pane.ts) appended a resume nudge to a half-typed user message
   * and submitted the pair. Guards, in order:
   *
   *   1. Re-read `agent_status` + the visible composer immediately before
   *      sending; abort unless the pane is settled AND the composer is empty.
   *   2. Send ONE Enter, not the four-press launch-time storm — a human pane
   *      has no PTY race to defeat, and extra Enters commit stray keystrokes.
   *   3. Re-check the composer between text and Enter, so a user who starts
   *      typing inside the race window is not submitted on top of.
   *
   * @returns whether the message was actually delivered.
   */
  async sendReviewMessage(options: { paneId: string; message: string }): Promise<boolean> {
    const gate = canSendToReviewPane({
      status: await this.getAgentStatus(options.paneId),
      paneText: await this.readPaneText(options.paneId),
    });
    if (!gate.ok) {
      console.log(`⏭️  Skipped review-pane message — ${gate.reason}.`);
      return false;
    }
    // 🔴 Herdr bug: pane send-text drops the first character — prepend space.
    await runHerdr(['pane', 'send-text', options.paneId, ` ${options.message}`]);
    await sleep(Math.min(Math.max(500, options.message.length * 2), 2000));

    // Last-moment re-check: between the gate above and this Enter the user
    // may have started typing, which send-text would have prefixed. Bail out
    // WITHOUT pressing Enter and let the human clear the line themselves —
    // an uncommitted composer is recoverable, a submitted mashup is not.
    const after = await this.readPaneText(options.paneId);
    const composer = readComposer(after ?? '');
    if (composer.found && composer.text !== '' && !composer.text.includes(options.message.trim())) {
      console.log('⏭️  Review-pane composer changed mid-send — not pressing Enter.');
      return false;
    }
    await runHerdr(['pane', 'send-keys', options.paneId, 'Enter']);
    return true;
  }

  async isWorkerActive(paneId: string): Promise<boolean> {
    try {
      const panes = await herdrJson<PaneListResult>([
        'pane',
        'list',
        '--workspace',
        this._workspaceId,
      ]);
      const pane = panes?.result.panes.find((p) => p.pane_id === paneId);
      if (!pane) {
        return false;
      }
      if (pane.agent_status === 'working') {
        return true;
      }
      // Between LLM turns agent_status is 'idle' but the pi process is
      // still running. Fall back to isCommandRunning for ANY non-working
      // status — if a foreground process is active, the worker is alive.
      if (pane.agent_status !== 'working') {
        return isCommandRunning(paneId).catch(() => false);
      }
      return false;
    } catch {
      return false;
    }
  }

  async isPaneAlive(paneId: string): Promise<boolean> {
    try {
      const panes = await herdrJson<PaneListResult>([
        'pane',
        'list',
        '--workspace',
        this._workspaceId,
      ]);
      return panes?.result.panes.some((p) => p.pane_id === paneId) ?? false;
    } catch {
      return false;
    }
  }

  async nudgeWorker(options: { paneId: string; message: string }): Promise<void> {
    try {
      await sleep(2000);
      await runHerdr(['pane', 'send-text', options.paneId, ` ${options.message}`]);
      await sleep(500);
      await runHerdr(['pane', 'send-keys', options.paneId, 'Enter']);
    } catch {}
  }
}
