// scripts/src/lib/agents/swarm_janitor.ts
/**
 * Swarm janitor — deterministic cleanup of stale artifacts.
 *
 * Run after pipeline completion to keep the payload + outputs directories
 * lean. Each completed task leaves ~3–6 files; TEST-* payloads are test-only
 * and safe to delete after a retention window.
 *
 * Cleans:
 *   1. TEST-* payloads older than RETENTION_DAYS
 *   2. Completed non-TEST payloads + their outputs older than RETENTION_DAYS
 *   3. The current task's own payload (always cleaned on completion)
 *
 * No LLM calls — pure filesystem ops.
 *
 * Usage:
 *   bun run scripts/src/lib/agents/swarm_janitor.ts          # default: 7-day retention
 *   bun run scripts/src/lib/agents/swarm_janitor.ts --all    # clean everything, no retention
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// ── Constants ──────────────────────────────────────────────

const RETENTION_DAYS = 7;
const MS_PER_DAY = 86_400_000;
const CWD = process.cwd();

const PAYLOADS_DIR = join(CWD, '.pi', 'swarm', 'payloads');
const OUTPUTS_DIR = join(CWD, '.pi', 'swarm', 'outputs');
const PLANS_DIR = join(CWD, '.pi', 'swarm', 'plans');

// ── Helpers ────────────────────────────────────────────────

const isStale = (mtimeMs: number, retentionDays: number): boolean =>
  Date.now() - mtimeMs > retentionDays * MS_PER_DAY;

const unlinkIfExists = (path: string): boolean => {
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
};

const glob = (dir: string, pattern: RegExp): string[] => {
  try {
    return readdirSync(dir).filter((f) => pattern.test(f));
  } catch {
    return [];
  }
};

const parseTaskIdFromFile = (filename: string): string | null => {
  const m = filename.match(/^(C-[\w-]+|TEST-[\w-]+)/i);
  return m ? m[0].toUpperCase() : null;
};

// ── Main ────────────────────────────────────────────────────

/** Clean a single task's artifacts from all directories (payloads + outputs + plans). */
export const cleanTask = (taskId: string): number => {
  let removed = 0;

  // Payload file
  for (const f of glob(PAYLOADS_DIR, new RegExp(`^payload_${taskId}\\.json$`, 'i'))) {
    if (unlinkIfExists(join(PAYLOADS_DIR, f))) {
      removed++;
    }
  }
  // If the payload file used a simple name pattern (C-xxx.json, TEST-xxx.json)
  for (const f of glob(PAYLOADS_DIR, new RegExp(`^${taskId}\\.json$`, 'i'))) {
    if (unlinkIfExists(join(PAYLOADS_DIR, f))) {
      removed++;
    }
  }

  // Output files: handoffs, feedback, pipeline log, metrics, durations, failures
  for (const f of glob(OUTPUTS_DIR, new RegExp(`^${taskId}_`))) {
    if (unlinkIfExists(join(OUTPUTS_DIR, f))) {
      removed++;
    }
  }

  // Plan file
  for (const f of glob(PLANS_DIR, new RegExp(`^architect_plan_${taskId}\\.md$`, 'i'))) {
    if (unlinkIfExists(join(PLANS_DIR, f))) {
      removed++;
    }
  }

  // Director lock
  for (const f of glob(OUTPUTS_DIR, new RegExp(`^${taskId}_director\\.lock$`, 'i'))) {
    if (unlinkIfExists(join(OUTPUTS_DIR, f))) {
      removed++;
    }
  }

  return removed;
};

/**
 * Full sweep — clean stale payloads + outputs, then clean the current task.
 *
 * Rules:
 *   - TEST-* payloads: deleted if stale (7 days) or if --all
 *   - C-* completed tasks: deleted if stale + metrics exist (proof of completion)
 *   - Current task (currentTaskId): always cleaned
 *   - Keeps: contract files (docs/contracts/), metrics for recent tasks
 *
 * @param retentionDays  Number of days before a completed task is considered stale.
 * @param currentTaskId  If provided, this task is always cleaned regardless of age.
 * @returns Total files removed.
 */
