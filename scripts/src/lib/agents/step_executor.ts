// scripts/src/lib/agents/step_executor.ts
/**
 * Swarm pipeline executor — state machine (C-311 v2).
 *
 * Replaces the linear "for (const step of steps)" loop with an explicit
 * state machine that supports review feedback loops:
 *
 *   architect → coder → qa → review → git → done
 *                             ↓ (feedback)
 *                         coder → qa → review  (≤ 3 iterations, then escalate)
 *                             ↓ (reject)
 *                            done
 *
 * Key design points:
 *   - Real feedback loop: review gate reads stdin in-process, writes terminal handoff
 *   - Predicate-based waitForHandoff prevents stale reads
 *   - Unlink-before-dispatch guarantees fresh handoffs per iteration
 *   - QA runs coder nextCommands via async spawn in director process (exit codes, not regex)
 *   - git is a deterministic script (no LLM)
 *   - Review runs in git pane as a self-contained stdin-looping script
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SwarmHandoffSchema } from '@aikami/schemas';
import type { SwarmHandoff } from '@aikami/types';
import { Value } from 'typebox/value';
import {
  getModelForTier,
  ROLE_MODEL_TIER,
  ROLE_THINKING_LEVEL,
  type ThinkingLevel,
} from '../../../../.pi/swarm/models';
import type { HerdrSocketClient } from '../herdr/socket_client';
import type { AgentScratchpad } from './agent_scratchpad';
import type { AgentRole, FeedbackEntry, PipelineState, SwarmState } from './types';

// ── Constants ──────────────────────────────────────────────

const PI_STARTUP_GRACE_MS = 3_000;
const STEP_COOLDOWN_MS = 1_000;
const MAX_FEEDBACK_ITERATIONS = 3;
/** Max time for the review gate script to start and write awaiting_approval. */
const GATE_STARTUP_TIMEOUT_MS = 30_000;

// ── Per-role timeouts ──
// Architect: 15 min (planning only — no builds) | Coder/QA: 30 min | Docs: 10 min
const AGENT_TIMEOUT_MS = 1_800_000; // default fallback (30 min)
const ARCHITECT_TIMEOUT_MS = 900_000; // 15 min
const DOCS_TIMEOUT_MS = 600_000; // 10 min

/** Git commit script is deterministic — short timeout. */
const GIT_SCRIPT_TIMEOUT_MS = 300_000; // 5 min

// ── Helpers ────────────────────────────────────────────────

/**
 * Build a combined system prompt by prepending the shared preamble.
 * The preamble is byte-identical across roles → DeepSeek "common prefix detection"
 * persists it as a KV-cache unit. Role-specific content follows after.
 *
 * Writes to .pi/swarm/outputs/<taskId>_sysprompt_<role>.md and returns the
 * absolute path (task-scoped — concurrent tasks never race on the same file).
 */
const buildSystemPrompt = (cwd: string, role: string, taskId: string): string => {
  const preamblePath = join(cwd, '.pi/swarm/prompts/_swarm_preamble.md');
  const rolePromptPath = join(cwd, '.pi/swarm/prompts', `${role}.md`);

  let preamble: string;
  try {
    preamble = readFileSync(preamblePath, 'utf-8');
  } catch {
    preamble = '';
  }

  let rolePrompt: string;
  try {
    rolePrompt = readFileSync(rolePromptPath, 'utf-8');
  } catch {
    rolePrompt = `SWARM AGENT: ${role}.`;
  }

  const combined = `${preamble}\n\n---\n\n${rolePrompt}`;

  mkdirSync(join(cwd, '.pi/swarm/outputs'), { recursive: true });
  const outPath = join(cwd, '.pi/swarm/outputs', `${taskId}_sysprompt_${role}.md`);
  writeFileSync(outPath, combined);
  return outPath;
};

const handoffPath = (taskId: string, role: string, cwd: string): string =>
  join(cwd, '.pi/swarm/outputs', `${taskId}_${role}_handoff.json`);

const planFilePath = (taskId: string, cwd: string): string =>
  join(cwd, '.pi/swarm/plans', `architect_plan_${taskId}.md`);

const feedbackPath = (taskId: string, iteration: number, cwd: string): string =>
  join(cwd, '.pi/swarm/outputs', `${taskId}_feedback_${iteration}.md`);

