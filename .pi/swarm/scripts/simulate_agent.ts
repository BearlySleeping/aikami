// Simulated swarm agent — shows visible progress steps then writes handoff + SWARM_DONE
const role = process.argv[2];
const taskId = process.argv[3];

if (!role || !taskId) {
  console.error('Usage: simulate_agent.ts <role> <taskId>');
  process.exit(1);
}

const steps: Record<string, string[]> = {
  architect: [
    'Analyzing contract...',
    'Resolving dependencies...',
    'Mapping files to create/modify...',
    'Writing implementation plan...',
    'Classifying complexity...',
    'Writing handoff JSON...',
  ],
  coder: [
    'Reading architect plan...',
    'Loading domain skills (fullstack)...',
    'Implementing code...',
    'Writing unit tests...',
    'Running fix+typecheck...',
    'Writing handoff JSON...',
  ],
  qa: [
    'Reading upstream handoffs...',
    'Running unit tests...',
    'Running typecheck...',
    'Verifying outputs...',
    'Writing handoff JSON...',
  ],
  git: [
    'Reading all upstream handoffs...',
    'Running git status...',
    'Staging changed files...',
    'Creating conventional commit...',
    'Writing handoff JSON...',
  ],
};

const handoffs: Record<string, Record<string, unknown>> = {
  architect: {
    taskId,
    role: 'architect',
    status: 'success',
    complexity: 'standard',
    domain: 'fullstack',
    requiresDocs: false,
    filesTouched: ['plan.md', 'src/app.ts'],
    nextCommands: ['moon run :fix', 'moon run :typecheck', 'moon run :test'],
    summary:
      'Architect plan: create utility module with tests. Standard complexity, fullstack domain.',
  },
  coder: {
    taskId,
    role: 'coder',
    status: 'success',
    complexity: 'standard',
    domain: 'fullstack',
    requiresDocs: false,
    filesTouched: ['src/utils.ts', 'src/utils.test.ts'],
    nextCommands: ['moon run :test'],
    summary: 'Implemented utility module with full test coverage. Fix+typecheck pass.',
  },
  qa: {
    taskId,
    role: 'qa',
    status: 'success',
    complexity: 'standard',
    domain: 'fullstack',
    requiresDocs: false,
    filesTouched: [],
    nextCommands: [],
    summary: 'All tests pass: 12/12 unit, 0 type errors. Ready for commit.',
  },
  git: {
    taskId,
    role: 'git',
    status: 'success',
    complexity: 'standard',
    domain: 'fullstack',
    requiresDocs: false,
    filesTouched: ['src/utils.ts', 'src/utils.test.ts'],
    nextCommands: [],
    summary: 'Commit: feat(utils): add utility module with tests',
  },
};

const agentSteps = steps[role] ?? ['Working...'];
const handoff = handoffs[role] ?? {
  taskId,
  role,
  status: 'success',
  complexity: 'standard',
  domain: 'fullstack',
  requiresDocs: false,
  filesTouched: [],
  nextCommands: [],
  summary: 'Done',
};

console.log(`\n🤖 SWARM AGENT: ${role.toUpperCase()}`);
console.log(`   Task: ${taskId}`);
console.log('');

for (const step of agentSteps) {
  console.log(`  ⏳ ${step}`);
  await new Promise((r) => setTimeout(r, 800));
}

const { mkdirSync, writeFileSync } = await import('node:fs');
mkdirSync('.pi/swarm/outputs', { recursive: true });
writeFileSync(`.pi/swarm/outputs/${taskId}_${role}_handoff.json`, JSON.stringify(handoff));

console.log('');
console.log('  ✅ Complete');
console.log('');

await new Promise((r) => setTimeout(r, 500));
console.log(`SWARM_DONE:${role}:${taskId}`);
