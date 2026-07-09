// scripts/src/lib/agents/metrics_collector.ts
/**
 * Swarm metrics collector.
 *
 * Non-LLM telemetry step — runs synchronously after every task completes.
 * Reads pi session JSONL files for REAL token counts (input, output, reasoning)
 * and falls back to the old chars÷1.43 heuristic when session data is unavailable.
 *
 * Writes to .pi/swarm/outputs/<taskId>_metrics.json
 *
 * No LLM API calls are made — this is pure computation.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  /** Fallback estimate from chars÷1.43 heuristic. */
  estimatedTokensOutput: number;
  /** Real input tokens from pi session files (0 = unavailable). */
  tokensInput: number;
  /** Real output tokens from pi session files (0 = unavailable). */
  tokensOutput: number;
  /** Real reasoning/thinking tokens from pi session files (0 = unavailable). */
  tokensReasoning: number;
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

// ── Session file parsing (real token counts) ───────────────

const CWD = process.cwd();

/** Get the pi session directory for the current project cwd. */
const getSessionDir = (): string => {
  const home = process.env.HOME ?? resolve('/home', process.env.USER ?? '');
  const encoded = `--${CWD.replace(/\//g, '-')}--`;
  return join(home, '.pi', 'agent', 'sessions', encoded);
};

/**
 * Parse all assistant messages from a pi session JSONL file.
 * Sums input, output, and reasoning token counts.
 */
const parseSessionUsage = (
  filePath: string,
): { input: number; output: number; reasoning: number } | null => {
  try {
    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    let input = 0;
    let output = 0;
    let reasoning = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { type?: string; message?: Record<string, unknown> };
        if (entry.type !== 'message') {
          continue;
        }
        const msg = entry.message;
        if (msg?.role !== 'assistant') {
          continue;
        }
        const usage = msg.usage as Record<string, number> | undefined;
        if (usage) {
          input += typeof usage.input === 'number' ? usage.input : 0;
          output += typeof usage.output === 'number' ? usage.output : 0;
          reasoning += typeof usage.reasoning === 'number' ? usage.reasoning : 0;
        }
      } catch {
        // malformed line — skip
      }
    }

    return input > 0 || output > 0 || reasoning > 0 ? { input, output, reasoning } : null;
  } catch {
    return null;
  }
};

/**
 * Collect real token usage from swarm pi session files.
 *
 * Swarm agents pass `--session-id swarm-<taskId>-<role>`, producing files
 * named `<timestamp>_swarm-<taskId>-<role>.jsonl`.
 *
 * On feedback iterations, multiple files may exist for the same role.
 * We pick the one with the highest total tokens.
 */
const collectSwarmSessionUsage = (
  taskId: string,
): Record<string, { input: number; output: number; reasoning: number }> => {
  const usageMap: Record<string, { input: number; output: number; reasoning: number }> = {};

  try {
    const dir = getSessionDir();
    const files = readdirSync(dir);
    const prefix = `_swarm-${taskId}-`;

    for (const file of files) {
      if (!file.endsWith('.jsonl') || !file.includes(prefix)) {
        continue;
      }
      // Extract role: <timestamp>_swarm-<taskId>-<role>.jsonl
      const role = file.slice(file.indexOf(prefix) + prefix.length).replace(/\.jsonl$/, '');
      if (!role) {
        continue;
      }

      const usage = parseSessionUsage(join(dir, file));
      if (usage) {
        const existing = usageMap[role];
        if (
          !existing ||
          usage.input + usage.output + usage.reasoning >
            existing.input + existing.output + existing.reasoning
        ) {
          usageMap[role] = usage;
        }
      }
    }
  } catch {
    // best-effort
  }

  return usageMap;
};

// ── Legacy fallback heuristic ───────────────────────────────

const CHARS_PER_TOKEN = 1.43;

const estimateTokensFallback = (summary: string, filesTouched: number): number => {
  const charTokens = Math.round(summary.length / CHARS_PER_TOKEN);
  const fileTokens = filesTouched * 300; // rough: ~300 tokens per source file
  return charTokens + fileTokens;
};

// ── Handoff helpers ─────────────────────────────────────────

const readHandoff = (taskId: string, role: string): SwarmHandoff | null => {
  const p = join(CWD, '.pi', 'swarm', 'outputs', `${taskId}_${role}_handoff.json`);
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

const readLegacySummary = (taskId: string, role: string): string => {
  const p = join(CWD, '.pi', 'swarm', 'outputs', `${taskId}_${role}.md`);
  try {
    return readFileSync(p, 'utf-8').slice(0, 1024);
  } catch {
    return '';
  }
};

// ── Collector ───────────────────────────────────────────────

export const collectTaskMetrics = (options: {
  taskId: string;
  startTime: number;
  trivialPath?: boolean;
  documentationGenerated?: boolean;
}): TaskMetrics => {
  const { taskId, startTime, trivialPath = false, documentationGenerated = false } = options;

  // Per-agent durations (written by executeTaskPipeline)
  let agentDurations: Record<string, number> = {};
  try {
    const p = join(CWD, '.pi', 'swarm', 'outputs', `${taskId}_durations.json`);
    agentDurations = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, number>;
  } catch {
    // sidecar doesn't exist — durations stay 0
  }

  // Real token counts from pi session files
  const sessionUsage = collectSwarmSessionUsage(taskId);

  const agents: AgentMetrics[] = [];

  for (const role of AGENT_ROLES) {
    const handoff = readHandoff(taskId, role);
    const legacySummary = readLegacySummary(taskId, role);
    const duration = agentDurations[role] ?? 0;
    const usage = sessionUsage[role];

    if (handoff) {
      agents.push({
        role,
        status: handoff.status,
        durationMs: duration,
        filesTouched: handoff.filesTouched.length,
        estimatedTokensOutput: estimateTokensFallback(handoff.summary, handoff.filesTouched.length),
        tokensInput: usage?.input ?? 0,
        tokensOutput: usage?.output ?? 0,
        tokensReasoning: usage?.reasoning ?? 0,
        summaryPreview: handoff.summary.slice(0, 120) || '(no summary)',
      });
    } else if (trivialPath && role === 'qa') {
      agents.push({
        role,
        status: 'skipped',
        durationMs: 0,
        filesTouched: 0,
        estimatedTokensOutput: 0,
        tokensInput: 0,
        tokensOutput: 0,
        tokensReasoning: 0,
        summaryPreview: '(skipped — trivial path)',
      });
    } else if (legacySummary) {
      agents.push({
        role,
        status: 'unknown',
        durationMs: duration,
        filesTouched: 0,
        estimatedTokensOutput: estimateTokensFallback(legacySummary, 0),
        tokensInput: 0,
        tokensOutput: 0,
        tokensReasoning: 0,
        summaryPreview: legacySummary.slice(0, 120),
      });
    } else {
      agents.push({
        role,
        status: trivialPath && role === 'qa' ? 'skipped' : 'unknown',
        durationMs: duration,
        filesTouched: 0,
        estimatedTokensOutput: 0,
        tokensInput: 0,
        tokensOutput: 0,
        tokensReasoning: 0,
        summaryPreview: trivialPath && role === 'qa' ? '(skipped — trivial path)' : '(no output)',
      });
    }
  }

  return {
    taskId,
    completedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - startTime,
    agents,
    trivialPath,
    documentationGenerated,
  };
};

export const writeMetrics = (taskId: string, metrics: TaskMetrics): string => {
  const dir = join(CWD, '.pi', 'swarm', 'outputs');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${taskId}_metrics.json`);
  writeFileSync(p, JSON.stringify(metrics, null, 2));
  return p;
};

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