const readHandoff = (taskId: string, role: string, cwd: string): SwarmHandoff | null => {
  const p = handoffPath(taskId, role, cwd);
  try {
    const raw = readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (Value.Check(SwarmHandoffSchema, parsed)) {
      return parsed as SwarmHandoff;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Wait for a handoff file using fs.watch (event-driven) + polling fallback.
 *
 * Exported for unit testing — the stale-read behavior of this function is
 * load-bearing for the review feedback loop.
 *
 * @param predicate  Only accept handoffs that satisfy this condition.
 *                   Default: any valid handoff. For review: h.status !== 'awaiting_approval'.
 */
export const waitForHandoff = async (
  taskId: string,
  role: string,
  cwd: string,
  timeoutMs: number,
  predicate: (h: SwarmHandoff) => boolean = () => true,
): Promise<SwarmHandoff | null> => {
  const deadline = Date.now() + timeoutMs;

  // Check if a satisfying handoff already exists
  const existing = readHandoff(taskId, role, cwd);
  if (existing && predicate(existing)) {
    return existing;
  }

  return new Promise((resolve) => {
    let resolved = false;
    let watcher: ReturnType<typeof watch> | null = null;

    const settle = (result: SwarmHandoff | null) => {
      if (resolved) {
        return;
      }
      resolved = true;
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      clearInterval(timer);
      clearTimeout(deadlineTimer);
      resolve(result);
    };

    // Precise deadline — not coupled to the poll interval
    const deadlineTimer = setTimeout(() => settle(null), Math.max(0, deadline - Date.now()));

    // Periodic poll as fallback (fs.watch can miss events on some platforms)
    const timer = setInterval(() => {
      const h = readHandoff(taskId, role, cwd);
      if (h && predicate(h)) {
        settle(h);
      }
    }, 2_000);

    // fs.watch for instant detection
    try {
      const outputsDir = join(cwd, '.pi/swarm/outputs');
      watcher = watch(outputsDir, (_eventType, filename) => {
        if (!filename || resolved) {
          return;
        }
        const expectedName = `${taskId}_${role}_handoff.json`;
        if (filename === expectedName) {
          setTimeout(() => {
            const h = readHandoff(taskId, role, cwd);
            if (h && predicate(h)) {
              settle(h);
            }
          }, 200);
        }
      });
    } catch {
      // fs.watch failed — polling timer is the fallback
    }
  });
};

// ── Resume detection ────────────────────────────────────

export type ResumePlan = {
  start: PipelineState;
  /** Roles considered complete from on-disk handoffs */
  completed: AgentRole[];
  reason: string;
};

/**
 * Determine where the pipeline should start based on handoffs already on disk.
 *
 * Resume-by-default: the handoff files are the single source of truth, so a
 * crashed/killed director can pick up exactly where the agents left off.
 *
 * Rules (first missing/invalid artifact wins):
 *   - no architect handoff or no plan file      → architect
 *   - no coder handoff                           → coder
 *   - no qa handoff (unless trivial)             → qa   (green-path qa writes no
 *     handoff, so a deterministic re-run is the safe + cheap resume point)
 *   - review approved + git success              → done (nothing to do)
 *   - review approved, git missing/failed        → git
 *   - review anything else (stale feedback etc.) → review (re-prompt user;
 *     runReview unlinks the stale handoff before dispatch)
 *
 * Exported for unit testing.
 */
export const detectResumeState = (taskId: string, cwd: string): ResumePlan => {
  const completed: AgentRole[] = [];

  const arch = readHandoff(taskId, 'architect', cwd);
  let hasPlan = false;
  try {
    hasPlan = readFileSync(planFilePath(taskId, cwd), 'utf-8').length > 0;
  } catch {
    hasPlan = false;
  }
  if (!arch || !hasPlan) {
    return { start: 'architect', completed, reason: 'no architect handoff/plan' };
  }
  completed.push('architect');

  const coder = readHandoff(taskId, 'coder', cwd);
  if (!coder) {
    return { start: 'coder', completed, reason: 'no coder handoff' };
  }
  completed.push('coder');

  const review = readHandoff(taskId, 'review', cwd);
  const git = readHandoff(taskId, 'git', cwd);

  if (review?.status === 'approved') {
    completed.push('qa');

    // Check if docs is needed and not yet done
    const docs = readHandoff(taskId, 'docs', cwd);
    if (arch.requiresDocs && !docs) {
      return { start: 'docs', completed, reason: 'review approved, docs pending' };
    }
    if (docs) {
      completed.push('docs');
    }

    if (git?.status === 'success') {
      completed.push('git');
      return { start: 'done', completed, reason: 'task already committed' };
    }
    return { start: 'git', completed, reason: 'review approved, commit pending' };
  }

  const qa = readHandoff(taskId, 'qa', cwd);
  if (!qa && arch.complexity !== 'trivial') {
    return { start: 'qa', completed, reason: 'no qa handoff — re-running checks' };
  }
  if (qa) {
    completed.push('qa');
  }

  return { start: 'review', completed, reason: 'awaiting review decision' };
};

// ── State context ──────────────────────────────────────────

type StateContext = {
  taskId: string;
  cwd: string;
  state: SwarmState;
  socketClient: HerdrSocketClient;
  scratchpad: AgentScratchpad;
  /** Resolved absolute path to the contract file */
  contractPath: string;
  /** Base model tier override from --tier flag */
  tier: string;
  /** Skip the review step entirely */
  skipReview: boolean;
  feedbackHistory: FeedbackEntry[];
  iteration: number;
  architectComplexity?: string;
  architectDomain?: string;
  architectRequiresDocs?: boolean;
  /** Per-agent start timestamps for metrics */
  agentStartTimes: Record<string, number>;
  /** Per-agent durations (filled on completion) */
  agentDurations: Record<string, number>;
  /** Set when any state escalates — pipeline result reporting */
  escalated?: boolean;
};

/** Resolve model for a role, with --tier override and complexity-driven adjustments. */
const getModel = (ctx: StateContext, role: AgentRole): string => {
  // --tier pro → force pro everywhere
  if (ctx.tier === 'pro') {
    return getModelForTier('pro');
  }

  // --tier flash → force flash everywhere
  if (ctx.tier === 'flash') {
    return getModelForTier('flash');
  }

  // No --tier specified → per-role matrix with complexity adjustments
  const defaultTier = ROLE_MODEL_TIER[role];
  if (!defaultTier) {
    return getModelForTier('flash');
  }

  // Git + review: deterministic, no LLM (should never reach here but safe-guard)
  if (role === 'git' || role === 'review') {
    return getModelForTier('flash');
  }

  // Coder: flash if architect flagged trivial
  if (role === 'coder' && ctx.architectComplexity === 'trivial') {
    return getModelForTier('flash');
  }

  // QA: pro if architect flagged complex (QA LLM only spawns on test failures and
  // failure diagnosis is reasoning-heavy)
  if (role === 'qa' && ctx.architectComplexity === 'complex') {
    return getModelForTier('pro');
  }

  return getModelForTier(defaultTier);
};

/**
 * Resolve thinking level for a role, with complexity-driven adjustments.
 * DeepSeek bills thinking tokens as output — mechanical roles run low/minimal.
 */
const getThinking = (ctx: StateContext, role: AgentRole): ThinkingLevel => {
  if (role === 'coder' && ctx.architectComplexity === 'trivial') {
    return 'low';
  }
  if (role === 'qa' && ctx.architectComplexity === 'complex') {
    return 'medium';
  }
  return ROLE_THINKING_LEVEL[role] ?? 'medium';
};

/**
 * Build the full `pi` dispatch command for a role.
 *
 * - `SWARM_ROLE=<role>` env prefix activates scope enforcement in
 *   .pi/extensions/swarm_guard.ts (coder blocked from QA-scope paths).
 * - `--thinking <level>` per-role — saves thinking tokens on mechanical roles.
 * - `--session-id swarm-<taskId>-<role>` — enables metrics to read real tokens.
 * - `roleFlags`: extra CLI flags for specific roles (e.g. docs gets --no-skills).
 */
const buildPiCommand = (
  ctx: StateContext,
  role: AgentRole,
  userMessage: string,
  extraFlags: string = '',
): string => {
  const model = getModel(ctx, role);
  const thinking = getThinking(ctx, role);
  const sysPromptPath = buildSystemPrompt(ctx.cwd, role, ctx.taskId);
  const sessionId = `swarm-${ctx.taskId}-${role}`;
  return `SWARM_ROLE=${role} pi --model ${model} --thinking ${thinking} --session-id ${sessionId} --system-prompt '${sysPromptPath}' ${extraFlags} ${userMessage}`.trim();
};

// ── Heartbeat helpers ──────────────────────────────────────

const markWorking = (ctx: StateContext, role: AgentRole): void => {
  const agent = ctx.state.agents[role];
  if (agent) {
    agent.status = 'working';
  }
  ctx.state.lastUpdated = new Date().toISOString();
  ctx.scratchpad.upsertHeartbeat({
    taskId: ctx.taskId,
    workspaceId: ctx.state.workspaceId ?? 'default',
    agentKey: role,
    agentStatus: 'working',
    lastContextHash: null,
    lastHeartbeatTimestamp: Date.now(),
    agentOutput: '',
  });
};

const markDone = (ctx: StateContext, role: AgentRole, summary: string): void => {
  const agent = ctx.state.agents[role];
  if (agent) {
    agent.status = 'done';
  }
  ctx.state.lastUpdated = new Date().toISOString();
  ctx.scratchpad.upsertHeartbeat({
    taskId: ctx.taskId,
    workspaceId: ctx.state.workspaceId ?? 'default',
    agentKey: role,
    agentStatus: 'done',
    lastContextHash: null,
    lastHeartbeatTimestamp: Date.now(),
    agentOutput: summary.slice(0, 4096),
  });
};

const markEscalated = (ctx: StateContext, role: AgentRole, reason: string): void => {
  console.error(`[swarm:escalate] ${role} — ${reason}`);
  ctx.escalated = true;
  // 'blocked' (🔴 in ledger), not 'done' (✅) — escalation must not look like success
  const agent = ctx.state.agents[role];
  if (agent) {
    agent.status = 'blocked';
  }
  ctx.state.lastUpdated = new Date().toISOString();
  ctx.scratchpad.upsertHeartbeat({
    taskId: ctx.taskId,
    workspaceId: ctx.state.workspaceId ?? 'default',
    agentKey: role,
    agentStatus: 'blocked',
    lastContextHash: null,
    lastHeartbeatTimestamp: Date.now(),
    agentOutput: `ESCALATED: ${reason}`.slice(0, 4096),
  });
  try {
    ctx.socketClient.showNotification({
      title: `Swarm ${ctx.taskId}: ${role} escalated`,
      message: reason,
      level: 'error',
    });
  } catch {
    // best-effort
  }
};

/**
 * Run a command in a pane, unlink previous handoff, wait for fresh completion.
 *
 * Live-agent guard: if the pane already has a recognized coding agent (pi, claude,
 * etc.) from a previous run, sends Ctrl+C to kill it before dispatching. Prevents
 * the command from being typed into an existing pi session (nested-pi bug).
 */
const runStep = async (
  ctx: StateContext,
  role: AgentRole,
  command: string,
  paneId: string,
  predicate: (h: SwarmHandoff) => boolean = () => true,
  timeoutMs: number = AGENT_TIMEOUT_MS,
): Promise<SwarmHandoff | null> => {
  markWorking(ctx, role);

  // Track start time for metrics
  ctx.agentStartTimes[role] = Date.now();

  // Unlink stale handoff so waitForHandoff sees only the new one
  try {
    unlinkSync(handoffPath(ctx.taskId, role, ctx.cwd));
  } catch {
    // file didn't exist — fine
  }

  // ── Live-agent guard: don't type pi commands into an existing pi session ──
  const paneInfo = await ctx.socketClient.paneGet(paneId);
  if (paneInfo?.agent) {
    console.debug('[swarm:step:kill-agent]', {
      role,
      agent: paneInfo.agent,
      status: paneInfo.agent_status,
    });
    await ctx.socketClient.paneSendKeys(paneId, 'C-c');
    // Poll until the agent is gone (max 5s) — prevents typing the new command
    // into a dying pi session that hasn't released the terminal yet.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const check = await ctx.socketClient.paneGet(paneId);
      if (!check?.agent) {
        console.debug('[swarm:step:agent-gone]', { role, attempt: i + 1 });
        break;
      }
    }
  }

  // Always prefix with cd to project root — prevents pane cwd pollution
  const safeCommand = `cd '${ctx.cwd}' && ${command}`;
  await ctx.socketClient.paneRun(paneId, safeCommand);
  console.debug('[swarm:state:command-sent]', { role });

  await new Promise((r) => setTimeout(r, PI_STARTUP_GRACE_MS));

  const handoff = await waitForHandoff(ctx.taskId, role, ctx.cwd, timeoutMs, predicate);

  if (handoff) {
    markDone(ctx, role, handoff.summary);
    ctx.agentDurations[role] = Date.now() - (ctx.agentStartTimes[role] ?? Date.now());
  }

  return handoff;
};

// ── Individual state transitions ────────────────────────────

// ── Async spawn helper ────────────────────────────────────

/** Spawn a shell command, collecting stdout+stderr. Returns code, stdout, stderr. */
const spawnAsync = (
  cmd: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd], {
      cwd,
      stdio: 'pipe',
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d: Buffer) => {
      stdout += String(d);
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += String(d);
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      // Give it 2s to flush, then force-kill
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already dead
        }
      }, 2000);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `spawn error: ${err.message}` });
    });
  });

