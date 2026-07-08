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
 *   - QA runs coder nextCommands via spawnSync in director process (exit codes, not regex)
 *   - git is a deterministic script (no LLM)
 *   - Review runs in git pane as a self-contained stdin-looping script
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SwarmHandoffSchema } from '@aikami/schemas';
import type { SwarmHandoff } from '@aikami/types';
import { Value } from 'typebox/value';
import { getModelForTier, ROLE_MODEL_TIER } from '../../../../.pi/swarm/models';
import type { HerdrSocketClient } from '../herdr/socket_client';
import type { AgentScratchpad } from './agent_scratchpad';
import type { AgentRole, FeedbackEntry, PipelineState, SwarmState } from './types';

// ── Constants ──────────────────────────────────────────────

const PI_STARTUP_GRACE_MS = 3_000;
const STEP_COOLDOWN_MS = 1_000;
const MAX_FEEDBACK_ITERATIONS = 3;
/** Max time for the review gate script to start and write awaiting_approval. */
const GATE_STARTUP_TIMEOUT_MS = 30_000;

/**
 * Maximum time to wait for any agent step to produce a handoff (30 min).
 *
 * No per-role differentiation — a pi session that's actively producing output
 * shouldn't be killed just because it's slower than expected. The director
 * can be Ctrl+C'd at any time; resume picks up where it left off.
 *
 * Only exception: GATE_STARTUP_TIMEOUT_MS (30s) — if the review gate script
 * can't even start, something is broken.
 */
const AGENT_TIMEOUT_MS = 1_800_000; // 30 min

// ── Helpers ────────────────────────────────────────────────

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
  /** Set when any state escalates — pipeline result reporting */
  escalated?: boolean;
};

/** Resolve model for a role, with --tier override and complexity-driven coder upgrade. */
const getModel = (ctx: StateContext, role: AgentRole): string => {
  const tierOverride = getModelForTier(ctx.tier);
  const defaultTier = ROLE_MODEL_TIER[role] ?? 'flash';
  const defaultModel = getModelForTier(defaultTier);

  // If user passed --tier pro, everything gets pro
  if (ctx.tier === 'pro') {
    return tierOverride;
  }

  // Coder: downgrade to flash if architect flagged trivial
  if (role === 'coder' && ctx.architectComplexity === 'trivial') {
    return getModelForTier('flash');
  }

  return defaultModel;
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
): Promise<SwarmHandoff | null> => {
  markWorking(ctx, role);

  // Unlink stale handoff so waitForHandoff sees only the new one
  try {
    unlinkSync(handoffPath(ctx.taskId, role, ctx.cwd));
  } catch {
    // file didn't exist — fine
  }

  // ── Live-agent guard: don't type pi commands into an existing pi session ──
  const paneInfo = await ctx.socketClient.paneGet(paneId);
  if (paneInfo?.agent) {
    // A previous coding agent session (pi/claude/etc.) is still alive in this
    // pane. Send Ctrl+C to interrupt, then wait for the shell to stabilize.
    // Without this guard, `pane.send_text 'pi --model ...'` types into the
    // interactive pi session — an infuriating nested-pi bug.
    console.debug('[swarm:step:kill-agent]', {
      role,
      agent: paneInfo.agent,
      status: paneInfo.agent_status,
    });
    await ctx.socketClient.paneSendKeys(paneId, 'C-c');
    await new Promise((r) => setTimeout(r, 500));
  }

  await ctx.socketClient.paneRun(paneId, command);
  console.debug('[swarm:state:command-sent]', { role });

  await new Promise((r) => setTimeout(r, PI_STARTUP_GRACE_MS));

  const handoff = await waitForHandoff(ctx.taskId, role, ctx.cwd, AGENT_TIMEOUT_MS, predicate);

  if (handoff) {
    markDone(ctx, role, handoff.summary);
  }

  return handoff;
};

// ── Individual state transitions ────────────────────────────

