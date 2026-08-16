#!/usr/bin/env bun
// scripts/src/lib/ops/infra_report.ts
//
// Infrastructure-issue log — a shared place for the contract pipeline (and
// anything else that touches herdr/pi/gh) to record when it silently worked
// around a failure, so a human can see the pattern instead of it staying
// buried in a `catch { /* non-fatal */ }` block forever.
//
// 🔴 Why this exists (rig-audit finding): the pipeline's PR-URL lookup broke
// on Windows (F-02 — hand-POSIX-quoted execSync), and the failure vanished
// into `catch { return undefined }`. The orchestrator concluded "No PR
// found — review captain should have created one" — a confident, wrong
// diagnosis. Nothing recorded that gh actually failed, or why. This module
// is the fix for THAT gap specifically: it does not replace error handling
// or retries, it gives silently-recovered failures a place to be seen.
//
// Scope discipline — call `reportInfraIssue` ONLY from a degradation site:
// a place where code caught a failure, worked around it, and continued.
// A catch that rethrows needs nothing here — the error already travels.
// Reporting from every catch would turn this into noise nobody reads;
// reporting from none of them is the bug this file exists to fix.
//
// Storage: an append-only JSONL log at .pi/infra-issues.jsonl (gitignored,
// project-local — see the rig-audit's reasoning for why this stays
// per-repo rather than global-to-pi: the failures ARE this project's
// infrastructure, and a global store loses the repo context that makes an
// entry actionable). Appends never read-modify-write, so concurrent
// contract pipelines (each in their own worktree, all pointed at the same
// repo root) can write to it without racing each other.
//
// Usage:
//   import { reportInfraIssue } from '.../ops/infra_report.ts';
//   try {
//     symlinkSync(src, dst, 'dir');
//   } catch (err) {
//     reportInfraIssue({
//       component: 'worktree_bootstrap',
//       operation: 'symlink .pi/node_modules',
//       error: err,
//       context: { checkoutPath },
//     });
//     // ... existing fallback/continue logic, unchanged ...
//   }
//
//   bun run infra:report              # ranked table, newest-fingerprint-first
//   bun run infra:report --json       # machine-readable
//   bun run infra:report --since 24h  # only entries from the last 24h

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// 🔴 No import from cli_utils.ts (or anything else that touches `Bun.*`):
// this module is reachable from .pi/extensions/* via worktree.ts and
// orchestrator.ts, which pi loads under Node — see
// scripts/src/lib/env/runtime_boundary.test.ts, the mechanical guard for
// exactly this boundary. Minimal inline ANSI codes instead of the shared
// (Bun-using) formatting helpers.
const ansi = {
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  reset: '\x1b[0m',
};

export type InfraIssueEvent = {
  /** ISO timestamp. */
  timestamp: string;
  /** Subsystem that hit the failure, e.g. 'worktree_bootstrap', 'gh_pr_lookup'. */
  component: string;
  /** What was being attempted, e.g. 'symlink .pi/node_modules'. */
  operation: string;
  /** Normalized error message (see normalizeError). */
  error: string;
  /** Free-form extra context — kept small; this is a log line, not a dump. */
  context?: Record<string, string | number | boolean | undefined>;
  /** Contract-pipeline run this failure belongs to (see
   *  setActiveInfraRun / reportInfraIssue's `runId` option). Absent for
   *  events recorded outside any pipeline run (manual scripts, extensions). */
  runId?: string;
  /** component:operation:normalizedError — groups repeat occurrences. */
  fingerprint: string;
};

const LOG_RELATIVE_PATH = '.pi/infra-issues.jsonl';

const resolveLogPath = (cwd: string): string => join(cwd, LOG_RELATIVE_PATH);

/**
 * Strip volatile substrings (paths, pids, timestamps, run ids) from an error
 * message so repeat occurrences of the SAME underlying failure fingerprint
 * together instead of each getting its own one-off entry.
 */
