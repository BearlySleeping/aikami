// scripts/src/lib/agents/git_planner.ts
/**
 * Deterministic git commit planner — replaces the git LLM entirely.
 *
 * Reads all upstream handoffs, checks review approval, determines files to
 * commit, generates a conventional commit message, updates the contract status.
 * Writes <task>_git_plan.json to .pi/swarm/outputs/.
 *
 * No LLM calls — all decisions are deterministic. The commit script
 * (git_commit.ts) reads the plan file and executes it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SwarmHandoff } from '@aikami/types';

// ── Types ──────────────────────────────────────────────────

/**
 * Deterministic git plan — read by git_commit.ts for safe execution.
 */
export type GitPlan = {
  taskId: string;
  /** Conventional commit message */
  commitMessage: string;
  /** Files to stage (exist-checked, filtered) */
  filesToStage: string[];
  /** Status after plan: 'ready' | 'awaiting_approval' | 'no_files' */
  status: 'ready' | 'awaiting_approval' | 'no_files';
  /** Reason string when status !== 'ready' */
  reason?: string;
};

// ── Helpers ────────────────────────────────────────────────

const readHandoff = (taskId: string, role: string, cwd: string): SwarmHandoff | null => {
  const p = join(cwd, '.pi/swarm/outputs', `${taskId}_${role}_handoff.json`);
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as SwarmHandoff;
  } catch {
    return null;
  }
};

/**
 * Scan the architect summary for keyword signals to infer commit type.
 */
const inferCommitType = (summary: string): string => {
  const lower = summary.toLowerCase();
  if (lower.includes('fix') || lower.includes('bug') || lower.includes('broken')) {
    return 'fix';
  }
  if (lower.includes('refactor') || lower.includes('restructure')) {
    return 'refactor';
  }
  if (lower.includes('doc') || lower.includes('readme')) {
    return 'docs';
  }
  return 'feat';
};

/**
 * Update the contract file's status row in-place.
 *
 * Finds the `| **Status** |` row in the markdown table and replaces its value.
 * Appends a fallback line at end if no status row is found.
 */
const updateContractStatus = (contractPath: string): void => {
  let content: string;
  try {
    content = readFileSync(contractPath, 'utf-8');
  } catch {
    console.warn(`[git_planner] contract not found: ${contractPath}`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  // Match only the value cell of a `| **Status** | <value> |` table row —
  // idempotent across re-runs (never appends a second trailing pipe).
  const statusPattern = /^(\|\s*\*{0,2}Status\*{0,2}\s*\|\s*)([^|\n]*)(\|?\s*)$/im;

  if (statusPattern.test(content)) {
    content = content.replace(statusPattern, `$1completed (${today}) $3`);
  } else {
    content += `\n\n**Completed:** ${today} via swarm pipeline.\n`;
  }

  writeFileSync(contractPath, content);
};

// ── Main planner ───────────────────────────────────────────

/**
 * Generate a deterministic git commit plan.
 *
 * Reads architect, coder, qa, and review handoffs. Checks review approval.
 * Collects files from coder + qa handoffs + contract file. Filters out
 * forbidden paths (node_modules, .pi/swarm/, bun.lock, .env).
 * Generates a conventional commit message from the architect summary.
 * Updates the contract status row in-place.
 * Writes the plan to `<task>_git_plan.json`.
 *
 * @throws If review is not approved (caller handles escalation).
 */
export const planGitCommit = (options: {
  taskId: string;
  cwd: string;
  contractPath: string;
}): GitPlan => {
  const { taskId, cwd, contractPath } = options;
  const outputsDir = join(cwd, '.pi/swarm/outputs');
  mkdirSync(outputsDir, { recursive: true });

  // ── Read upstream handoffs ──
  const architect = readHandoff(taskId, 'architect', cwd);
  const coder = readHandoff(taskId, 'coder', cwd);
  const qa = readHandoff(taskId, 'qa', cwd);
  const review = readHandoff(taskId, 'review', cwd);

  // ── Approval check ──
  if (review?.status !== 'approved') {
    // Write the plan anyway for observability
    const plan: GitPlan = {
      taskId,
      commitMessage: '',
      filesToStage: [],
      status: 'awaiting_approval',
      reason: 'Review has not been approved yet.',
    };
    writeFileSync(join(outputsDir, `${taskId}_git_plan.json`), JSON.stringify(plan, null, 2));
    throw new Error('review not approved — cannot plan commit');
  }

  // ── Collect files ──
  const forbiddenPrefixes = ['node_modules/', '.pi/swarm/', 'bun.lock', '.env'];
  const forbiddenExact = ['bun.lock', '.env'];

  const seen = new Set<string>();
  const filesToStage: string[] = [];

  const addFile = (f: string): void => {
    const trimmed = f.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    // Reject hallucinated backslash-escaped route groups (`\(dev\)`) — these
    // are broken literal directories, never legitimate commit targets.
    if (/\\\(/.test(trimmed)) {
      console.warn(`[git_planner] rejecting backslash-escaped path: ${trimmed}`);
      return;
    }
    // Filter forbidden paths
    if (forbiddenExact.includes(trimmed)) {
      return;
    }
    if (forbiddenPrefixes.some((p) => trimmed.startsWith(p))) {
      return;
    }
    // Must exist on disk
    const abs = join(cwd, trimmed);
    if (!existsSync(abs)) {
      console.warn(`[git_planner] file not found, skipping: ${trimmed}`);
      return;
    }
    seen.add(trimmed);
    filesToStage.push(trimmed);
  };

  const docs = readHandoff(taskId, 'docs', cwd);

  for (const f of coder?.filesTouched ?? []) {
    addFile(f);
  }
  for (const f of qa?.filesTouched ?? []) {
    addFile(f);
  }
  for (const f of docs?.filesTouched ?? []) {
    addFile(f);
  }

  // Update contract status and add to stage
  updateContractStatus(contractPath);

  // Derive the relative contract path
  const contractRel = contractPath.startsWith(cwd)
    ? contractPath.slice(cwd.length + 1)
    : contractPath;
  addFile(contractRel);

  if (filesToStage.length === 0) {
    const plan: GitPlan = {
      taskId,
      commitMessage: '',
      filesToStage: [],
      status: 'no_files',
      reason: 'No files to commit (all filtered or missing).',
    };
    writeFileSync(join(outputsDir, `${taskId}_git_plan.json`), JSON.stringify(plan, null, 2));
    return plan;
  }

  // ── Generate commit message ──
  const type = inferCommitType(architect?.summary ?? '');
  const id = taskId.replace(/^C-/, '').toLowerCase();
  const firstLine = (architect?.summary ?? `Implement ${taskId}`)
    .split('\n')[0]
    ?.slice(0, 60)
    .trim();
  const commitMessage = `${type}(contract-${id}): ${firstLine}`;

  // ── Write plan ──
  const plan: GitPlan = {
    taskId,
    commitMessage,
    filesToStage,
    status: 'ready',
  };

  writeFileSync(join(outputsDir, `${taskId}_git_plan.json`), JSON.stringify(plan, null, 2));
  console.log('[git_planner] plan written', {
    files: filesToStage.length,
    message: commitMessage,
  });

  return plan;
};