// ── Deterministic check runner (shared: QA pass + trivial-path verify) ──

type CheckFailure = { cmd: string; exitCode: number; tail: string };

const CHECK_CMD_RE = /^(moon run|bun test|bun run (lint|fix|typecheck)|npx tsc)/;

/**
 * Run allowlisted test/lint/typecheck commands asynchronously in the director.
 * Each command runs sequentially (order matters: fix → typecheck → test),
 * but the director's event loop stays responsive during execution.
 * Exit codes, not regex. Non-allowlisted commands are skipped with a warning.
 */
const runDeterministicChecks = async (
  commands: string[],
  cwd: string,
): Promise<{ tested: number; failures: CheckFailure[] }> => {
  const failures: CheckFailure[] = [];
  let tested = 0;

  for (const rawCmd of commands) {
    // Strip leading `cd <dir> && ` to extract the real command + cwd
    const cdMatch = rawCmd.match(/^cd\s+(\S+)\s+&&\s+(.+)$/);
    const cmd = cdMatch ? cdMatch[2] : rawCmd;
    const cmdCwd = cdMatch ? resolve(cwd, cdMatch[1]) : cwd;

    if (!CHECK_CMD_RE.test(cmd)) {
      console.warn('[swarm:checks] skipping non-allowlisted command:', rawCmd);
      continue;
    }

    tested++;
    const start = Date.now();
    console.debug('[swarm:checks:spawn]', { cmd, cwd: cmdCwd });

    const r = await spawnAsync(cmd, cmdCwd, 600_000);

    console.debug('[swarm:checks:done]', {
      cmd,
      code: r.code,
      elapsedMs: Date.now() - start,
    });

    if (r.code !== 0) {
      failures.push({
        cmd,
        exitCode: r.code ?? -1,
        tail: `${r.stdout.slice(-2000)}\n${r.stderr.slice(-2000)}`,
      });
    }
  }

  return { tested, failures };
};