export const normalizeError = (raw: string): string =>
  raw
    .replace(/[A-Za-z]:\\[^\s'"]+/g, '<path>') // Windows absolute paths
    .replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, '<path>') // POSIX absolute paths
    .replace(/\brun-[a-z0-9]+-[A-Za-z0-9-]+/g, '<run-id>')
    .replace(/\bpid\s*\d+/gi, 'pid <n>')
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<timestamp>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const buildFingerprint = (component: string, operation: string, normalizedError: string): string =>
  `${component}:${operation}:${normalizedError}`;

// ── Active run context ────────────────────────────────────────────────────
// The contract pipeline records degradation events from many shared helpers
// (session.ts, worktree.ts, git_worktree.ts) that have no run id of their
// own. The orchestrator sets the ambient active run once per pipeline
// process; reportInfraIssue stamps it onto every event recorded without an
// explicit `runId`, so prompt-note injection can filter to THIS run and
// exclude historical failures from previous runs.
let activeRunId: string | undefined;

/** Set (or clear, with undefined) the ambient contract-pipeline run id that
 *  reportInfraIssue stamps onto events recorded without an explicit runId. */
export const setActiveInfraRun = (runId: string | undefined): void => {
  activeRunId = runId;
};

/**
 * Record that a degradation site caught a failure and worked around it.
 * Never throws — a reporting failure must never become THE failure. Safe to
 * call from anywhere, including inside another catch block.
 */
export const reportInfraIssue = (options: {
  component: string;
  operation: string;
  error: unknown;
  context?: Record<string, string | number | boolean | undefined>;
  cwd?: string;
  /** Contract-pipeline run this failure belongs to — defaults to the
   *  ambient active run (see setActiveInfraRun). */
  runId?: string;
}): void => {
  try {
    const cwd = options.cwd ?? process.cwd();
    const normalized = normalizeError(errorMessage(options.error));
    const event: InfraIssueEvent = {
      timestamp: new Date().toISOString(),
      component: options.component,
      operation: options.operation,
      error: normalized,
      context: options.context,
      runId: options.runId ?? activeRunId,
      fingerprint: buildFingerprint(options.component, options.operation, normalized),
    };
    const logPath = resolveLogPath(cwd);
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(event)}\n`);
  } catch {
    // Reporting is best-effort only — never let it break the caller.
  }
};

export type InfraIssueSummary = {
  fingerprint: string;
  component: string;
  operation: string;
  error: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
};

/** Read every event from the log, tolerating partial/corrupt trailing lines. */
export const readInfraIssues = (cwd: string): InfraIssueEvent[] => {
  const logPath = resolveLogPath(cwd);
  if (!existsSync(logPath)) {
    return [];
  }
  const events: InfraIssueEvent[] = [];
  for (const line of readFileSync(logPath, 'utf-8').split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      events.push(JSON.parse(line) as InfraIssueEvent);
    } catch {
      // Skip a corrupted line (e.g. a torn write) rather than fail the read.
    }
  }
  return events;
};

/** Events recorded during ONE pipeline run — the view injected into that
 *  run's review prompt. Events without a runId (recorded by manual scripts
 *  or extensions, outside any pipeline) and events from previous runs are
 *  excluded, so historical gh/worktree/herdr failures never leak into a
 *  fresh run's notes. */
export const readInfraIssuesForRun = (cwd: string, runId: string): InfraIssueEvent[] =>
  readInfraIssues(cwd).filter((event) => event.runId === runId);

/** Group events by fingerprint into a ranked (most frequent first) summary. */
export const summarizeInfraIssues = (
  events: InfraIssueEvent[],
  options?: { sinceMs?: number },
): InfraIssueSummary[] => {
  const cutoff = options?.sinceMs !== undefined ? Date.now() - options.sinceMs : undefined;
  const byFingerprint = new Map<string, InfraIssueSummary>();
  for (const event of events) {
    if (cutoff !== undefined && new Date(event.timestamp).getTime() < cutoff) {
      continue;
    }
    const existing = byFingerprint.get(event.fingerprint);
    if (existing) {
      existing.count += 1;
      if (event.timestamp < existing.firstSeen) {
        existing.firstSeen = event.timestamp;
      }
      if (event.timestamp > existing.lastSeen) {
        existing.lastSeen = event.timestamp;
      }
    } else {
      byFingerprint.set(event.fingerprint, {
        fingerprint: event.fingerprint,
        component: event.component,
        operation: event.operation,
        error: event.error,
        count: 1,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
      });
    }
  }
  return [...byFingerprint.values()].sort((a, b) => b.count - a.count);
};

/** Format a ranked summary as the block injected into the review captain's prompt. */
export const formatInfraNotesForPrompt = (summary: InfraIssueSummary[]): string => {
  if (summary.length === 0) {
    return '';
  }
  const lines = summary
    .slice(0, 10)
    .map((s) => `- [${s.component}] ${s.operation} — ${s.error} (×${s.count}, last ${s.lastSeen})`);
  return [
    '',
    '## 🔧 Infrastructure notes (read-only — report, do not fix)',
    '',
    'The pipeline worked around the following during this run. These are tooling/',
    'infrastructure issues (herdr, pi extensions, gh, worktree bootstrap), not code',
    'defects in the contract — mention them in your summary for the user to triage',
    'later; do not attempt to fix the tooling itself as part of this run.',
    '',
    ...lines,
    '',
  ].join('\n');
};

const parseSince = (raw: string | undefined): number | undefined => {
  if (!raw) {
    return undefined;
  }
  const match = raw.match(/^(\d+)(h|d|m)$/);
  if (!match) {
    return undefined;
  }
  const n = Number(match[1]);
  const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 'm' | 'h' | 'd'];
  return n * unitMs;
};

// ── CLI ──────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const sinceIndex = args.indexOf('--since');
  const sinceMs = sinceIndex >= 0 ? parseSince(args[sinceIndex + 1]) : undefined;

  const events = readInfraIssues(process.cwd());
  const summary = summarizeInfraIssues(events, { sinceMs });

  if (jsonMode) {
    console.log(JSON.stringify(summary, undefined, 2));
  } else if (summary.length === 0) {
    console.log(`${ansi.green}✓${ansi.reset} No infrastructure issues recorded.`);
  } else {
    console.log(
      `\n${ansi.bold}Infrastructure issues (${summary.length} distinct, ${events.length} total)${ansi.reset}`,
    );
    for (const s of summary) {
      console.log(
        `\n${ansi.bold}${ansi.yellow}×${s.count}${ansi.reset}  ${ansi.bold}[${s.component}]${ansi.reset} ${s.operation}`,
      );
      console.log(`     ${s.error}`);
      console.log(`     ${ansi.dim}first ${s.firstSeen} · last ${s.lastSeen}${ansi.reset}`);
    }
    console.log();
  }
}
