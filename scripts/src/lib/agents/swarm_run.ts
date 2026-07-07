// scripts/src/lib/agents/swarm_run.ts
/**
 * Swarm pipeline runner — one command to dispatch a contract through the swarm.
 *
 * Usage:
 *   bun swarm:run C-233
 *   bun swarm:run C-233 --tier pro
 *   bun swarm:run C-233 --no-review   (skip review step)
 *   bun swarm:run C-233 --fresh        (delete stale handoffs)
 *   bun swarm:run C-233 --join         (attach to herdr to watch)
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Model (mirrors .pi/swarm/models.ts) ────────────────────

const SWARM_MODELS = {
  default: 'flash',
  models: {
    pro: { model: 'deepseek/deepseek-v4-pro' },
    flash: { model: 'deepseek/deepseek-v4-flash' },
    'openrouter-free': { model: 'openrouter/free' },
    'opencode-free': { model: 'opencode/big-pickle' },
  },
} as const;

const getModelForTier = (tier: string): string => {
  const m = SWARM_MODELS.models as Record<string, { model: string }>;
  return m[tier]?.model ?? m.flash.model;
};

const getDefaultTier = (): string => SWARM_MODELS.default;

// ── Parse args ──────────────────────────────────────────────

const args = process.argv.slice(2);
const contractId = args.find((a) => /^C-\d+$/i.test(a));
const tier = args.includes('--tier')
  ? (args[args.indexOf('--tier') + 1] ?? getDefaultTier())
  : getDefaultTier();
const skipReview = args.includes('--no-review');
const fresh = args.includes('--fresh');
const doJoin = args.includes('--join') || args.includes('-j');

if (!contractId) {
  console.error('Usage: bun swarm:run <contract-id> [options]');
  console.error('');
  console.error('  contract-id    e.g. C-233, C-311');
  console.error('  --tier <tier>  pro | flash (default: flash)');
  console.error('  --no-review    skip the review approval step');
  console.error('  --fresh        delete stale handoffs for a fresh re-run');
  console.error('  --join         attach to herdr session to watch');
  console.error('');
  console.error('Examples:');
  console.error('  bun swarm:run C-233');
  console.error('  bun swarm:run C-233 --tier pro --join');
  console.error('  bun swarm:run C-233 --fresh --no-review');
  process.exit(1);
}

// ── Find contract file ─────────────────────────────────────

const contractsDir = join(process.cwd(), 'docs', 'contracts');
const files = readdirSync(contractsDir);
const contractFile = files.find((f) => f.startsWith(contractId) && f.endsWith('.md'));

if (!contractFile) {
  console.error(`❌ Contract not found: ${contractId}`);
  console.error(`   Looked in: ${contractsDir}`);
  const available = files.filter((f) => f.startsWith('C-')).join(', ');
  console.error(`   Available: ${available}`);
  process.exit(1);
}

const contractPath = join(contractsDir, contractFile);
console.log(`📄 Contract: ${contractPath}`);

// ── Model (mirrors .pi/swarm/models.ts) ────────────────────

const model = getModelForTier(tier);
console.log(`🤖 Model: ${model} (${tier})`);

// ── Clean stale handoffs if --fresh ────────────────────────

const outputsDir = join(process.cwd(), '.pi', 'swarm', 'outputs');
mkdirSync(outputsDir, { recursive: true });

if (fresh) {
  for (const f of readdirSync(outputsDir)) {
    if (f.startsWith(contractId)) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(join(outputsDir, f));
      console.log(`  🧹 Cleaned: ${f}`);
    }
  }
}

// ── Generate payload ───────────────────────────────────────

const architectPlanPath = `.pi/swarm/plans/architect_plan_${contractId}.md`;

const steps: Array<{
  stepIndex: number;
  agent: string;
  command: string;
  complianceSignature: string;
}> = [
  {
    stepIndex: 0,
    agent: 'architect',
    command: `pi --model ${model} --system-prompt .pi/prompts/architect.md '${contractPath}'`,
    complianceSignature: `SWARM_DONE:architect:${contractId}`,
  },
  {
    stepIndex: 1,
    agent: 'coder',
    command: `pi --model ${model} --system-prompt .pi/prompts/coder.md '${architectPlanPath}'`,
    complianceSignature: `SWARM_DONE:coder:${contractId}`,
  },
  {
    stepIndex: 2,
    agent: 'qa',
    command: `pi --model ${model} --system-prompt .pi/prompts/qa.md '${architectPlanPath}'`,
    complianceSignature: `SWARM_DONE:qa:${contractId}`,
  },
];

if (!skipReview) {
  steps.push({
    stepIndex: 3,
    agent: 'review',
    command: `bun run .pi/swarm/scripts/review_gate.ts ${contractId} && echo -n "> " && read input && bun run .pi/swarm/scripts/process_approval.ts ${contractId} "$input"`,
    complianceSignature: `SWARM_DONE:approval:${contractId}`,
  });
}

steps.push({
  stepIndex: skipReview ? 3 : 4,
  agent: 'git',
  command: `pi --model ${model} --system-prompt .pi/prompts/git.md '${architectPlanPath}'`,
  complianceSignature: `SWARM_DONE:git:${contractId}`,
});

const payload = {
  taskId: contractId,
  description: `Contract: ${contractFile}`,
  tier,
  steps,
};

const payloadDir = join(process.cwd(), '.pi', 'swarm', 'payloads');
mkdirSync(payloadDir, { recursive: true });
const payloadPath = join(payloadDir, `payload_${contractId}.json`);
writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

console.log(`📦 Payload: ${payloadPath}`);
console.log(`   Steps: ${steps.map((s) => s.agent).join(' → ')}`);
console.log('');

// ── Ensure herdr is running ────────────────────────────────

const checkHerdr = (): boolean => {
  try {
    const result = execSync('herdr status server 2>&1', { encoding: 'utf-8' });
    return result.includes('running');
  } catch {
    return false;
  }
};

// ── Main ────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  if (!checkHerdr()) {
    console.log('🔄 Starting herdr daemon...');
    execSync('herdr server &>/dev/null &', { stdio: 'ignore' });
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (checkHerdr()) {
        break;
      }
    }
    if (!checkHerdr()) {
      console.error('❌ Herdr daemon failed to start');
      process.exit(1);
    }
    console.log('✅ Herdr running');
  }

  // ── Run pipeline ─────────────────────────────────────────

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║         SWARM PIPELINE STARTING          ║');
  console.log(`║  Task: ${contractId.padEnd(34)}║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  const startScript = join(process.cwd(), 'scripts', 'src', 'lib', 'agents', 'swarm_start.ts');
  const cmd = `bun run ${startScript} ${payloadPath} --socket`;

  try {
    if (doJoin) {
      // Run pipeline in background, then attach to herdr
      console.log('  Pipeline running in background — attaching to herdr...');
      console.log('');
      execSync(`${cmd} &`, { stdio: 'ignore' });
      await new Promise((r) => setTimeout(r, 2000));
      execSync('herdr session attach default', { stdio: 'inherit' });
    } else {
      console.log('  Open herdr to watch: herdr session attach default');
      console.log('');
      execSync(cmd, {
        encoding: 'utf-8',
        stdio: 'inherit',
        timeout: 600_000,
      });
    }
  } catch (error) {
    const e = error as { status?: number };
    if (doJoin) {
      return; // User detached from herdr
    }
    if (e.status === null) {
      console.log('\n⏱️  Pipeline timed out or was interrupted');
    } else {
      console.error(`\n❌ Pipeline failed (exit code: ${e.status})`);
    }
    process.exit(e.status ?? 1);
  }

  if (doJoin) {
    return; // Don't show completion when in join mode
  }

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║         PIPELINE COMPLETE                ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Outputs: .pi/swarm/outputs/${contractId}_*`);
  console.log(`║  Metrics: .pi/swarm/outputs/${contractId}_metrics.json`);
  console.log('╚══════════════════════════════════════════╝');
};

main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exit(1);
});
