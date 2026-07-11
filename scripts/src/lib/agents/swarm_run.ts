// scripts/src/lib/agents/swarm_run.ts
/**
 * Swarm pipeline runner — one command to dispatch a contract through the swarm.
 *
 * Usage:
 *   bun swarm:run C-233
 *   bun run contract C-233            (alias)
 *   bun swarm:run C-233 --tier pro
 *   bun swarm:run C-233 --no-review   (skip review step)
 *   bun swarm:run C-233 --fresh        (discard previous progress, start over)
 *   bun swarm:run C-233 --join         (attach to herdr to watch)
 *
 * If the contract file does not exist, it is auto-generated from docs/TODO.md
 * using docs/contracts/TEMPLATE.md. No separate generation step needed.
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
  console.error('If the contract file does not exist, it is auto-generated from docs/TODO.md.');
  console.error('Resumes from existing handoffs unless --fresh is passed.');
  process.exit(1);
}

// ── Find or generate contract file ─────────────────────────

const contractsDir = join(process.cwd(), 'docs', 'contracts');
const files = readdirSync(contractsDir);
let contractFile = files.find((f) => f.startsWith(contractId) && f.endsWith('.md'));

if (!contractFile) {
  console.log(`📝 Contract ${contractId} not found — generating from docs/TODO.md...`);
  contractFile = _generateContract(contractId, contractsDir);
  console.log(`✅ Generated: docs/contracts/${contractFile}\n`);
}

const contractPath = resolve(contractsDir, contractFile);
console.log(`📄 Contract: ${contractPath}`);
console.log(`🤖 Tier: ${tier || 'default (per-role matrix)'}`);
console.log(`🔍 Review: ${skipReview ? 'skipped (auto-approve)' : 'enabled'}`);

// ── Contract auto-generation (inlined — no external deps) ──

function _generateContract(id: string, contractsDir: string): string {
  const cwd = process.cwd();
  const todoPath = join(cwd, 'docs/TODO.md');
  const templatePath = join(cwd, 'docs/contracts/TEMPLATE.md');

  if (!existsSync(todoPath)) {
    console.error('❌ docs/TODO.md not found — cannot auto-generate.');
    process.exit(1);
  }
  if (!existsSync(templatePath)) {
    console.error('❌ docs/contracts/TEMPLATE.md not found.');
    process.exit(1);
  }

  const todoContent = readFileSync(todoPath, 'utf-8');

  // Find the item by heading: ### C-312 — Title
  const headingRe = new RegExp(
    `###\\s+${id}\\s+[–—\\-]\\s+(.+)\\n([\\s\\S]*?)(?=\\n###\\s+(?:C-|MIG-)|$)`,
    'm',
  );
  const itemMatch = todoContent.match(headingRe);

  if (!itemMatch) {
    console.error(`❌ ${id} not found in docs/TODO.md.`);
    console.error('   Run contract_scan_backlog in Pi to see available IDs.');
    process.exit(1);
  }

  const title = (itemMatch[1] ?? '').trim();
  const body = itemMatch[2] ?? '';

  // Extract fields from bullet lines: - **Field:** value
  const rawFields: Record<string, string> = {};
  const fieldRe = /^-\s+\*\*(.+?):\*\*\s+(.+)/gm;
  let fm: RegExpExecArray | null;
  while (true) {
    fm = fieldRe.exec(body);
    if (fm === null) {
      break;
    }
    rawFields[(fm[1] ?? '').trim()] = (fm[2] ?? '').trim();
  }
  const getField = (name: string): string => rawFields[name] ?? '';
  const firstLine = (text: string): string => (text ?? '').split('\n')[0]?.trim() ?? '';

  let template = readFileSync(templatePath, 'utf-8');

  // Step 1: Substitute heading placeholders only
  template = template.replace(/\{FEATURE_CODE\}/g, id).replace(/\{TITLE\}/g, title);

  // Step 2: Rewrite metadata table rows (replaces entire row including display hints)
  const replaceRow = (label: string, value: string): void => {
    template = template.replace(
      new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|[^\\n]*\\|`),
      `| **${label}** | ${value} |`,
    );
  };

  replaceRow('Source', `TODO.md — ${id}`);
  replaceRow('Target', `${firstLine(getField('Target')) || 'TBD'} — TBD`);
  replaceRow('Priority', getField('Priority') || 'P2');
  replaceRow('Dependencies', getField('Dependencies') || '—');
  replaceRow('Status', 'draft');
  replaceRow('Contract version', '2.0.0');
  replaceRow('Docs Impact', 'TBD');

  // Step 3: Fill Overview
  template = template.replace(
    /\{2-4 sentences describing what this task is[^}]*\}/,
    firstLine(getField('Outcome')) || title,
  );

  // Step 4: Fill Problem baseline
  template = template.replace(
    /\{what is broken or missing today[^}]*\}/,
    `${title} — see docs/TODO.md for details.`,
  );

  // Build slug: "Restore Planning, Promotion..." → "restore-planning-promotion..."
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');

  const fileName = `${id}-${slug}.md`;
  writeFileSync(join(contractsDir, fileName), template);
  return fileName;
}

// ── Clean stale handoffs if --fresh ────────────────────────

const outputsDir = join(process.cwd(), '.pi', 'swarm', 'outputs');
mkdirSync(outputsDir, { recursive: true });

const payloadDir = join(process.cwd(), '.pi', 'swarm', 'payloads');
mkdirSync(payloadDir, { recursive: true });

if (fresh) {
  const { unlinkSync: ul, existsSync: ex } = await import('node:fs');
  for (const f of readdirSync(outputsDir)) {
    if (f.startsWith(contractId)) {
      ul(join(outputsDir, f));
      console.log(`  🧹 Cleaned: ${f}`);
    }
  }
  const planFile = join(process.cwd(), '.pi', 'swarm', 'plans', `architect_plan_${contractId}.md`);
  if (ex(planFile)) {
    ul(planFile);
    console.log(`  🧹 Cleaned: architect_plan_${contractId}.md`);
  }
} else {
  const { existsSync: ex } = await import('node:fs');
  const existingRoles = ['architect', 'coder', 'qa', 'review', 'git'].filter((role) =>
    ex(join(outputsDir, `${contractId}_${role}_handoff.json`)),
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
    return false;
  }

  if (!pid || Number.isNaN(pid)) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

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

writeFileSync(directorLockPath, String(process.pid));

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