const runArchitect = async (ctx: StateContext): Promise<PipelineState> => {
  const command = buildPiCommand(ctx, 'architect', `'${ctx.contractPath}'`);

  const handoff = await runStep(
    ctx,
    'architect',
    command,
    ctx.state.agents.architect.paneId,
    () => true,
    ARCHITECT_TIMEOUT_MS,
  );
  if (!handoff) {
    markEscalated(ctx, 'architect', 'timed out');
    return 'done';
  }

  ctx.architectComplexity = handoff.complexity;
  ctx.architectDomain = handoff.domain;
  ctx.architectRequiresDocs = handoff.requiresDocs;

  console.log('[swarm:state:architect] complete', {
    complexity: handoff.complexity,
    domain: handoff.domain,
    requiresDocs: handoff.requiresDocs,
  });

  return 'coder';
};

const runCoder = async (ctx: StateContext): Promise<PipelineState> => {
  const planPathVal = join(ctx.cwd, '.pi/swarm/plans', `architect_plan_${ctx.taskId}.md`);

  let userMessage = `'${planPathVal}'`;

  if (ctx.iteration > 0) {
    const fp = feedbackPath(ctx.taskId, ctx.iteration, ctx.cwd);
    userMessage = `'${planPathVal} — REVISION ${ctx.iteration}/${MAX_FEEDBACK_ITERATIONS}: apply the user feedback in ${fp} to the existing implementation. Do NOT re-implement from scratch — fix only what the feedback asks for.'`;
  }

  const command = buildPiCommand(ctx, 'coder', userMessage);

  const handoff = await runStep(ctx, 'coder', command, ctx.state.agents.coder.paneId);
  if (!handoff) {
    markEscalated(ctx, 'coder', 'timed out');
    return 'done';
  }

  console.log('[swarm:state:coder] complete', {
    status: handoff.status,
    filesTouched: handoff.filesTouched.length,
  });

  // Trivial path: skip QA LLM if architect flagged complexity=trivial,
  // but VERIFY the coder's checks deterministically — exit codes, not trust.
  if (ctx.architectComplexity === 'trivial') {
    const { tested, failures } = await runDeterministicChecks(handoff.nextCommands ?? [], ctx.cwd);

    if (failures.length > 0) {
      console.warn('[swarm:state:coder] trivial path checks FAILED — routing to QA', {
        failCount: failures.length,
      });
      return 'qa';
    }

    console.log(`[swarm:state:coder] trivial path — ${tested} checks passed, skipping QA`);
    ctx.state.agents.qa.status = 'done';
    // Route through review — it handles skipReview (auto-approve) itself
    return 'review';
  }

  return 'qa';
};

