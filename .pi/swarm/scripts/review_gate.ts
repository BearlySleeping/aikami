#!/usr/bin/env bun
// .pi/swarm/scripts/review_gate.ts
/**
 * Review gate — reads upstream handoffs, presents summary, waits for approval.
 *
 * The review gate runs in a herdr pane. It shows the review summary and uses
 * shell `read` (via a generated shell snippet) to wait for user input.
 *
 * Usage: bun run .pi/swarm/scripts/review_gate.ts <taskId>
 */

const taskId = process.argv[2];
if (!taskId) {
  console.error('Usage: review_gate.ts <taskId>');
  process.exit(1);
}

const { readFileSync, mkdirSync, writeFileSync } = await import('node:fs');

type Handoff = { summary: string; status: string; filesTouched: string[] };
const read = (role: string): Handoff | null => {
  try {
    return JSON.parse(readFileSync(`.pi/swarm/outputs/${taskId}_${role}_handoff.json`, 'utf-8'));
  } catch {
    return null;
  }
};

const a = read('architect');
const c = read('coder');
const q = read('qa');
const g = read('git');

// ── Display review ─────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════╗');
console.log('║         SWARM REVIEW GATE               ║');
console.log('╠══════════════════════════════════════════╣');
console.log(`║  Task: ${taskId.padEnd(34)}║`);
console.log('╚══════════════════════════════════════════╝');
if (a) {
  console.log(`\n📋 Architect: ${a.summary.slice(0, 120)}`);
}
if (c) {
  console.log(
    `\n💻 Coder [${c.status}]: ${c.filesTouched.join(', ') || 'no files'}\n   ${c.summary.slice(0, 120)}`,
  );
}
if (q) {
  console.log(`\n🧪 QA [${q.status}]: ${q.summary.slice(0, 120)}`);
}
if (g) {
  console.log(`\n📦 Planned commit: ${g.summary.slice(0, 150)}`);
}

console.log('');
console.log('──────────────────────────────────────────');
console.log('  Type your response and press Enter:');
console.log('  ✅ "approve" → commit');
console.log('  🔄 anything else → feedback to coder');
console.log('──────────────────────────────────────────');
console.log('');

// Write "awaiting" handoff so orchestrator knows we're waiting
mkdirSync('.pi/swarm/outputs', { recursive: true });
writeFileSync(
  `.pi/swarm/outputs/${taskId}_review_handoff.json`,
  JSON.stringify({
    taskId,
    role: 'review',
    status: 'awaiting_approval',
    complexity: 'standard',
    domain: 'fullstack',
    requiresDocs: false,
    filesTouched: [],
    nextCommands: [],
    summary: 'Review displayed. Waiting for user input.',
  }),
);

// The shell `read` will block until user presses Enter
// We print a special marker that the orchestrator can detect
console.log(`SWARM_DONE:review:${taskId}`);
