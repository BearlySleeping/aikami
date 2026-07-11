// scripts/src/lib/agents/swarm_run.ts
/**
 * Swarm pipeline runner — one command to dispatch a contract through the swarm.
 *
 * Usage:
 *   bun swarm:run C-233
 *   bun swarm:run C-233 --tier pro
 *   bun swarm:run C-233 --no-review   (skip review step)
 *   bun swarm:run C-233 --fresh        (discard previous progress, start over)
 *   bun swarm:run C-233 --join         (attach to herdr to watch)
 *
 * Resume-by-default: if handoffs from a previous (crashed/interrupted) run
 * exist on disk, the pipeline resumes from the first incomplete role.
 * Use --fresh to discard progress and start from the architect.
 *
 * The payload is a flat config blob — the state machine in step_executor.ts
 * owns all command construction and model selection.
 */

import { execSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

// ── Parse args ──────────────────────────────────────────────

const args = process.argv.slice(2);
const contractId = args.find((a) => /^C-\d+$/i.test(a));
const tier = args.includes('--tier') ? (args[args.indexOf('--tier') + 1] ?? '') : '';
const skipReview = args.includes('--no-review');
const fresh = args.includes('--fresh') || args.includes('--force') || args.includes('--clean');
const doJoin = args.includes('--join') || args.includes('-j');

if (!contractId) {
  console.error('Usage: bun swarm:run <contract-id> [options]');
  console.error('       bun run contract <contract-id> [options]  (alias)');
  console.error('');
  console.error('  contract-id    e.g. C-233, C-311');
  console.error('  --tier <tier>  pro | flash (default: per-role matrix in .pi/swarm/models.ts)');
  console.error('  --no-review    skip the review approval step (auto-approve git)');
  console.error('  --fresh        discard previous progress, start over (alias: --force, --clean)');
  console.error('  --join         attach to herdr session to watch');
  console.error('');
  console.error('Default behavior: resumes from existing handoffs if a previous run');
  console.error('was interrupted (e.g. continues at coder if the architect finished).');
  process.exit(1);
}

// ── Find contract file ─────────────────────────────────────

const contractsDir = join(process.cwd(), 'docs', 'contracts');
const files = readdirSync(contractsDir);
const contractFile = files.find((f) => f.startsWith(contractId) && f.endsWith('.md'));

if (!contractFile) {
  console.error(`❌ Contract not found: ${contractId}`);
  console.error(`   Looked in: ${contractsDir}`);
  console.error('');
  console.error('   Generate it first via Pi:');
  console.error(`   > contract_generate ${contractId}`);
  console.error('   > /contract-create');
  console.error('');
  const available = files
    .filter((f) => f.startsWith('C-'))
    .slice(0, 10)
    .join(', ');
  console.error(`   Available (first 10): ${available}`);
  process.exit(1);
}

const contractPath = resolve(contractsDir, contractFile);
console.log(`📄 Contract: ${contractPath}`);
console.log(`🤖 Tier: ${tier}`);
console.log(`🔍 Review: ${skipReview ? 'skipped (auto-approve)' : 'enabled'}`);

// ── Clean stale handoffs if --fresh ────────────────────────

const outputsDir = join(process.cwd(), '.pi', 'swarm', 'outputs');
mkdirSync(outputsDir, { recursive: true });

const payloadDir = join(process.cwd(), '.pi', 'swarm', 'payloads');
mkdirSync(payloadDir, { recursive: true });

if (fresh) {
  const { unlinkSync, existsSync } = await import('node:fs');
  // Outputs: handoffs, feedback files, qa failures, pipeline log
  for (const f of readdirSync(outputsDir)) {
    if (f.startsWith(contractId)) {
      unlinkSync(join(outputsDir, f));
      console.log(`  🧹 Cleaned: ${f}`);
    }
  }
  // Plan file — resume detection treats plan+handoff as architect completion
  const planFile = join(process.cwd(), '.pi', 'swarm', 'plans', `architect_plan_${contractId}.md`);
  if (existsSync(planFile)) {
    unlinkSync(planFile);
    console.log(`  🧹 Cleaned: architect_plan_${contractId}.md`);
  }
} else {
  // Resume preview — tell the user what will be reused
  const { existsSync } = await import('node:fs');
  const existingRoles = ['architect', 'coder', 'qa', 'review', 'git'].filter((role) =>
    existsSync(join(outputsDir, `${contractId}_${role}_handoff.json`)),
  );
  if (existingRoles.length > 0) {
    console.log(`♻️  Resume: found handoffs for [${existingRoles.join(', ')}]`);
    console.log('   Pipeline will continue from the first incomplete role.');
    console.log('   Use --fresh to discard progress and start over.');
  }
}

// ── Generate payload (flat config — state machine owns commands) ──

const payload = {
  taskId: contractId,
  description: `Contract: ${contractFile}`,
  contractPath,
  tier,
  skipReview,
  resume: !fresh,
};

const payloadPath = join(payloadDir, `payload_${contractId}.json`);
writeFileSync(payloadPath, JSON.stringify(payload, null, 2));

console.log(`📦 Payload: ${payloadPath}`);
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

// ── Concurrent-run guard ───────────────────────────────────

const directorLockPath = join(outputsDir, `${contractId}_director.lock`);

const checkDirectorLock = (): boolean => {
  if (!existsSync(directorLockPath)) {
    return false;
  }
  let pid: number | null = null;
  try {
    pid = Number(readFileSync(directorLockPath, 'utf-8').trim());
  } catch {
    // corrupted lock — treat as dead
    return false;
  }

  if (!pid || Number.isNaN(pid)) {
    return false;
  }

  // Check if PID is alive
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    // PID not alive — stale lock
    return false;
  }
};

