// .pi/swarm/scripts/simulate_review.ts
/**
 * Simulated review agent — shows summary + waits for user approval.
 *
 * Reads upstream handoffs, presents the review, waits for user input,
 * and writes a routing decision.
 *
 * Usage: bun run .pi/swarm/scripts/simulate_review.ts <taskId>
 */

const taskId = process.argv[2];
if (!taskId) {
  console.error('Usage: simulate_review.ts <taskId>');
  process.exit(1);
}

const { readFileSync, mkdirSync, writeFileSync } = await import('node:fs');

type Handoff = {
  taskId: string;
  role: string;
  status: string;
  summary: string;
  filesTouched: string[];
  nextCommands: string[];
};

const readHandoff = (role: string): Handoff | null => {
  try {
    const raw = readFileSync(`.pi/swarm/outputs/${taskId}_${role}_handoff.json`, 'utf-8');
    return JSON.parse(raw) as Handoff;
  } catch {
    return null;
  }
};

const architect = readHandoff('architect');
const coder = readHandoff('coder');
const qa = readHandoff('qa');
const git = readHandoff('git');

console.log('');
console.log('╔══════════════════════════════════════════╗');
console.log('║         SWARM REVIEW — PENDING          ║');
console.log('╠══════════════════════════════════════════╣');
console.log(`║  Task: ${taskId.padEnd(34)}║`);
console.log('╚══════════════════════════════════════════╝');
console.log('');

if (architect) {
  console.log('📋 ARCHITECT PLAN:');
  console.log(`   ${architect.summary.slice(0, 120)}`);
  console.log('');
}
if (coder) {
  console.log('💻 CODER:');
  console.log(`   Status: ${coder.status}`);
  console.log(`   Files: ${coder.filesTouched.join(', ') || '(none)'}`);
  console.log(`   ${coder.summary.slice(0, 120)}`);
  console.log('');
}
if (qa) {
  console.log('🧪 QA:');
  console.log(`   Status: ${qa.status}`);
  console.log(`   ${qa.summary.slice(0, 120)}`);
  console.log('');
}
if (git) {
  console.log('📦 PLANNED COMMIT:');
  console.log(`   ${git.summary.slice(0, 150)}`);
  console.log('');
  if (git.nextCommands.length > 0) {
    console.log('   Commands:');
    for (const cmd of git.nextCommands) {
      console.log(`     $ ${cmd}`);
    }
    console.log('');
  }
}

console.log('──────────────────────────────────────────');
console.log('  Type your response:');
console.log('');
console.log('  ✅ "approve"  → proceed to commit');
console.log('  🔄 "change X" → send feedback to coder');
console.log('  🧪 "/qa"      → re-run QA');
console.log('  ❌ "reject"   → stop pipeline');
console.log('──────────────────────────────────────────');
console.log('');
console.log('Waiting for input...');

// Read a single line from stdin
const decoder = new TextDecoder();
const buf = new Uint8Array(4096);
const n = await (async (): Promise<number> => {
  return new Promise((resolve) => {
    // Bun doesn't support sync stdin reads easily, use a simple poll
    const _tryRead = () => {
      try {
        const bytes = new Uint8Array(4096);
        const result = require('node:fs').readSync(0, bytes);
        resolve(result);
      } catch {
        setTimeout(_tryRead, 100);
      }
    };
    // Use a different approach: read available stdin via Bun
    const stdin = process.stdin;
    let data = '';
    stdin.resume();
    stdin.on('data', (chunk: string) => {
      data += chunk;
      if (data.includes('\n')) {
        stdin.pause();
        resolve(data.length);
      }
    });
    // Timeout after 120s
    setTimeout(() => resolve(data.length), 120_000);
  });
})();

const getInput = (): string => {
  // After n bytes are read, get the first line
  const data = buf.subarray(0, n);
  const text = decoder.decode(data).trim();
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  return firstLine;
};

const input = getInput();
const normalized = input.toLowerCase().trim();

console.log('');
console.log(`Received: "${input}"`);
console.log('');

mkdirSync('.pi/swarm/outputs', { recursive: true });

let reviewStatus: string;
let reviewSummary: string;
let nextCommands: string[];

if (normalized === 'approve' || normalized === 'yes' || normalized === 'y') {
  reviewStatus = 'approved';
  reviewSummary = `User approved. Proceed to commit.`;
  nextCommands = [];
  console.log('✅ APPROVED — proceeding to git commit');
} else if (normalized === 'reject' || normalized === 'no' || normalized === 'n') {
  reviewStatus = 'rejected';
  reviewSummary = 'User rejected. Pipeline stopped.';
  nextCommands = [];
  console.log('❌ REJECTED — pipeline stopped');
} else if (normalized.startsWith('/qa')) {
  reviewStatus = 'feedback';
  reviewSummary = `User requested re-run: ${input}`;
  nextCommands = ['route:qa'];
  console.log('🔄 ROUTING TO QA');
} else if (normalized.length > 0) {
  reviewStatus = 'feedback';
  reviewSummary = `User feedback: ${input}`;
  nextCommands = ['route:coder'];
  console.log('🔄 ROUTING TO CODER with feedback');
} else {
  reviewStatus = 'approved';
  reviewSummary = 'Auto-approved (no input received).';
  nextCommands = [];
  console.log('⏱️  AUTO-APPROVED (timeout)');
}

const handoff = {
  taskId,
  role: 'review',
  status: reviewStatus,
  complexity: 'standard',
  domain: 'fullstack' as const,
  requiresDocs: false,
  filesTouched: [] as string[],
  nextCommands,
  summary: reviewSummary,
};

writeFileSync(`.pi/swarm/outputs/${taskId}_review_handoff.json`, JSON.stringify(handoff));

console.log('');
console.log(`SWARM_DONE:review:${taskId}`);
