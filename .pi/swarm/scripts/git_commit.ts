#!/usr/bin/env bun
// .pi/swarm/scripts/git_commit.ts
/**
 * Deterministic git commit & push — executes the plan validated by the LLM.
 *
 * Phase 1 (LLM, free tier) validates: reads handoffs, checks approval, determines
 * files, generates commit message, updates contract status. Writes git_handoff.json.
 *
 * Phase 2 (this script) executes: reads the LLM's handoff, stages, commits, pushes.
 * No decision-making — just safe execution of the validated plan.
 *
 * Usage: bun run .pi/swarm/scripts/git_commit.ts <taskId> [contractPath]
 */

const taskId = process.argv[2];

if (!taskId) {
  console.error('Usage: git_commit.ts <taskId> [contractPath]');
  process.exit(1);
}

const { execFileSync } = await import('node:child_process');
const { readFileSync, writeFileSync, mkdirSync, existsSync } = await import('node:fs');
const { join } = await import('node:path');

// ── Read LLM's validated handoff ──────────────────────────

type GitHandoff = {
  taskId: string;
  role: string;
  status: string;
  summary: string;
  filesTouched: string[];
};

const gitHandoffPath = join('.pi/swarm/outputs', `${taskId}_git_handoff.json`);
let gitHandoff: GitHandoff | null = null;

try {
  gitHandoff = JSON.parse(readFileSync(gitHandoffPath, 'utf-8')) as GitHandoff;
} catch {
  console.error('❌ No git handoff found — LLM validation must run first');
  process.exit(1);
}

if (gitHandoff.status !== 'success') {
  console.error(`❌ LLM validation not successful (status: ${gitHandoff.status}) — aborting`);
  process.exit(1);
}

// ── Verify files exist ────────────────────────────────────

const filesToStage = gitHandoff.filesTouched ?? [];
const verifiedFiles: string[] = [];

for (const f of filesToStage) {
  if (existsSync(f)) {
    verifiedFiles.push(f);
  } else {
    console.warn(`⚠️  File not found, skipping: ${f}`);
  }
}

if (verifiedFiles.length === 0) {
  console.warn('⚠️  No files to commit');
  writeHandoff('success', 'No files to commit (all files from handoff missing).', []);
  process.exit(0);
}

// ── Commit message ────────────────────────────────────────

const commitMsg =
  gitHandoff.summary || `feat(contract-${taskId.toLowerCase()}): implement ${taskId}`;

console.log('');
console.log(`Commit: ${commitMsg}`);
console.log(`Files (${verifiedFiles.length}):`);
for (const f of verifiedFiles) {
  console.log(`  ${f}`);
}
console.log('');

// ── Stage, commit, push ───────────────────────────────────

try {
  for (const f of verifiedFiles) {
    execFileSync('git', ['add', f]);
  }
  console.log(`✅ Staged ${verifiedFiles.length} files`);

  execFileSync('git', ['commit', '-m', commitMsg]);
  console.log('✅ Committed');

  execFileSync('git', ['push']);
  console.log('✅ Pushed');
} catch (error) {
  const errMsg = error instanceof Error ? error.message : String(error);
  console.error(`❌ Git operation failed: ${errMsg}`);
  writeHandoff('failed', `Git failed: ${errMsg}`, verifiedFiles);
  process.exit(1);
}

// ── Write success handoff ─────────────────────────────────

writeHandoff('success', `Committed & pushed: ${commitMsg}`, verifiedFiles);

// ── Helpers ───────────────────────────────────────────────

function writeHandoff(status: string, summary: string, files: string[]): void {
  mkdirSync('.pi/swarm/outputs', { recursive: true });
  writeFileSync(
    gitHandoffPath,
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
}
