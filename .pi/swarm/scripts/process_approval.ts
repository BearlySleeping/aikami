#!/usr/bin/env bun
// .pi/swarm/scripts/process_approval.ts
/**
 * Process user approval input and write routing decision.
 *
 * Usage: bun run .pi/swarm/scripts/process_approval.ts <taskId> <userInput>
 */

const taskId = process.argv[2];
const input = (process.argv[3] ?? '').toLowerCase().trim();

const { mkdirSync, writeFileSync } = await import('node:fs');

let status: string;
let summary: string;
let nextCommands: string[];

if (input === 'approve' || input === 'yes' || input === 'y') {
  status = 'approved';
  summary = 'User approved. Proceed to commit.';
  nextCommands = ['run:git'];
  console.log('✅ APPROVED — proceeding to git commit');
} else if (input === 'reject' || input === 'no' || input === 'n') {
  status = 'rejected';
  summary = 'User rejected. Pipeline stopped.';
  nextCommands = [];
  console.log('❌ REJECTED — pipeline stopped');
} else if (input.startsWith('/qa')) {
  status = 'feedback';
  summary = `User: ${input}`;
  nextCommands = ['route:qa'];
  console.log('🔄 ROUTING TO QA');
} else if (input.startsWith('/dev')) {
  status = 'feedback';
  summary = `User requested dev sandbox: ${input}`;
  nextCommands = ['route:sandbox'];
  console.log('🔄 ROUTING TO DEV SANDBOX');
} else if (input.length > 0) {
  status = 'feedback';
  summary = `User feedback: ${input}`;
  nextCommands = ['route:coder'];
  console.log('🔄 ROUTING TO CODER with feedback');
} else {
  status = 'approved';
  summary = 'Auto-approved (empty input).';
  nextCommands = ['run:git'];
  console.log('⏱️  AUTO-APPROVED');
}

mkdirSync('.pi/swarm/outputs', { recursive: true });
writeFileSync(
  `.pi/swarm/outputs/${taskId}_review_handoff.json`,
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

console.log(`SWARM_DONE:approval:${taskId}`);
