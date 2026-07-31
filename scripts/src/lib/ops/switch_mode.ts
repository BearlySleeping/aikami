// scripts/src/lib/ops/switch_mode.ts
// Switch Aikami environment mode (emulator → staging → production).
//
// Usage:
//   bun switch                  # defaults to emulator, reloads direnv
//   bun switch emulator
//   bun switch staging
//   bun switch production
//   bun switch --current        # show current mode
//   bun switch --list           # list all modes
//   bun switch --no-reload      # skip direnv reload after switching

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $ } from 'bun';

// ── Types ─────────────────────────────────────────────────────────────

const VALID_MODES = ['emulator', 'staging', 'production'] as const;
type Mode = (typeof VALID_MODES)[number];

const MODE_PROJECTS: Record<Mode, string> = {
  emulator: 'demo-aikami-emulator',
  staging: 'aikami-staging',
  production: 'aikami-production',
};

const MODE_COLORS: Record<Mode, string> = {
  emulator: '\x1b[35m', // magenta
  staging: '\x1b[33m', // yellow
  production: '\x1b[31m', // red
};
const RESET = '\x1b[0m';

// ── Helpers ───────────────────────────────────────────────────────────

function getProjectRoot(): string {
  // Walk up from scripts/src/lib/ops/ to repo root
  let dir = import.meta.dir;
  while (!existsSync(join(dir, '.git')) && dir !== '/') {
    dir = join(dir, '..');
  }
  return dir;
}

function getEnvLocal(root: string): string {
  return join(root, '.env.local');
}

function readCurrentMode(root: string): Mode | null {
  const file = getEnvLocal(root);
  if (!existsSync(file)) {
    return null;
  }
  const content = readFileSync(file, 'utf-8');
  const match = content.match(/^AIKAMI_MODE=(.+)$/m);
  if (!match) {
    return null;
  }
  const mode = match[1].trim();
  return VALID_MODES.includes(mode as Mode) ? (mode as Mode) : null;
}

function writeMode(root: string, mode: Mode): void {
  writeFileSync(getEnvLocal(root), `AIKAMI_MODE=${mode}\n`);
}

async function reloadDirenv(root: string): Promise<boolean> {
  try {
    const result = await $`direnv reload`.cwd(root).nothrow().quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function showBanner(mode: Mode): string {
  const color = MODE_COLORS[mode];
  const project = MODE_PROJECTS[mode];
  const pad = 28;

  return `
  ╔══════════════════════════════════════════╗
  ║          🎴 Aikami Mode Switch           ║
  ╠══════════════════════════════════════════╣
  ║  Current: ${color}${mode.padEnd(pad)}${RESET}║
  ║  Project: ${project.padEnd(pad)}║
  ╚══════════════════════════════════════════╝`;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const root = getProjectRoot();
  const args = Bun.argv.slice(2);

  // --list flag
  if (args.includes('--list')) {
    for (const mode of VALID_MODES) {
      const color = MODE_COLORS[mode];
      const project = MODE_PROJECTS[mode];
      const current = process.env.AIKAMI_MODE;
      const marker = mode === current ? ' ◀ current' : '';
      console.log(`  ${color}${mode}${RESET} → ${project}${marker}`);
    }
    return;
  }

  // --current flag
  if (args.includes('--current')) {
    const current = readCurrentMode(root);
    if (current) {
      console.log(showBanner(current));
    } else {
      console.log('  ⚠️  No mode found in .env.local');
      console.log(`  Current env AIKAMI_MODE: ${process.env.AIKAMI_MODE ?? 'not set'}`);
    }
    return;
  }

  // Resolve target mode (first non-flag arg, defaults to emulator)
  const targetArg = args.filter((a) => !a.startsWith('--'))[0];
  const target: Mode = (() => {
    if (!targetArg) {
      return 'emulator';
    }
    if (VALID_MODES.includes(targetArg as Mode)) {
      return targetArg as Mode;
    }
    console.error(`❌ Invalid mode: "${targetArg}"`);
    console.error(`   Valid modes: ${VALID_MODES.join(', ')}`);
    process.exit(1);
  })();

  const current = readCurrentMode(root);

  if (current === target) {
    console.log(`  🎴 Already in ${target} mode.`);
    return;
  }

  const noReload = args.includes('--no-reload');

  writeMode(root, target);

  console.log(showBanner(target));

  if (current) {
    const prevColor = MODE_COLORS[current];
    console.log(
      `  Switched from ${prevColor}${current}${RESET} → ${MODE_COLORS[target]}${target}${RESET}`,
    );
  }

  if (noReload) {
    console.log('');
    console.log('  To apply, run one of:');
    console.log('    direnv reload');
    console.log('    cd .. && cd -');
    console.log('');
  } else {
    console.log('');
    console.log('  🔄 Reloading direnv...');
    console.log('');
    const ok = await reloadDirenv(root);
    if (!ok) {
      console.log('  ⚠️  direnv reload failed — run manually: direnv reload');
      console.log('');
    }
  }
}

main();