// Handle --fresh: also clear stale lock
if (fresh) {
  try {
    unlinkSync(directorLockPath);
    console.log('  🧹 Cleaned: director lock');
  } catch {
    /* didn't exist */
  }
}

if (checkDirectorLock()) {
  const pid = readFileSync(directorLockPath, 'utf-8').trim();
  console.error(`❌ Director already running for ${contractId} (PID ${pid}).`);
  console.error('   Attach with: herdr session attach default');
  console.error(`   Force restart: bun swarm:run ${contractId} --fresh`);
  process.exit(1);
}

// Write lock with current PID
writeFileSync(directorLockPath, String(process.pid));

// Remove lock on exit
const removeLock = (): void => {
  try {
    unlinkSync(directorLockPath);
  } catch {
    /* already gone */
  }
};

process.on('exit', removeLock);
process.on('SIGINT', () => {
  removeLock();
  process.exit(130);
});
process.on('SIGTERM', () => {
  removeLock();
  process.exit(143);
});

// ── Main ────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  if (!checkHerdr()) {
    console.log('🔄 Starting herdr daemon...');
    console.log('   (If this hangs, Herdr is not installed or not on PATH)');
    console.log('   Install: bun run herdr:start');
    console.log('');
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

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║         SWARM PIPELINE STARTING          ║');
  console.log(`║  Task: ${contractId.padEnd(34)}║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  const startScript = resolve(process.cwd(), 'scripts', 'src', 'lib', 'agents', 'swarm_start.ts');
  const cmd = `bun run ${startScript} ${payloadPath}`;

  try {
    if (doJoin) {
      // Spawn the pipeline in its OWN process group (detached) so Ctrl+C in
      // this terminal (e.g. detaching from herdr attach) cannot kill it.
      // Previous version used execSync(`cmd &`) — non-interactive sh has no
      // job control, so the pipeline shared our process group and died on
      // the first SIGINT, silently (stdio was ignored).
      const logPath = join(outputsDir, `${contractId}_pipeline.log`);
      const logFd = openSync(logPath, 'a');
      const child = spawn('bun', ['run', startScript, payloadPath], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });
      child.unref();

      console.log(`  Pipeline running detached — PID ${child.pid}`);
      console.log(`  Log: ${logPath}`);
      console.log('  Attaching to herdr (Ctrl+C here will NOT kill the pipeline)...\n');

      await new Promise((r) => setTimeout(r, 2000));
      execSync('herdr session attach default', { stdio: 'inherit' });
    } else {
      console.log('  Open herdr to watch: herdr session attach default\n');
      // Use tee to write output to both terminal and the pipeline log (so the
      // pipeline tab's tail -f shows progress).
      const logPath = join(outputsDir, `${contractId}_pipeline.log`);
      const teeCmd = `${cmd} 2>&1 | tee '${logPath}'`;
      execSync(teeCmd, {
        encoding: 'utf-8',
        stdio: 'inherit',
        timeout: 3_600_000,
      });
    }
  } catch (error) {
    const e = error as { status?: number };
    if (doJoin) {
      return;
    }
    if (e.status === null) {
      console.log('\n⏱️  Pipeline timed out or was interrupted');
    } else {
      console.error(`\n❌ Pipeline failed (exit code: ${e.status})`);
    }
    process.exit(e.status ?? 1);
  }

  if (doJoin) {
    return;
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
