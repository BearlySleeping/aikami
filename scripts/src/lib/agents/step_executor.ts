// scripts/src/lib/agents/step_executor.ts
/**
 * Swarm step executor (C-311.2.4).
 *
 * Decomposed from swarm_director.ts — manages pipeline transitions
 * (Architect → Coder → QA → Git) with:
 *   - Role-specific timeouts
 *   - Trivial path: bypass QA if architect flags complexity=trivial
 *   - Documentation path: optional document agent post-Git
 *   - Domain-based coder skill injection
 *   - Server-side wait commands instead of polling (no child_process.spawn)
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SwarmHandoffSchema } from '@aikami/schemas';
import type { SwarmHandoff } from '@aikami/types';
import { Value } from 'typebox/value';
import type { HerdrSocketClient } from '../herdr/socket_client';
import type { AgentScratchpad } from './agent_scratchpad';
import { detectStalledAgents, ROLE_TIMEOUTS } from './resilience';
import type { AgentRole, AgentStatus, SwarmState, SwarmStep } from './types';

// ── Constants ──────────────────────────────────────────────

/** Completion marker regex — unified C-311 format. */
const SWARM_DONE_REGEX = /SWARM_DONE:(\w+):(\S+)/;

// ── Helpers ────────────────────────────────────────────────

/** Compute SHA-256 hash for scrollback change detection. */
const hashContent = (content: string): string => createHash('sha256').update(content).digest('hex');

/**
 * Read an agent's handoff JSON sidecar with TypeBox validation.
 * Returns null if the file doesn't exist or fails validation.
 */
