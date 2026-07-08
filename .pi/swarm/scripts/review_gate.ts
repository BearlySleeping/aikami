#!/usr/bin/env bun
// .pi/swarm/scripts/review_gate.ts
/**
 * Self-contained review gate — reads upstream handoffs, presents summary,
 * loops on stdin until the user provides a terminal response.
 *
 * The gate writes two handoff versions:
 *   1. `awaiting_approval` → immediately (pipeline knows review is displayed)
 *   2. Terminal status (approved/rejected/feedback) → after user input
 *
 * Response classification:
 *   "lgtm" / "approve" / "yes" / "y" → approved
 *   "reject" / "no" / "n"           → rejected
 *   empty                            → re-prompt
 *   anything else                    → feedback to coder
 *
 * Usage: bun run .pi/swarm/scripts/review_gate.ts <taskId>
 */

const taskId = process.argv[2];
if (!taskId) {
  console.error('Usage: review_gate.ts <taskId>');
  process.exit(1);
}

const { readFileSync, mkdirSync, writeFileSync } = await import('node:fs');
const { join } = await import('node:path');

// ── Read upstream handoffs ─────────────────────────────────

type Handoff = { summary: string; status: string; filesTouched?: string[] };

const read = (role: string): Handoff | null => {
  try {
    return JSON.parse(
      readFileSync(join('.pi/swarm/outputs', `${taskId}_${role}_handoff.json`), 'utf-8'),
    );
  } catch {
    return null;
  }
};

const a = read('architect');
const c = read('coder');
const q = read('qa');

// ── Write initial "awaiting" handoff ───────────────────────

const writeHandoff = (status: string, summary: string, nextCommands: string[] = []) => {
  mkdirSync('.pi/swarm/outputs', { recursive: true });
  writeFileSync(
    join('.pi/swarm/outputs', `${taskId}_review_handoff.json`),
    JSON.stringify({
      taskId,
      role: 'review',
      status,
      complexity: 'standard',
      domain: 'fullstack',
      requiresDocs: false,
      filesTouched: [],
      nextCommands,
      summary,
    }),
  );
};

// ── Display review summary ─────────────────────────────────

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
  const files = (c.filesTouched || []).join(', ') || 'no files';
  console.log(`\n💻 Coder [${c.status}]: ${files}\n   ${c.summary.slice(0, 120)}`);
}
if (q) {
  console.log(`\n🧪 QA [${q.status}]: ${q.summary.slice(0, 120)}`);
}

console.log('');
console.log('──────────────────────────────────────────');
console.log('  Type your response and press Enter:');
console.log('  ✅  lgtm / approve  → commit & push');
console.log('  ❌  reject          → stop pipeline');
console.log('  💬  anything else   → feedback to coder');
console.log('──────────────────────────────────────────');

// Write awaiting handoff — pipeline now knows review is displayed
writeHandoff('awaiting_approval', 'Review displayed. Waiting for user input.');

// ── Stdin REPL — loop until terminal status ────────────────

const classify = (input: string): { status: string; summary: string; nextCommands: string[] } => {
  const normalized = input.trim().toLowerCase();

  if (!normalized) {
    // Empty input — re-prompt (NEVER auto-approve)
    return { status: '', summary: '', nextCommands: [] };
  }
  if (
    normalized === 'lgtm' ||
    normalized === 'approve' ||
    normalized === 'yes' ||
    normalized === 'y'
  ) {
    return {
      status: 'approved',
      summary: 'User approved. Proceed to commit & push.',
      nextCommands: [],
    };
  }
  if (normalized === 'reject' || normalized === 'no' || normalized === 'n') {
    return { status: 'rejected', summary: 'User rejected. Pipeline stopped.', nextCommands: [] };
  }
  // Everything else is feedback to coder
  return {
    status: 'feedback',
    summary: `${input.trim()}`,
    nextCommands: ['route:coder'],
  };
};

// Bun supports async iteration over console (stdin)
for await (const line of console) {
  const outcome = classify(line);

  if (!outcome.status) {
    // Empty input — re-prompt
    console.log('⚠️  Empty input — type "lgtm", "reject", or feedback text:');
    continue;
  }

  writeHandoff(outcome.status, outcome.summary, outcome.nextCommands);

  if (outcome.status === 'approved') {
    console.log('✅ APPROVED — proceeding to git commit & push');
  } else if (outcome.status === 'rejected') {
    console.log('❌ REJECTED — pipeline stopped');
  } else {
    console.log(`🔄 ROUTING TO CODER with feedback (${outcome.summary.slice(0, 60)}...)`);
  }
  break;
}