const runQa = async (ctx: StateContext): Promise<PipelineState> => {
  const coderHandoff = readHandoff(ctx.taskId, 'coder', ctx.cwd);
  const commands = coderHandoff?.nextCommands ?? [];

  const failFilePath = join(ctx.cwd, '.pi/swarm/outputs', `${ctx.taskId}_qa_failures.md`);
  // Remove stale failure file from a previous run/iteration so the QA LLM
  // never reads outdated failures.
  try {
    unlinkSync(failFilePath);
  } catch {
    // didn't exist — fine
  }
  let hadFailures = false;

  // ── Deterministic pass: run commands in director via spawnSync ──
  if (commands.length > 0) {
    markWorking(ctx, 'qa');

    const { tested, failures } = await runDeterministicChecks(commands, ctx.cwd);

    if (failures.length === 0 && tested > 0) {
      console.log('[swarm:state:qa] all checks passed (deterministic)');
      markDone(ctx, 'qa', `All QA checks passed (${tested} commands).`);
      // Write QA handoff so downstream steps (review_gate, metrics) see it
      mkdirSync(join(ctx.cwd, '.pi/swarm/outputs'), { recursive: true });
      writeFileSync(
        handoffPath(ctx.taskId, 'qa', ctx.cwd),
        JSON.stringify({
          taskId: ctx.taskId,
          role: 'qa',
          status: 'success',
          complexity: ctx.architectComplexity ?? 'standard',
          domain: ctx.architectDomain ?? 'fullstack',
          requiresDocs: false,
          filesTouched: [],
          nextCommands: [],
          summary: `All QA checks passed (${tested} commands) — deterministic.`,
        }),
      );
      ctx.agentDurations.qa = Date.now() - (ctx.agentStartTimes.qa ?? Date.now());
      return 'review';
    }

    if (failures.length > 0) {
      hadFailures = true;
      // Write failure summary for the QA LLM
      const failSummary = failures
        .map((f) => `### Command: ${f.cmd}\nExit: ${f.exitCode}\n\`\`\`\n${f.tail}\n\`\`\``)
        .join('\n\n');
      mkdirSync(join(ctx.cwd, '.pi/swarm/outputs'), { recursive: true });
      writeFileSync(failFilePath, `# QA Failures for ${ctx.taskId}\n\n${failSummary}`);
      console.warn('[swarm:state:qa] failures detected, spawning QA LLM', {
        failCount: failures.length,
      });
    }
  }

  // ── Spawn QA LLM (on failure or if no deterministic commands) ──
  const planPathVal = join(ctx.cwd, '.pi/swarm/plans', `architect_plan_${ctx.taskId}.md`);
  const failFileRel = `.pi/swarm/outputs/${ctx.taskId}_qa_failures.md`;

  // Include failure details in the user message if the deterministic pass failed
  const userMessage = hadFailures
    ? `'${planPathVal} — QA failures were detected. Read the failure details in ${failFileRel} and provide fixes.'`
    : `'${planPathVal}'`;

  const command = buildPiCommand(ctx, 'qa', userMessage);

  const handoff = await runStep(ctx, 'qa', command, ctx.state.agents.qa.paneId);

  // Clean up the failure file only AFTER the QA LLM has consumed it
  try {
    unlinkSync(failFilePath);
  } catch {
    /* ok */
  }

  if (!handoff) {
    markEscalated(ctx, 'qa', 'timed out');
    return 'done';
  }

  console.log('[swarm:state:qa] complete', { status: handoff.status });
  return 'review';
};

