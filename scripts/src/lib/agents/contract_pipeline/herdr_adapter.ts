// scripts/src/lib/agents/contract_pipeline/herdr_adapter.ts
// biome-ignore-all lint/style/useNamingConvention: Herdr JSON fields mirror the external CLI contract

import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { getScriptsEnv } from '../../env/scripts_env';
import { ensureServer, findWorkspace, herdr, herdrJson } from '../../herdr/session.ts';
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
import type { ContractWorkerRole, WorkerLaunchRequest } from './types.ts';
import { PIPELINE_BASE_BRANCH } from './types.ts';

type WorkspaceCreateResult = {
  result: {
    workspace: { workspace_id: string };
    tab: { tab_id: string };
    root_pane: { pane_id: string };
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

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const AGENT_READY_TIMEOUT_MS = 120_000;
const MAX_SEND_ATTEMPTS = 5;
const SHELL_READY_TIMEOUT_MS = 90_000;
const SHELL_NAMES = new Set(['fish', 'bash', 'zsh', 'sh', 'dash']);

type PaneProcessInfoResult = {
  result: { process_info: { foreground_processes: Array<{ name: string }> } };
};

const isShellIdle = async (paneId: string): Promise<boolean> => {
  const info = await herdrJson<PaneProcessInfoResult>(['pane', 'process-info', '--pane', paneId]);
  const procs = info?.result.process_info.foreground_processes;
  return procs ? procs.every((c) => SHELL_NAMES.has(c.name)) : false;
};

const isCommandRunning = async (paneId: string): Promise<boolean> => {
  const info = await herdrJson<PaneProcessInfoResult>(['pane', 'process-info', '--pane', paneId]);
  const procs = info?.result.process_info.foreground_processes;
  return procs ? procs.some((c) => !SHELL_NAMES.has(c.name)) : false;
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

/** Path of the per-run GH_TOKEN file (mode 0600 — never passed as a CLI arg). */
const ghTokenFilePath = (options: { repoRoot: string; runId: string }): string =>
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
 * Tool whitelist per role.
 *
 * 🔴 REMOVED 2026-08-10: per-role tool sandboxing was overengineering — role
 * behavior is prompt-governed. Every pipeline role gets the full toolset,
 * including user-installed custom extensions (pi-claude-bridge AskClaude,
 * web browsing/search, vision tools, GitHub CLI, context-mode, browser
 * inspection, etc.).
 *
 * With `undefined`, {@link _buildWorkerCommand} omits the `--tools` flag
 * entirely, so `pi` loads every registered tool (project + user-level
 * extensions).
 */
const toolsForRole = (_role: ContractWorkerRole): string[] | undefined => {
  return undefined;
};

// ── Adapter interface ───────────────────────────────────────

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
  }): Promise<string>;
  sendReviewMessage(options: { paneId: string; message: string }): Promise<void>;
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
 * @param contractId - Contract ID (e.g. `C-372`), only used in worktree mode.
 * @param rootMode   - Whether the run executes on the root branch.
 */
export const buildWorkspaceLabel = (options: {
  contractId: string;
  rootMode?: boolean;
}): string => {
  const mode = (process.env.AIKAMI_MODE || 'emulator') as string;
  return options.rootMode ? `aikami-${mode}` : `aikami-contract-${options.contractId}`;
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
        (w) => w.openWorkspaceId === existingWorkspaceId,
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
      if (pipelinePane) {
        this._workspaceId = existingWorkspaceId;
        this._pipelinePaneId = pipelinePane.pane_id;
        // Restart `tail -f` if it died (reboot, herdr restart).
        const active = await isCommandRunning(pipelinePane.pane_id).catch(() => false);
        if (!active) {
          await runPaneCommand({
            paneId: pipelinePane.pane_id,
            command: `tail -f ${shellQuote(logPath({ runId: this._runId, cwd: this._repoRoot }))}`,
          });
        }
        if (!this._rootMode) {
          await this._provisionHerdrWorktree(existingWorkspaceId);
        }
        return { workspaceId: this._workspaceId, pipelinePaneId: this._pipelinePaneId };
      }
      const recovered = await herdrJson<TabCreateResult>([
        'tab',
        'create',
        '--workspace',
        existingWorkspaceId,
        '--cwd',
        this._repoRoot,
        '--label',
        'pipeline',
        '--no-focus',
      ]);
      if (!recovered?.result) {
        throw new Error(`Failed to recover pipeline tab for ${this._runId}.`);
      }
      this._workspaceId = existingWorkspaceId;
      this._pipelinePaneId = recovered.result.root_pane.pane_id;
      await runPaneCommand({
        paneId: this._pipelinePaneId,
        command: `tail -f ${shellQuote(logPath({ runId: this._runId, cwd: this._repoRoot }))}`,
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
      this._pipelinePaneId = result.result.root_pane.pane_id;
      await runHerdr(['tab', 'rename', result.result.tab.tab_id, 'pipeline']);
      await runPaneCommand({
        paneId: this._pipelinePaneId,
        command: `tail -f ${shellQuote(logPath({ runId: this._runId, cwd: this._repoRoot }))}`,
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

    const w = await createWorktree({
      slug: this._runId,
      branch,
      base: PIPELINE_BASE_BRANCH,
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
    // `${workspaceId}:1` selectors can drift).
    await runHerdr(['tab', 'rename', w.tabId || `${this._workspaceId}:1`, 'pipeline']);
    await runPaneCommand({
      paneId: this._pipelinePaneId,
      command: `tail -f ${shellQuote(logPath({ runId: this._runId, cwd: this._repoRoot }))}`,
    });
    return { workspaceId: this._workspaceId, pipelinePaneId: this._pipelinePaneId };
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
              command: `tail -f ${shellQuote(logPath({ runId: this._runId, cwd: this._repoRoot }))}`,
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
   */
  private async _sendTaskText(options: { paneId: string; text: string }): Promise<void> {
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
      return;
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
    const env: string[] = [
      `CONTRACT_PIPELINE_RUN_ID=${request.runId}`,
      `CONTRACT_PIPELINE_ROLE=${request.role}`,
      `CONTRACT_PIPELINE_STAGE=${request.stage}`,
      `CONTRACT_PIPELINE_ATTEMPT=${String(request.attempt)}`,
      `CONTRACT_PIPELINE_CONTRACT_PATH=${request.contractPath}`,
      `CONTRACT_PIPELINE_RESULT_PATH=${request.resultPath}`,
      'HERDR_DISABLE_SOUND=1',
    ];
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
    // 🔴 Herdr PTY drops the first character via pane run — keep the leading
    // newline so the dropped char is never 'p' of 'pi'. With env vars moved
    // to tab --env there is no inline env prefix to corrupt.
    const useHeadless = this._useJsonMode(request.role);
    if (useHeadless) {
      const cf = `$(cat ${shellQuote(taskMessagePath)})`;
      return {
        command: [
          '\n',
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
        '\n',
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

    parts.push(
      isRetry
        ? [
            `Continue the ${options.request.role} stage for ${contractId} (attempt ${options.request.attempt}).`,
            '',
            '🔴 RETRY CHECK: Before doing any work, verify whether you already completed this stage:',
            '1. Check if the result file exists at the path in CONTRACT_PIPELINE_RESULT_PATH',
            '2. If it already has a valid status (passed/changes_requested/blocked), just call',
            '   `contract_stage_complete` with that same status. Do NOT redo work.',
            '3. Only do new work if no valid result exists yet.',
          ].join('\n')
        : isInteractiveWriter
          ? [
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
            ].join('\n')
          : `Begin the ${options.request.role} stage for ${contractId}. Assess the current state against the system prompt and ensure the stage is complete.`,
    );
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

    await runPaneCommand({ paneId, command });

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
  }): Promise<string> {
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
        options.yolo && this._workspacePath ? this._workspacePath : this._repoRoot,
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
    // 🔴 Herdr PTY drops the first character via pane run — keep the leading
    // newline so the dropped char is never the first letter of the command.
    const command = [
      '\n',
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
    await runPaneCommand({ paneId, command });
    await this._sendTaskText({
      paneId,
      text: options.yolo
        ? `Review contract run ${this._runId}. YOLO MODE: Create the PR immediately (draft=false). Wait for CodeRabbit review. Apply autofixes. Validate. Merge. Do NOT wait for the user.`
        : `Review contract run ${this._runId}. Present the verified status from the manifest. Do NOT re-run tests — the verifier already passed them. Wait for the user.`,
    });
    return paneId;
  }

  async sendReviewMessage(options: { paneId: string; message: string }): Promise<void> {
    await this._sendTaskText({ paneId: options.paneId, text: options.message });
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
