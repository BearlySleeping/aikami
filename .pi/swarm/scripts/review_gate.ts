#!/usr/bin/env bun
// .pi/swarm/scripts/review_gate.ts
/**
 * Self-contained review gate — reads upstream handoffs, presents summary,
 * loops on stdin until the user provides a terminal response.
 *
 * Also polls the handoff file every 2s — if an external tool (like
 * swarm_review_respond from another pi session) writes a decision, the
 * gate auto-exits. This prevents the gate from consuming git_commit.ts
 * as stdin when the pipeline advances.
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

const handoffFilePath = join('.pi/swarm/outputs', `${taskId}_review_handoff.json`);

/** Check if an external tool wrote a terminal decision. Returns status if found. */
const checkExternalDecision = (): string | null => {
  try {
    const raw = readFileSync(handoffFilePath, 'utf-8');
    const h = JSON.parse(raw) as { status: string };
    if (h.status !== 'awaiting_approval') {
      return h.status;
    }
  } catch {
    /* not written yet */
  }
  return null;
};

const a = read('architect');
const c = read('coder');
const q = read('qa');

// ── Write initial "awaiting" handoff ───────────────────────

const writeHandoff = (status: string, summary: string, nextCommands: string[] = []) => {
  mkdirSync('.pi/swarm/outputs', { recursive: true });
  writeFileSync(
    handoffFilePath,
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
  const files = (c.filesTouched || []).slice(0, 5).join(', ') || 'no files';
  console.log(`\n💻 Coder [${c.status}]: ${files}...`);
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

// ── Classification ─────────────────────────────────────────

const classify = (input: string): { status: string; summary: string; nextCommands: string[] } => {
  const normalized = input.trim().toLowerCase();

  if (!normalized) {
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
  return {
    status: 'feedback',
    summary: `${input.trim()}`,
    nextCommands: [],
  };
};

// ── Start polling for external decisions (every 2s) ────────

let polling = true;
const pollInterval = setInterval(() => {
  if (!polling) {
    return;
  }
  const ext = checkExternalDecision();
  if (ext) {
    polling = false;
    console.log(`\n📡 External decision detected: ${ext} — exiting.`);
    // Force exit — the director has already moved on
    process.exit(0);
  }
}, 2_000);

// ── Stdin REPL — loop until terminal status ────────────────

try {
  for await (const line of console) {
    // Stale input guard: if external decision already made, discard
    if (!polling) {
      break;
    }

    const outcome = classify(line);

    if (!outcome.status) {
      console.log('⚠️  Empty input — type "lgtm", "reject", or feedback text:');
      continue;
    }

    polling = false;
    clearInterval(pollInterval);

    writeHandoff(outcome.status, outcome.summary, outcome.nextCommands);

    if (outcome.status === 'approved') {
      console.log('✅ APPROVED — proceeding.');
    } else if (outcome.status === 'rejected') {
      console.log('❌ REJECTED — pipeline stopped.');
    } else {
      console.log(`🔄 FEEDBACK to coder: ${outcome.summary.slice(0, 60)}...`);
    }
    break;
  }
} finally {
  clearInterval(pollInterval);
}