/**
 * Write an auto-approved review handoff (--no-review path).
 * git_commit.ts hard-requires an approved review handoff before committing.
 */
const writeAutoApprovedReview = (ctx: StateContext): void => {
  const domain: SwarmHandoff['domain'] =
    ctx.architectDomain === 'frontend' || ctx.architectDomain === 'backend'
      ? ctx.architectDomain
      : 'fullstack';
  const handoff: SwarmHandoff = {
    taskId: ctx.taskId,
    role: 'review',
    status: 'approved',
    complexity: 'standard',
    domain,
    requiresDocs: false,
    filesTouched: [],
    nextCommands: [],
    summary: 'Auto-approved (--no-review).',
  };
  mkdirSync(join(ctx.cwd, '.pi/swarm/outputs'), { recursive: true });
  writeFileSync(handoffPath(ctx.taskId, 'review', ctx.cwd), JSON.stringify(handoff));
};

const runReview = async (ctx: StateContext): Promise<PipelineState> => {
  // --no-review: write the approved handoff git_commit.ts requires, skip the gate
  if (ctx.skipReview) {
    console.log('[swarm:state:review] skipped (--no-review) — auto-approved');
    writeAutoApprovedReview(ctx);
    markDone(ctx, 'review', 'Auto-approved (--no-review).');
    return 'git';
  }

  // Review runs in git pane as a self-contained stdin-looping script
  const gitPaneId = ctx.state.agents.git.paneId;

  const command = `bun run .pi/swarm/scripts/review_gate.ts ${ctx.taskId}`;

  markWorking(ctx, 'review');

  // Unlink stale review handoff (previous iteration or run) BEFORE dispatch —
  // otherwise waitForHandoff instantly returns last iteration's decision
  // (e.g. stale 'feedback' loops forever, stale 'approved' auto-commits).
  try {
    unlinkSync(handoffPath(ctx.taskId, 'review', ctx.cwd));
  } catch {
    // file didn't exist — fine
  }

  // Run the gate (it writes awaiting_approval, then loops on stdin)
  await ctx.socketClient.paneRun(gitPaneId, command);

  // ── Phase 1: wait for the gate to come up (writes awaiting_approval) ──
  const gateUp = await waitForHandoff(ctx.taskId, 'review', ctx.cwd, GATE_STARTUP_TIMEOUT_MS);
  if (!gateUp) {
    markEscalated(ctx, 'review', 'review gate did not start');
    return 'done';
  }

  // ── Phase 2: gate is up — notify the user, then wait for their decision ──
  let handoff: SwarmHandoff | null = gateUp;
  if (gateUp.status === 'awaiting_approval') {
    try {
      await ctx.socketClient.showNotification({
        title: `Swarm Review: ${ctx.taskId}`,
        message:
          'Your input needed — /approve, /reject, or /feedback <text> from your main pi session (or type in the review pane)',
        level: 'info',
      });
    } catch {
      // best-effort
    }

    handoff = await waitForHandoff(
      ctx.taskId,
      'review',
      ctx.cwd,
      AGENT_TIMEOUT_MS,
      (h) => h.status !== 'awaiting_approval',
    );
  }

  if (!handoff) {
    markEscalated(ctx, 'review', 'user did not respond within timeout');
    return 'done';
  }

  // ── Kill the gate so it doesn't consume git_commit.ts as stdin ──
  try {
    await ctx.socketClient.paneSendKeys(gitPaneId, 'C-c');
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    // best-effort
  }

  return decideReviewOutcome(ctx, handoff);
};

/**
 * Pure decision function: given review handoff and context, return next pipeline state.
 * Exported for unit testing.
 */
export const decideReviewOutcome = (ctx: StateContext, handoff: SwarmHandoff): PipelineState => {
  switch (handoff.status) {
    case 'approved': {
      const next = ctx.architectRequiresDocs ? 'docs' : 'git';
      console.log(`[swarm:state:review] ✅ approved → ${next}`);
      markDone(
        ctx,
        'review',
        `Approved. Proceeding to ${next === 'docs' ? 'docs' : 'commit & push'}.`,
      );
      return next;
    }
    case 'rejected': {
      console.log('[swarm:state:review] ❌ rejected → done');
      markDone(ctx, 'review', 'Rejected. Pipeline stopped.');
      return 'done';
    }
    case 'feedback': {
      if (ctx.iteration >= MAX_FEEDBACK_ITERATIONS) {
        const msg = `Max feedback iterations (${MAX_FEEDBACK_ITERATIONS}) reached — escalating`;
        markEscalated(ctx, 'review', msg);
        return 'done';
      }

      const entry: FeedbackEntry = {
        iteration: ctx.iteration + 1,
        feedback: handoff.summary,
        timestamp: new Date().toISOString(),
      };
      ctx.feedbackHistory.push(entry);
      ctx.iteration++;

      // Write feedback file for coder
      mkdirSync(join(ctx.cwd, '.pi/swarm/outputs'), { recursive: true });
      writeFileSync(
        feedbackPath(ctx.taskId, ctx.iteration, ctx.cwd),
        `# Feedback (Iteration ${ctx.iteration}/${MAX_FEEDBACK_ITERATIONS})\n\n${handoff.summary}\n`,
      );

      console.log(
        `[swarm:state:review] 🔄 feedback → coder (iteration ${ctx.iteration}/${MAX_FEEDBACK_ITERATIONS})`,
      );
      return 'coder';
    }
    default: {
      console.error(`[swarm:state:review] unknown status: ${handoff.status}`);
      return 'done';
    }
  }
};