export const janitorSweep = (
  retentionDays: number = RETENTION_DAYS,
  currentTaskId?: string,
): number => {
  let removed = 0;

  // ── Phase 1: scan payloads, determine which tasks to clean ──
  const payloadFiles = glob(PAYLOADS_DIR, /^payload_(C-|TEST-)/i);
  const simpleFiles = glob(PAYLOADS_DIR, /^(C-|TEST-)/i);
  const allPayloadTasks = new Set<string>();

  for (const f of [...payloadFiles, ...simpleFiles]) {
    const fullPath = join(PAYLOADS_DIR, f);
    let taskId: string | null = null;

    // Normalize: payload_C-xxx.json → C-XXX, C-xxx.json → C-XXX
    const mp = f.match(/^payload_(C-[\w-]+|TEST-[\w-]+)\.json$/i);
    const ms = f.match(/^(C-[\w-]+|TEST-[\w-]+)\.json$/i);
    taskId = (mp?.[1] ?? ms?.[1] ?? '').toUpperCase();
    if (!taskId) {
      continue;
    }

    const isCurrent = taskId === currentTaskId?.toUpperCase();

    if (isCurrent) {
      // Current task: always clean below
      allPayloadTasks.add(taskId);
      continue;
    }

    // TEST-* payloads: clean if stale
    if (taskId.toUpperCase().startsWith('TEST-')) {
      try {
        const mtime = statSync(fullPath).mtimeMs;
        if (isStale(mtime, retentionDays)) {
          allPayloadTasks.add(taskId);
        }
      } catch {
        // can't stat — skip
      }
      continue;
    }

    // C-* payloads: clean if stale AND metrics exist (proof of completion)
    try {
      const mtime = statSync(fullPath).mtimeMs;
      if (isStale(mtime, retentionDays)) {
        // Verify completion
        const metricsPath = join(OUTPUTS_DIR, `${taskId}_metrics.json`);
        if (existsSync(metricsPath)) {
          allPayloadTasks.add(taskId);
        }
      }
    } catch {
      // can't stat — skip
    }
  }

  // ── Phase 2: clean each identified task ──
  for (const taskId of allPayloadTasks) {
    removed += cleanTask(taskId);
  }

  // ── Phase 3: clean orphaned output files (no matching payload) ──
  // Orphaned handoffs older than 2× retention
  for (const f of glob(OUTPUTS_DIR, /^(C-|TEST-)/i)) {
    const taskId = parseTaskIdFromFile(f);
    if (!taskId || allPayloadTasks.has(taskId)) {
      continue;
    }
    try {
      const mtime = statSync(join(OUTPUTS_DIR, f)).mtimeMs;
      if (isStale(mtime, retentionDays * 2)) {
        if (unlinkIfExists(join(OUTPUTS_DIR, f))) {
          removed++;
        }
      }
    } catch {
      // skip
    }
  }

  // ── Phase 4: clean orphaned plans ──
  for (const f of glob(PLANS_DIR, /^architect_plan_(C-|TEST-)/i)) {
    const taskId = parseTaskIdFromFile(f.replace(/^architect_plan_/, ''));
    if (!taskId) {
      continue;
    }
    try {
      const mtime = statSync(join(PLANS_DIR, f)).mtimeMs;
      if (isStale(mtime, retentionDays * 2)) {
        if (unlinkIfExists(join(PLANS_DIR, f))) {
          removed++;
        }
      }
    } catch {
      // skip
    }
  }

  return removed;
};

// ── CLI entry point ──────────────────────────────────────────

const isMain =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('swarm_janitor.ts');

if (isMain) {
  const skipRetention = process.argv.includes('--all') || process.argv.includes('--force');
  const days = skipRetention ? 0 : RETENTION_DAYS;
  const taskId = process.argv.find((a) => /^(C-|TEST-)/i.test(a) && !a.startsWith('--'));

  mkdirSync(PAYLOADS_DIR, { recursive: true });
  mkdirSync(OUTPUTS_DIR, { recursive: true });

  const removed = janitorSweep(days, taskId);
  console.log(`🧹 Swarm janitor: removed ${removed} files (retention: ${days} days)`);
  if (taskId) {
    console.log(`   Current task ${taskId} cleaned unconditionally.`);
  }
}
