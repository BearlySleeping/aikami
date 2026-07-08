#!/usr/bin/env bun
// .pi/swarm/scripts/git_commit.ts
/**
 * Deterministic git commit & push — executes the plan from git_planner.ts.
 *
 * Phase 1 (git_planner.ts, deterministic): reads handoffs, checks approval,
 * determines files, generates commit message, updates contract. Writes git_plan.json.
 *
 * Phase 2 (this script): reads the plan, stages, commits, pushes. Every exit path
 * writes a git_handoff.json so the director never waits 30 min for a script crash.
 *
 * Usage: bun run .pi/swarm/scripts/git_commit.ts <taskId> [contractPath]
 */

const taskId = process.argv[2];

if (!taskId) {
  console.error('Usage: git_commit.ts <taskId> [contractPath]');
  process.exit(1);
}

const { execFileSync } = await import('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
const { join } = await import('node:path');

// ── Types ──────────────────────────────────────────────────

type GitPlan = {
  taskId: string;
  commitMessage: string;
  filesToStage: string[];
  status: string;
  reason?: string;
};

// ── Handoff helper (every exit path calls this) ────────────

const handoffPath = join('.pi/swarm/outputs', `${taskId}_git_handoff.json`);

const writeHandoff = (status: string, summary: string, files: string[]): void => {
  mkdirSync('.pi/swarm/outputs', { recursive: true });
  writeFileSync(
    handoffPath,
    JSON.stringify({
      taskId,
      role: 'git',
      status,
      complexity: 'standard',
      domain: 'fullstack',
      requiresDocs: false,
      filesTouched: files,
      nextCommands: [],
      summary,
    }),
  );
};

// ── Read deterministic plan (from git_planner.ts) ──────────

const gitPlanPath = join('.pi/swarm/outputs', `${taskId}_git_plan.json`);
let gitPlan: GitPlan | null = null;

try {
  gitPlan = JSON.parse(readFileSync(gitPlanPath, 'utf-8')) as GitPlan;
} catch {
  writeHandoff('failed', 'No git plan found — git_planner.ts must run first.', []);
  process.exit(1);
}

if (gitPlan.status !== 'ready') {
  writeHandoff(
    'failed',
    `Git plan not ready (status: ${gitPlan.status}): ${gitPlan.reason ?? 'unknown'}`,
    [],
  );
  process.exit(1);
}

// ── Verify files exist ────────────────────────────────────

const filesToStage = gitPlan.filesToStage ?? [];
const verifiedFiles: string[] = [];

for (const f of filesToStage) {
  if (existsSync(f)) {
    verifiedFiles.push(f);
  } else {
    console.warn(`⚠️  File not found, skipping: ${f}`);
  }
}

if (verifiedFiles.length === 0) {
  writeHandoff('success', 'No files to commit (all files from plan missing).', []);
  process.exit(0);
}

// ── Commit message ────────────────────────────────────────

const commitMsg =
  gitPlan.commitMessage || `feat(contract-${taskId.toLowerCase()}): implement ${taskId}`;

console.log('');
console.log(`Commit: ${commitMsg}`);
console.log(`Files (${verifiedFiles.length}):`);
for (const f of verifiedFiles) {
  console.log(`  ${f}`);
}
console.log('');

// ── Stage, commit, push ───────────────────────────────────

try {
  // Stage only the plan's files
  for (const f of verifiedFiles) {
    execFileSync('git', ['add', f]);
  }
  console.log(`✅ Staged ${verifiedFiles.length} files`);

  // Snapshot staged files AFTER pre-commit hooks may have modified the index.
  // The pre-commit hook runs `bun knowledge:sync && git add docs/contracts/`,
  // which can stage unrelated contract files. Detect and unstage them.
  const afterHookFiles = execFileSync('git', ['diff', '--cached', '--name-only'], {
    encoding: 'utf-8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  const planFileSet = new Set(verifiedFiles);
  // Allowlist: plan files + auto-generated files from knowledge:sync
  const autoAllowlist = ['.context/llms.txt'];
  const taskDocPrefix = `docs/contracts/${taskId}`;
  const extraFiles = afterHookFiles.filter(
    (f) => !planFileSet.has(f) && !autoAllowlist.includes(f) && !f.startsWith(taskDocPrefix),
  );

  if (extraFiles.length > 0) {
    console.warn(`⚠️  Pre-commit hook staged extra files outside the plan:`);
    for (const f of extraFiles) {
      console.warn(`   Unstaging: ${f}`);
      execFileSync('git', ['restore', '--staged', f]);
    }
  }

  execFileSync('git', ['commit', '-m', commitMsg]);
  console.log('✅ Committed');

  try {
    execFileSync('git', ['push']);
    console.log('✅ Pushed');
  } catch (pushError) {
    const errMsg = pushError instanceof Error ? pushError.message : String(pushError);
    // Commit succeeded, push failed — don't roll back. Partial success.
    writeHandoff(
      'partial',
      `Committed but push failed: ${errMsg}. Manual push needed.`,
      verifiedFiles,
    );
    process.exit(1);
  }
} catch (error) {
  // Capture tail of stderr+stdout for the failure handoff
  const errMsg =
    error instanceof Error
      ? `${error.message}\n${'stderr' in error ? String((error as Record<string, unknown>).stderr ?? '').slice(-2000) : ''}`
      : String(error);
  console.error(`❌ Git operation failed: ${errMsg}`);
  writeHandoff('failed', `Git failed: ${errMsg.slice(0, 2048)}`, verifiedFiles);
  process.exit(1);
}

// ── Write success handoff ─────────────────────────────────

writeHandoff('success', `Committed & pushed: ${commitMsg}`, verifiedFiles);