/**
 * Documentation agent — generates feature docs for contracts that flag requiresDocs.
 * Runs between review-approved and git. Uses free-tier model with fallback.
 */
const runDocs = async (ctx: StateContext): Promise<PipelineState> => {
  const planPathVal = join(ctx.cwd, '.pi/swarm/plans', `architect_plan_${ctx.taskId}.md`);
  // Docs only writes prose — zero coding skills needed. --no-skills saves
  // tens of KB of context that would be wasted on Svelte/PixiJS/Firebase skill files.
  const command = buildPiCommand(ctx, 'docs', `'${planPathVal}'`, '--no-skills');

  const handoff = await runStep(
    ctx,
    'docs',
    command,
    ctx.state.agents.docs?.paneId ?? ctx.state.agents.qa.paneId,
    () => true,
    DOCS_TIMEOUT_MS,
  );

  if (!handoff) {
    // docs failure is non-blocking — warn and proceed to git
    console.warn('[swarm:state:docs] timed out or no handoff — proceeding without docs');
    markDone(ctx, 'docs', 'Docs generation timed out (non-blocking).');
    return 'git';
  }

  console.log('[swarm:state:docs] complete', { files: handoff.filesTouched.length });
  return 'git';
};

const runGit = async (ctx: StateContext): Promise<PipelineState> => {
  // ── Phase 1: Deterministic plan generation (no LLM) ──
  // git_planner.ts reads all handoffs, checks review approval, determines files,
  // generates a conventional commit message, updates the contract status.
  // Writes <task>_git_plan.json — a pure data artifact, never unlinked mid-flight.
  try {
    const { planGitCommit } = await import('./git_planner');
    planGitCommit({
      taskId: ctx.taskId,
      cwd: ctx.cwd,
      contractPath: ctx.contractPath,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    markEscalated(ctx, 'git', `plan generation failed: ${reason}`);
    return 'done';
  }

  console.log('[swarm:state:git:planned] plan written to git_plan.json');

  // ── Phase 2: Deterministic commit script ──
  // Reads <task>_git_plan.json, stages files, commits, pushes.
  // Writes <task>_git_handoff.json with the result. Every exit path writes a handoff.
  markWorking(ctx, 'git');

  const gitPaneId = ctx.state.agents.git.paneId;
  const absCwd = ctx.cwd;
  const gitCommitScript = join(absCwd, '.pi/swarm/scripts/git_commit.ts');
  const command = `cd '${absCwd}' && bun run '${gitCommitScript}' ${ctx.taskId} '${ctx.contractPath}'`;

  // Unlink stale git handoff so script writes a fresh one
  try {
    unlinkSync(handoffPath(ctx.taskId, 'git', ctx.cwd));
  } catch {
    /* ok */
  }

  await ctx.socketClient.paneRun(gitPaneId, command);

  const handoff = await waitForHandoff(ctx.taskId, 'git', ctx.cwd, GIT_SCRIPT_TIMEOUT_MS);

  if (!handoff) {
    markEscalated(ctx, 'git', 'commit script did not produce handoff (timed out)');
    return 'done';
  }

  if (handoff.status === 'failed') {
    // Commit failed (pre-commit hook, merge conflict, etc.) — route to feedback loop
    if (ctx.iteration < MAX_FEEDBACK_ITERATIONS) {
      const entry: FeedbackEntry = {
        iteration: ctx.iteration + 1,
        feedback: `Git commit failed: ${handoff.summary}. Fix and retry.`,
        timestamp: new Date().toISOString(),
      };
      ctx.feedbackHistory.push(entry);
      ctx.iteration++;

      mkdirSync(join(ctx.cwd, '.pi/swarm/outputs'), { recursive: true });
      writeFileSync(
        feedbackPath(ctx.taskId, ctx.iteration, ctx.cwd),
        `# Git Commit Failure (Iteration ${ctx.iteration}/${MAX_FEEDBACK_ITERATIONS})\n\n${handoff.summary}\n`,
      );

      console.log(
        `[swarm:state:git] commit failed → feedback loop (iteration ${ctx.iteration}/${MAX_FEEDBACK_ITERATIONS})`,
      );
      return 'coder';
    }

    markEscalated(
      ctx,
      'git',
      `commit failed after ${MAX_FEEDBACK_ITERATIONS} iterations: ${handoff.summary}`,
    );
    return 'done';
  }

  markDone(ctx, 'git', handoff.summary);
  console.log('[swarm:state:git] committed', { summary: handoff.summary.slice(0, 80) });
  return 'done';
};

// ── State transition table ──────────────────────────────────

const STATE_HANDLERS: Record<PipelineState, (ctx: StateContext) => Promise<PipelineState>> = {
  architect: runArchitect,
  coder: runCoder,
  qa: runQa,
  review: runReview,
  docs: runDocs,
  git: runGit,
  done: async () => 'done',
};

// ── Full pipeline execution ─────────────────────────────────

export type TaskPipelineOptions = {
  taskId: string;
  state: SwarmState;
  socketClient: HerdrSocketClient;
  scratchpad: AgentScratchpad;
  projectRoot: string;
  contractPath: string;
  tier: string;
  skipReview: boolean;
  /** Resume from on-disk handoffs (default). false = fresh run from architect. */
  resume?: boolean;
};

/**
 * Execute a full swarm task pipeline using the state machine.
 *
 * Loops through pipeline states, supporting feedback cycles:
 *   architect → coder → qa → review → [feedback] → coder → qa → review → git → done
 *
 * Capped at 3 feedback iterations before escalation.
 */
export const executeTaskPipeline = async (options: TaskPipelineOptions): Promise<void> => {
  const {
    taskId,
    state,
    socketClient,
    scratchpad,
    projectRoot,
    contractPath,
    tier,
    skipReview,
    resume = true,
  } = options;

  state.activeTaskId = taskId;

  const ctx: StateContext = {
    taskId,
    cwd: projectRoot,
    state,
    socketClient,
    scratchpad,
    contractPath,
    tier,
    skipReview,
    feedbackHistory: [],
    iteration: 0,
    agentStartTimes: {},
    agentDurations: {},
  };

  // ── Task-scoped ledger: wipe this task's stale heartbeat rows ──
  // A fresh run starts with a clean slate; a resume re-seeds completed roles
  // below. Either way the ledger never shows rows from a previous run as live.
  scratchpad.clearTaskHeartbeats(taskId);

  // ── Resume-by-default: derive start state from on-disk handoffs ──
  let currentState: PipelineState = 'architect';

  if (resume) {
    const plan = detectResumeState(taskId, projectRoot);
    currentState = plan.start;

    if (plan.start !== 'architect') {
      // Restore architect metadata (complexity drives coder model + trivial path)
      const arch = readHandoff(taskId, 'architect', projectRoot);
      ctx.architectComplexity = arch?.complexity;
      ctx.architectDomain = arch?.domain;
      ctx.architectRequiresDocs = arch?.requiresDocs;

      // Seed ledger so completed roles show ✅ instead of stale/idle
      for (const role of plan.completed) {
        const h = readHandoff(taskId, role, projectRoot);
        markDone(ctx, role, h?.summary ?? 'Completed in previous run (resumed).');
      }

      console.log('[swarm:pipeline:resume]', {
        taskId,
        startState: plan.start,
        completed: plan.completed.join(','),
        reason: plan.reason,
      });
    }

    if (plan.start === 'done') {
      console.log('[swarm:pipeline:resume] nothing to do — task already committed');
      state.activeTaskId = null;
      return;
    }
  }

  console.log('[swarm:pipeline:start]', {
    taskId,
    contractPath,
    tier,
    skipReview,
    resume,
    startState: currentState,
    maxIterations: MAX_FEEDBACK_ITERATIONS,
  });

  const stateHistory: PipelineState[] = [];
  // Bound: architect(1) + coder+qa+review(×3 max) + git(1) + done(1) = 1 + 9 + 1 + 1 = 12
  const maxTransitions = 20;

  while (currentState !== 'done') {
    stateHistory.push(currentState);

    if (stateHistory.length > maxTransitions) {
      markEscalated(
        ctx,
        currentState,
        `Too many state transitions (${stateHistory.length}) — possible infinite loop`,
      );
      break;
    }

    if (stateHistory.length > 1) {
      await new Promise((r) => setTimeout(r, STEP_COOLDOWN_MS));
    }

    console.log(`[swarm:pipeline] transition: ${currentState} → ...`);

    try {
      const next = await STATE_HANDLERS[currentState](ctx);
      console.log(`[swarm:pipeline] transition: ${currentState} → ${next}`);
      currentState = next;
    } catch (error) {
      // Attribute the escalation to the state that actually threw
      // (every non-'done' PipelineState is a valid AgentRole).
      markEscalated(
        ctx,
        currentState as Exclude<PipelineState, 'done'>,
        `Unhandled error in state ${currentState}: ${error instanceof Error ? error.message : String(error)}`,
      );
      currentState = 'done';
    }
  }

  state.activeTaskId = null;
  state.lastUpdated = new Date().toISOString();

  // Write agent durations sidecar for metrics collector
  mkdirSync(join(projectRoot, '.pi/swarm/outputs'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.pi/swarm/outputs', `${taskId}_durations.json`),
    JSON.stringify(ctx.agentDurations),
  );

  console.log('[swarm:pipeline:complete]', {
    taskId,
    transitions: stateHistory.join(' → '),
    feedbackIterations: ctx.iteration,
    result: ctx.escalated ? 'escalated' : 'completed',
  });
};

export type StepExecutorOptions = TaskPipelineOptions;
