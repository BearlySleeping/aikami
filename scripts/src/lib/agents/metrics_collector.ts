// scripts/src/lib/agents/metrics_collector.ts
/**
 * Swarm metrics collector (C-311.2.4.3).
 *
 * Non-LLM telemetry step — runs synchronously after every task completes.
 * Parses pane output buffers and JSON sidecars to calculate:
 *   - Duration per agent step
 *   - Step count
 *   - Inferred token usage (file-based heuristic)
 *   - Completion status per agent
 *
 * Writes to .pi/swarm/outputs/<taskId>_metrics.json
 *
 * No LLM API calls are made — this is pure computation.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SwarmHandoffSchema } from '@aikami/schemas';
import type { SwarmHandoff } from '@aikami/types';
import { Value } from 'typebox/value';
import { AGENT_ROLES } from './types';

// ── Types ──────────────────────────────────────────────────

export type AgentMetrics = {
  role: string;
  status:
    | 'success'
    | 'failed'
    | 'escalated'
    | 'skipped'
    | 'unknown'
    | 'awaiting_approval'
    | 'approved'
    | 'rejected'
    | 'feedback';
  durationMs: number;
  filesTouched: number;
  estimatedTokensOutput: number;
  summaryPreview: string;
};

export type TaskMetrics = {
  taskId: string;
  completedAt: string;
  totalDurationMs: number;
  agents: AgentMetrics[];
  trivialPath: boolean;
  documentationGenerated: boolean;
};

// ── Constants ──────────────────────────────────────────────

/** Rough token estimation: ~0.7 tokens per character for code output. */
const CHARS_PER_TOKEN = 1.43;

/** Heuristic: 1 file = ~300 tokens of output. */
const TOKENS_PER_FILE = 300;

// ── Helpers ────────────────────────────────────────────────

/**
 * Read a handoff JSON file and validate it.
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
    return null;
  } catch {
    return null;
  }
};

/**
 * Read an agent's legacy markdown summary file.
 */
const readLegacySummary = (taskId: string, role: string): string => {
  const summaryPath = join(process.cwd(), '.pi', 'swarm', 'outputs', `${taskId}_${role}.md`);
  try {
    return readFileSync(summaryPath, 'utf-8').slice(0, 1024);
  } catch {
    return '';
  }
};

/**
 * Estimate tokens from scrollback content.
 * Rough heuristic: characters ÷ CHARS_PER_TOKEN + files × TOKENS_PER_FILE.
 */
const estimateTokens = (content: string, filesTouched: number): number => {
  const charTokens = Math.round(content.length / CHARS_PER_TOKEN);
  const fileTokens = filesTouched * TOKENS_PER_FILE;
  return charTokens + fileTokens;
};

// ── Collector ──────────────────────────────────────────────

/**
 * Collect metrics for a completed task.
 *
 * Reads handoff JSON sidecars (primary) with legacy markdown fallback.
 * Computes duration, file count, token estimates.
 */
export const collectTaskMetrics = (options: {
  taskId: string;
  startTime: number;
  trivialPath?: boolean;
  documentationGenerated?: boolean;
}): TaskMetrics => {
  const { taskId, startTime, trivialPath = false, documentationGenerated = false } = options;

  // Read per-agent durations sidecar (written by executeTaskPipeline)
  let agentDurations: Record<string, number> = {};
  try {
    const durationsPath = join(
      process.cwd(),
      '.pi',
      'swarm',
      'outputs',
      `${taskId}_durations.json`,
    );
    agentDurations = JSON.parse(readFileSync(durationsPath, 'utf-8')) as Record<string, number>;
  } catch {
    // sidecar doesn't exist — durations stay 0 (non-blocking)
  }

  const agents: AgentMetrics[] = [];

  for (const role of AGENT_ROLES) {
    const handoff = readHandoff(taskId, role);
    const legacySummary = readLegacySummary(taskId, role);
    const duration = agentDurations[role] ?? 0;

    if (handoff) {
      const summaryPreview = handoff.summary.slice(0, 120);
      const filesTouched = handoff.filesTouched.length;

      agents.push({
        role,
        status: handoff.status,
        durationMs: duration,
        filesTouched,
        estimatedTokensOutput: estimateTokens(handoff.summary, filesTouched),
        summaryPreview: summaryPreview || '(no summary)',
      });
    } else if (trivialPath && role === 'qa') {
      // QA was skipped via trivial path — mark explicitly even if legacy .md exists
      agents.push({
        role,
        status: 'skipped',
        durationMs: 0,
        filesTouched: 0,
        estimatedTokensOutput: 0,
        summaryPreview: '(skipped — trivial path)',
      });
    } else if (legacySummary) {
      agents.push({
        role,
        status: 'unknown',
        durationMs: duration,
        filesTouched: 0,
        estimatedTokensOutput: estimateTokens(legacySummary, 0),
        summaryPreview: legacySummary.slice(0, 120),
      });
    } else {
      agents.push({
        role,
        status: trivialPath && role === 'qa' ? 'skipped' : 'unknown',
        durationMs: duration,
        filesTouched: 0,
        estimatedTokensOutput: 0,
        summaryPreview: trivialPath && role === 'qa' ? '(skipped — trivial path)' : '(no output)',
      });
    }
  }

  const totalDurationMs = Date.now() - startTime;

  const metrics: TaskMetrics = {
    taskId,
    completedAt: new Date().toISOString(),
    totalDurationMs,
    agents,
    trivialPath,
    documentationGenerated,
  };

  return metrics;
};

/**
 * Write metrics to the outputs directory.
 */
export const writeMetrics = (taskId: string, metrics: TaskMetrics): string => {
  const outputsDir = join(process.cwd(), '.pi', 'swarm', 'outputs');
  mkdirSync(outputsDir, { recursive: true });

  const metricsPath = join(outputsDir, `${taskId}_metrics.json`);
  writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
  return metricsPath;
};

/**
 * Full metrics pipeline — collect + write.
 * Returns the metrics object for caller inspection.
 */
export const collectAndWriteMetrics = (options: {
  taskId: string;
  startTime: number;
  trivialPath?: boolean;
  documentationGenerated?: boolean;
}): TaskMetrics => {
  const metrics = collectTaskMetrics(options);
  const path = writeMetrics(options.taskId, metrics);
  console.log('[swarm:metrics] written to', path);
  return metrics;
};