const runArchitect = async (ctx: StateContext): Promise<PipelineState> => {
  const model = getModel(ctx, 'architect');
  const command = `pi --model ${model} --system-prompt .pi/prompts/architect.md '${ctx.contractPath}'`;

  const handoff = await runStep(ctx, 'architect', command, ctx.state.agents.architect.paneId);
  if (!handoff) {
    markEscalated(ctx, 'architect', 'timed out');
    return 'done';
  }

  ctx.architectComplexity = handoff.complexity;
  ctx.architectDomain = handoff.domain;

  console.log('[swarm:state:architect] complete', {
    complexity: handoff.complexity,
    domain: handoff.domain,
    requiresDocs: handoff.requiresDocs,
  });

  return 'coder';
};

const runCoder = async (ctx: StateContext): Promise<PipelineState> => {
  const model = getModel(ctx, 'coder');
  const planPathVal = `.pi/swarm/plans/architect_plan_${ctx.taskId}.md`;

  let userMessage = `'${planPathVal}'`;

  if (ctx.iteration > 0) {
    const fp = feedbackPath(ctx.taskId, ctx.iteration, ctx.cwd);
    userMessage = `'${planPathVal} — REVISION ${ctx.iteration}/${MAX_FEEDBACK_ITERATIONS}: apply the user feedback in ${fp} to the existing implementation. Do NOT re-implement from scratch — fix only what the feedback asks for.'`;
  }

  const command = `pi --model ${model} --system-prompt .pi/prompts/coder.md ${userMessage}`;

  const handoff = await runStep(ctx, 'coder', command, ctx.state.agents.coder.paneId);
  if (!handoff) {
    markEscalated(ctx, 'coder', 'timed out');
    return 'done';
  }

  console.log('[swarm:state:coder] complete', {
    status: handoff.status,
    filesTouched: handoff.filesTouched.length,
  });

  // Trivial path: skip QA if architect flagged complexity=trivial
  if (ctx.architectComplexity === 'trivial') {
    console.log('[swarm:state:coder] trivial path — skipping QA');
    ctx.state.agents.qa.status = 'done';

    if (handoff.nextCommands && handoff.nextCommands.length > 0) {
      for (const cmd of handoff.nextCommands) {
        try {
          await ctx.socketClient.paneRun(ctx.state.agents.git.paneId, cmd);
        } catch {
          // best-effort
        }
      }
    }
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

    let allPassed = true;
    const failures: Array<{ cmd: string; exitCode: number; tail: string }> = [];
    const tested = new Set<string>();

    for (const cmd of commands) {
      // Only run test/lint/fix/typecheck commands deterministically
      const isTestCmd =
        cmd.startsWith('moon run') ||
        cmd.startsWith('bun test') ||
        cmd.startsWith('bun run lint') ||
        cmd.startsWith('bun run fix') ||
        cmd.startsWith('bun run typecheck') ||
        cmd.startsWith('npx tsc');

      if (!isTestCmd) {
        // Non-test commands — run in pane but don't count toward pass/fail
        try {
          await ctx.socketClient.paneRun(ctx.state.agents.qa.paneId, cmd);
        } catch {
          // best-effort
        }
        continue;
      }

      tested.add(cmd);
      console.debug('[swarm:state:qa:spawn]', { cmd });

      const r = spawnSync('sh', ['-c', cmd], {
        cwd: ctx.cwd,
        stdio: 'pipe',
        timeout: 600_000,
        env: process.env,
      });

      if (r.status !== 0) {
        allPassed = false;
        failures.push({
          cmd,
          exitCode: r.status ?? -1,
          tail: `${String(r.stdout).slice(-2000)}\n${String(r.stderr).slice(-2000)}`,
        });
      }
    }

    if (allPassed && tested.size > 0) {
      console.log('[swarm:state:qa] all checks passed (deterministic)');
      markDone(ctx, 'qa', `All QA checks passed (${tested.size} commands).`);
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
  const model = getModel(ctx, 'qa');
  const planPathVal = `.pi/swarm/plans/architect_plan_${ctx.taskId}.md`;

  // Include failure details in the user message if the deterministic pass failed
  const userMessage = hadFailures
    ? `'${planPathVal} — QA failures were detected. Read the failure details in .pi/swarm/outputs/${ctx.taskId}_qa_failures.md and provide fixes.'`
    : `'${planPathVal}'`;

  const command = `pi --model ${model} --system-prompt .pi/prompts/qa.md ${userMessage}`;

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
        message: 'Your input needed — lgtm / reject / feedback in the review pane',
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

  return decideReviewOutcome(ctx, handoff);
};

/**
 * Pure decision function: given review handoff and context, return next pipeline state.
 * Exported for unit testing.
 */
export const decideReviewOutcome = (ctx: StateContext, handoff: SwarmHandoff): PipelineState => {
  switch (handoff.status) {
    case 'approved': {
      console.log('[swarm:state:review] ✅ approved → git');
      markDone(ctx, 'review', 'Approved. Proceeding to commit & push.');
      return 'git';
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

const runGit = async (ctx: StateContext): Promise<PipelineState> => {
  // ── Phase 1: LLM validation (free tier) ──
  // The LLM reads all handoffs, checks review approval, determines files to
  // commit, generates a conventional commit message, and updates the contract.
  // It writes a git_handoff.json with the validated plan.
  const model = getModel(ctx, 'git');
  const planPathVal = `.pi/swarm/plans/architect_plan_${ctx.taskId}.md`;
  const validateCommand = `pi --model ${model} --system-prompt .pi/prompts/git.md '${planPathVal}'`;

  const validationHandoff = await runStep(ctx, 'git', validateCommand, ctx.state.agents.git.paneId);

  if (!validationHandoff || validationHandoff.status === 'awaiting_approval') {
    const reason = validationHandoff?.summary ?? 'LLM did not produce handoff';
    console.error('[swarm:state:git] review not approved or validation failed');
    markEscalated(ctx, 'git', reason);
    return 'done';
  }

  console.log('[swarm:state:git:validated]', {
    files: validationHandoff.filesTouched.length,
    summary: validationHandoff.summary.slice(0, 80),
  });

  // ── Phase 2: Deterministic commit script ──
  // Executes the plan: stages files from the LLM's handoff, commits with the
  // LLM's message, pushes, updates contract status. No hallucination risk.
  markWorking(ctx, 'git');

  const gitPaneId = ctx.state.agents.git.paneId;
  const command = `bun run .pi/swarm/scripts/git_commit.ts ${ctx.taskId} '${ctx.contractPath}'`;

  // Unlink stale git handoff so the script writes a fresh "success" one
  try {
    unlinkSync(handoffPath(ctx.taskId, 'git', ctx.cwd));
  } catch {
    /* ok */
  }

  await ctx.socketClient.paneRun(gitPaneId, command);

  const handoff = await waitForHandoff(ctx.taskId, 'git', ctx.cwd, AGENT_TIMEOUT_MS);

  if (handoff) {
    markDone(ctx, 'git', handoff.summary);
    console.log('[swarm:state:git] committed', { summary: handoff.summary.slice(0, 80) });
  } else {
    markEscalated(ctx, 'git', 'commit script did not produce handoff');
  }

  return 'done';
};

// ── State transition table ──────────────────────────────────

const STATE_HANDLERS: Record<PipelineState, (ctx: StateContext) => Promise<PipelineState>> = {
  architect: runArchitect,
  coder: runCoder,
  qa: runQa,
  review: runReview,
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

  console.log('[swarm:pipeline:complete]', {
    taskId,
    transitions: stateHistory.join(' → '),
    feedbackIterations: ctx.iteration,
    result: ctx.escalated ? 'escalated' : 'completed',
  });
};

export type StepExecutorOptions = TaskPipelineOptions;