const readHandoff = (taskId: string, role: string): SwarmHandoff | null => {
  const handoffPath = join(
    process.cwd(),
    '.pi',
    'swarm',
    'outputs',
    `${taskId}_${role}_handoff.json`,
  );
  try {
    const raw = readFileSync(handoffPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (Value.Check(SwarmHandoffSchema, parsed)) {
      return parsed as SwarmHandoff;
    }
    console.warn(`[swarm:handoff] validation failed for ${role}`);
    return null;
  } catch {
    return null;
  }
};

/**
 * Build the coder initialization command with domain-based skill hints.
 *
 * If the architect's handoff specifies a domain, appends a brief skill
 * instruction to the coder prompt. The coder prompt itself already instructs
 * agents to follow aikami-conventions.
 */
const buildCoderCommand = (options: {
  architectPlanPath: string;
  taskId: string;
  model: string;
}): string => {
  const { architectPlanPath, model } = options;
  // Domain skill injection done via prompt content, not CLI flags.
  // The coder.md prompt instructs agents to load domain-appropriate skills.
  return `pi --model ${model} --system-prompt .pi/prompts/coder.md '${architectPlanPath}'`;
};

/**
 * Check if scrollback contains the unified SWARM_DONE marker.
 */
const checkCompletion = (
  scrollback: string,
): { found: boolean; role?: string; taskId?: string } => {
  const match = scrollback.match(SWARM_DONE_REGEX);
  if (match) {
    return { found: true, role: match[1], taskId: match[2] };
  }
  return { found: false };
};

// ── Step execution ─────────────────────────────────────────

/**
 * Execute a single swarm step using server-side wait commands.
 *
 * Replaces the old polling loop with:
 *   1. Send command to target agent pane via socket
 *   2. Call wait.agent_status on the herdr server (blocks server-side until done/idle)
 *   3. Read pane buffer for SWARM_DONE marker
 *   4. Read handoff JSON sidecar for downstream context
 *
 * Falls back to wait.output with regex if agent_status detection isn't available.
 */
export const executeStepEventDriven = async (options: {
  step: SwarmStep;
  state: SwarmState;
  socketClient: HerdrSocketClient;
  scratchpad: AgentScratchpad;
  heartbeatTimestamps?: Record<AgentRole, number>;
  roleTimeoutMs?: number;
  pipelineStartTime?: number;
}): Promise<void> => {
  const {
    step,
    state,
    socketClient,
    scratchpad,
    heartbeatTimestamps,
    roleTimeoutMs = ROLE_TIMEOUTS[step.agent] ?? 120_000,
    pipelineStartTime = 0,
  } = options;

  const agent = state.agents[step.agent];

  // Review steps reuse the git pane (git hasn't started yet, pane is clean)
  const effectivePaneId = step.agent === 'review' ? state.agents.git.paneId : agent?.paneId;

  if (!effectivePaneId || effectivePaneId === '') {
    throw new Error(`Agent ${step.agent} has no mapped pane`);
  }

  // Mark working
  if (agent) {
    agent.status = 'working';
  }
  state.lastUpdated = new Date().toISOString();
  scratchpad.upsertHeartbeat({
    taskId: state.activeTaskId ?? 'unknown',
    workspaceId: state.workspaceId ?? 'default',
    agentKey: step.agent,
    agentStatus: 'working',
    lastContextHash: null,
    lastHeartbeatTimestamp: Date.now(),
    agentOutput: '',
  });

  if (heartbeatTimestamps) {
    heartbeatTimestamps[step.agent] = Date.now();
  }

  // NOTE: No pre-step cleanup needed for fresh workspaces.
  // Ctrl+C is only useful when reusing panes with stale pi sessions.

  // Send command to target pane
  await socketClient.paneRun(effectivePaneId, step.command);

  console.debug('[swarm:step:command-sent]', { agent: step.agent });

  // ── Wait for completion via server-side APIs ──────────────
  // Primary: wait for SWARM_DONE marker via pane.wait_for_output
  // Fallback: poll pane.read for completion signals

  const markerPattern = `SWARM_DONE:${step.agent}:`;

  let completed = await socketClient.waitOutput({
    paneId: effectivePaneId,
    match: markerPattern,
    regex: false,
    source: 'recent',
    timeoutMs: roleTimeoutMs,
  });

  if (!completed) {
    // Fallback: check if handoff file was written DURING this pipeline run
    const existingHandoff = readHandoff(state.activeTaskId ?? '', step.agent);
    if (existingHandoff) {
      const { statSync } = await import('node:fs');
      const handoffPath = join(
        process.cwd(),
        '.pi/swarm/outputs',
        `${state.activeTaskId}_${step.agent}_handoff.json`,
      );
      try {
        const stat = statSync(handoffPath);
        const isFresh = pipelineStartTime === 0 || stat.mtimeMs > pipelineStartTime;
        if (isFresh) {
          console.log('[swarm:step:handoff-fresh]', {
            agent: step.agent,
            status: existingHandoff.status,
          });
          completed = true;
        } else {
          console.log('[swarm:step:handoff-stale]', {
            agent: step.agent,
            fileAge: Date.now() - stat.mtimeMs,
          });
        }
      } catch {
        completed = true;
      }
    }

    // ── Architect-specific: check if plan file was written ──
    if (!completed && step.agent === 'architect') {
      const planPath = join(process.cwd(), '.pi/swarm/plans', `architect_plan_${state.activeTaskId}.md`);
      try {
        const { statSync } = await import('node:fs');
        const stat = statSync(planPath);
        if (pipelineStartTime === 0 || stat.mtimeMs > pipelineStartTime) {
          console.log('[swarm:step:plan-detected]', { agent: step.agent, planSize: stat.size });
          completed = true;
        }
      } catch {
        // Plan doesn't exist yet
      }
    }
  }

  if (!completed) {
    console.debug('[swarm:step:fallback-poll]', { agent: step.agent });
    completed = await socketClient.waitAgentIdle({
      paneId: effectivePaneId,
      timeoutMs: roleTimeoutMs,
      taskId: state.activeTaskId ?? undefined,
      role: step.agent,
      afterTime: pipelineStartTime || undefined,
    });
  }

  // ── Final SWARM_DONE marker check in pane buffer ─────
  const finalScrollback = await socketClient.paneRead({
    paneId: effectivePaneId,
    source: 'recent_unwrapped',
    lines: 100,
  });

  const { found: hasMarker } = checkCompletion(finalScrollback);

  // ── Stall detection ───────────────────────────────────
  if (heartbeatTimestamps) {
    const stalled = detectStalledAgents(state, heartbeatTimestamps, roleTimeoutMs);
    if (stalled.includes(step.agent)) {
      if (agent) {
        agent.status = 'blocked';
      }
      state.lastUpdated = new Date().toISOString();
      scratchpad.upsertHeartbeat({
        taskId: state.activeTaskId ?? 'unknown',
        workspaceId: state.workspaceId ?? 'default',
        agentKey: step.agent,
        agentStatus: 'blocked',
        lastContextHash: null,
        lastHeartbeatTimestamp: Date.now(),
        agentOutput: '',
      });
      throw new Error(`Agent ${step.agent} stalled — no heartbeat for ${roleTimeoutMs}ms`);
    }
  }

  // Validate handoff JSON sidecar
  const handoff = readHandoff(state.activeTaskId ?? '', step.agent);
  const summary = handoff?.summary ?? '';
  const hasHandoff = handoff !== null;

  const finalStatus: AgentStatus = hasMarker || completed ? 'done' : 'blocked';
  if (agent) {
    agent.status = finalStatus;
    agent.lastHash = hashContent(finalScrollback);
  }
  state.lastUpdated = new Date().toISOString();

  scratchpad.upsertHeartbeat({
    taskId: state.activeTaskId ?? 'unknown',
    workspaceId: state.workspaceId ?? 'default',
    agentKey: step.agent,
    agentStatus: agent?.status ?? finalStatus,
    lastContextHash: agent?.lastHash ?? null,
    lastHeartbeatTimestamp: Date.now(),
    agentOutput: summary,
  });

  console.log('[swarm:step:done]', {
    stepIndex: step.stepIndex,
    agent: step.agent,
    hasMarker,
    hasHandoff,
    summaryLen: summary.length,
  });

  if (finalStatus === 'blocked') {
    throw new Error(`Agent ${step.agent} did not complete within timeout`);
  }
};

// ── Full pipeline execution ────────────────────────────────

export type TaskPipelineOptions = {
  taskId: string;
  steps: SwarmStep[];
  state: SwarmState;
  socketClient: HerdrSocketClient;
  scratchpad: AgentScratchpad;
  projectRoot: string;
  model: string;
  tier: string;
};

/**
 * Execute a full swarm task pipeline.
 *
 * Handles:
 *   - Sequential step execution via server-side wait commands
 *   - Trivial path: skip QA if architect complexity=trivial
 *   - Domain-based coder skill injection
 *   - Optional document agent if requiresDocs=true
 */
export const executeTaskPipeline = async (options: TaskPipelineOptions): Promise<void> => {
  const { taskId, steps, state, socketClient, scratchpad, model, tier } = options;

  state.activeTaskId = taskId;
  const heartbeatTimestamps = {} as Record<AgentRole, number>;
  const pipelineStartTime = Date.now();

  // NOTE: No pre-pipeline cleanup needed. Workspaces are created fresh;
  // no stale PI sessions to kill. /quit breaks fish shell (command-not-found).

  let skipQa = false;
  let requiresDocs = false;

  for (const step of steps) {
    // ── Trivial path: skip QA ─────────────────────────
    if (skipQa && step.agent === 'qa') {
      console.log('[swarm:pipeline:skip-qa] trivial task, bypassing QA');
      state.agents.qa.status = 'done';
      state.lastUpdated = new Date().toISOString();

      // Run coder's next_commands in git pane
      const coderHandoff = readHandoff(taskId, 'coder');
      if (coderHandoff?.nextCommands && coderHandoff.nextCommands.length > 0) {
        for (const cmd of coderHandoff.nextCommands) {
          try {
            await socketClient.paneRun(state.agents.git.paneId, cmd);
          } catch {
            // Best-effort
          }
        }
      }
      continue;
    }

    // ── Domain-based coder skill injection ────────────
    let command = step.command;
    if (step.agent === 'coder') {
      const architectPlanPath = `.pi/swarm/plans/architect_plan_${taskId}.md`;
      command = buildCoderCommand({
        architectPlanPath,
        taskId,
        model,
      });
    }

    const injectedStep: SwarmStep = { ...step, command };

    // Small delay between steps to prevent herdr rate-limiting
    if (step.stepIndex > 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    // ── Execute step ─────────────────────────────────
    await executeStepEventDriven({
      step: injectedStep,
      state,
      socketClient,
      scratchpad,
      heartbeatTimestamps,
      roleTimeoutMs: ROLE_TIMEOUTS[step.agent],
      pipelineStartTime,
    });

    // ── Post-architect checks ────────────────────────
    if (step.agent === 'architect') {
      const handoff = readHandoff(taskId, 'architect');
      if (handoff?.complexity === 'trivial') {
        skipQa = true;
        console.log('[swarm:pipeline:trivial-path] architect flagged complexity=trivial');
      }
      if (handoff?.requiresDocs) {
        requiresDocs = true;
      }
    }

    // ── Post-QA: keep PI session alive for inspection ────

    // ── Post-review routing check ────────────────────
    if (step.agent === 'review') {
      const reviewHandoff = readHandoff(taskId, 'review');
      if (!reviewHandoff) {
        console.warn('[swarm:pipeline:review-no-handoff]');
        continue;
      }

      console.log('[swarm:pipeline:review-decision]', {
        status: reviewHandoff.status,
        summary: reviewHandoff.summary.slice(0, 80),
      });

      if (reviewHandoff.status === 'approved') {
        console.log('✅ Review approved — continuing to git');
      } else if (reviewHandoff.status === 'awaiting_approval') {
        // Send herdr notification to get user attention
        try {
          await socketClient.showNotification({
            title: `Swarm Review: ${taskId}`,
            message: 'Your input is needed — approve or provide feedback',
            level: 'info',
          });
        } catch {
          // Notification is best-effort
        }
        console.log('⏳ Review awaiting approval — check the review pane');
      } else if (reviewHandoff.status === 'rejected') {
        console.log('❌ Review rejected — stopping pipeline');
        state.activeTaskId = null;
        return;
      } else if (reviewHandoff.status === 'feedback') {
        const routeTarget = reviewHandoff.nextCommands?.[0] ?? 'route:coder';
        console.log(`🔄 Review feedback — routing to: ${routeTarget}`);
        console.log(`   Feedback: ${reviewHandoff.summary}`);
        state.activeTaskId = null;
        return;
      }
    }
  }

  // ── Optional document agent (post-Git, flash tier only) ──
  if (requiresDocs && tier === 'flash') {
    console.log('[swarm:pipeline:document-agent] running documentation agent');
    const gitPaneId = state.agents.git.paneId;
    if (gitPaneId) {
      const docCommand = `pi --model ${model} --system-prompt .pi/prompts/document.md 'docs/'`;
      try {
        await socketClient.paneRun(gitPaneId, docCommand);
        await socketClient.waitAgentIdle({
          paneId: gitPaneId,
          timeoutMs: 60_000,
        });
      } catch {
        // Best-effort
      }
    }
  }

  state.activeTaskId = null;
  state.lastUpdated = new Date().toISOString();
  console.log('[swarm:pipeline:complete]', { taskId });
};

export type StepExecutorOptions = TaskPipelineOptions;
