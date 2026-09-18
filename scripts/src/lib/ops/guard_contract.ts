// scripts/src/lib/ops/guard_contract.ts
//
// The sanctioned contraction step.
//
// A ratchet is supposed to make bad changes expensive and good changes easy.
// Without this, the opposite happened: a formatter removing one line made CI red
// because the baseline still said 1161 and the file was now 1160. That protects
// headroom, but it turns every legitimate improvement into manual baseline
// bookkeeping — which is exactly the chore that teaches an agent to reach for
// "just update the baseline".
//
// So reductions are synchronized automatically, in ONE place, as part of the
// pipeline's fix/validate flow rather than as a command each agent is told to
// run. Reductions only:
//
//   • `--update-baseline` on every ratcheted guard refuses any expansion, so
//     this step cannot launder new debt even if it is invoked on a broken tree;
//   • a guard that cannot contract (because it has real growth to fix) is
//     reported and skipped — `:validate` will surface the actual failure with
//     its own diagnostics;
//   • the resulting diff is an ordinary working-tree change: visible in
//     `git diff` and committed like anything else.
//
// 🔴 There is deliberately no `--expand` counterpart. Expansion is a policy
// change and goes through human review.
//
// Usage:
//   bun run src/lib/ops/guard_contract.ts
//
// Exits 0 unless the registry itself is unreadable. A guard that refuses to
// contract is reported, not fatal — see above.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ratchetedGuards } from './guards/registry.ts';

const ROOT = resolve(import.meta.dir, '../../../..');

/**
 * Matches an ANSI SGR sequence. Built from `String.fromCharCode(27)` rather than
 * a literal escape so the source contains no control character.
 */
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

type Outcome = { id: string; contracted: boolean; summary: string };

const contractOne = (guard: { id: string; script: string }): Outcome => {
  const scriptPath = resolve(ROOT, guard.script);
  if (!existsSync(scriptPath)) {
    return { id: guard.id, contracted: false, summary: `guard script missing: ${guard.script}` };
  }
  try {
    const stdout = execFileSync('bun', ['run', scriptPath, '--update-baseline'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    const summary =
      stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('✅'))
        .pop() ?? 'contracted';
    return { id: guard.id, contracted: true, summary };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const firstLine =
      stderr
        .split('\n')
        .map((line) => line.replace(ANSI_SGR, '').trim())
        .filter((line) => line.startsWith('🔴'))
        .pop() ?? 'refused to contract';
    return { id: guard.id, contracted: false, summary: firstLine };
  }
};

const main = (): void => {
  const guards = ratchetedGuards();
  if (guards.length === 0) {
    console.log('✅ guard contraction: no ratcheted guards registered');
    return;
  }

  console.log(`🔧 guard contraction — synchronizing reductions across ${guards.length} ratchet(s)`);
  const outcomes = guards.map((guard) => contractOne({ id: guard.id, script: guard.script }));

  for (const outcome of outcomes) {
    console.log(`   ${outcome.contracted ? '✅' : '⏭️ '} ${outcome.id}: ${outcome.summary}`);
  }

  const skipped = outcomes.filter((outcome) => !outcome.contracted);
  if (skipped.length > 0) {
    console.log(
      `\n   ${skipped.length} ratchet(s) could not contract — that means recorded debt grew or the guard is red.`,
    );
    console.log(
      '   `moon run :validate` reports the actual violation; contraction never expands a baseline.',
    );
  }
  console.log(
    '\n✅ guard contraction complete — reductions only. Review `git diff` and commit the result.',
  );
};

if (import.meta.main) {
  main();
}
