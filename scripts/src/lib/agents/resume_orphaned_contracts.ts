// scripts/src/lib/agents/resume_orphaned_contracts.ts
//
// CLI for the herdr-restart resume hook. Run by the `herdr-contract-resume`
// systemd user unit after herdr.service starts, and by hand with --dry-run.
//
// Usage:
//   bun run contract:resume-orphaned [--dry-run] [--root <path>]...
//
// With no --root, defaults to the repo this file lives in. The systemd unit
// passes roots explicitly so it does not depend on a cwd.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isHerdrActive } from '../herdr/session.ts';
import { resumeOrphaned } from './contract_pipeline/resume_orphaned.ts';

/**
 * Wait for herdr to answer before touching anything.
 *
 * `After=herdr.service` only orders us after the process STARTED; herdr is a
 * Type=simple unit, so systemd considers it started the moment it forks, well
 * before the socket is listening and long before session restore has rebuilt
 * the workspaces a resume needs to attach to.
 */
const waitForHerdr = async (timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHerdrActive().catch(() => false)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');

  const roots: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) {
      roots.push(resolve(argv[i + 1] as string));
      i++;
    }
  }
  if (roots.length === 0) {
    roots.push(resolve(import.meta.dir, '../../../..'));
  }

  const known = roots.filter((r) => existsSync(r));
  for (const missing of roots.filter((r) => !known.includes(r))) {
    console.warn(`⚠️  Skipping ${missing} — no such directory.`);
  }
  if (known.length === 0) {
    console.log('No repo roots to scan.');
    return;
  }

  if (!dryRun && !(await waitForHerdr(120_000))) {
    // Refusing is the correct outcome: a resume that cannot reach herdr would
    // fail per-run, burning an auto-resume attempt on each and fencing runs
    // that were never actually broken.
    console.error('herdr server did not come up within 120s — not resuming anything.');
    process.exitCode = 1;
    return;
  }

  const resumed = await resumeOrphaned({ roots: known, dryRun });
  console.log(
    dryRun
      ? '\nDry run — nothing was launched.'
      : `\nResumed ${resumed} run${resumed === 1 ? '' : 's'}.`,
  );
};

await main();
