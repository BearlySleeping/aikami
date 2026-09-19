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

/**
 * Runs one guard's contraction and reports what happened.
 *
 * Injectable so the refusal path can be tested as BEHAVIOUR rather than by
 * asserting that the source text happens to contain a `catch`. A test that
 * greps for `'refused to contract'` proves nothing about whether an
 * `execFileSync` failure is caught, reported, and allowed to exit 0 — which is
 * the whole contract of this step.
 */
export type GuardExec = (options: {
  scriptPath: string;
  root: string;
}) => { ok: true; stdout: string } | { ok: false; stderr: string };

const defaultExec: GuardExec = ({ scriptPath, root }) => {
  try {
    return {
      ok: true,
      stdout: execFileSync('bun', ['run', scriptPath, '--update-baseline'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
      }),
    };
  } catch (error) {
    return { ok: false, stderr: (error as { stderr?: string }).stderr ?? '' };
  }
};

/** The last line of `output` that starts with `prefix`, with ANSI codes stripped. */
const lastLineStartingWith = (output: string, prefix: string): string | undefined =>
  output
    .split('\n')
    .map((line) => line.replace(ANSI_SGR, '').trim())
    .filter((line) => line.startsWith(prefix))
    .pop();

/**
 * Contracts one ratcheted guard.
 *
 * 🔴 Every outcome is a value, never a throw: a guard that refuses (because
 * recorded debt grew) or that cannot be spawned must be REPORTED and skipped,
 * because `:validate` — not this step — is the verdict.
 */
export const contractOne = (
  options: { id: string; script: string },
  exec: GuardExec = defaultExec,
  root: string = ROOT,
): Outcome => {
  const scriptPath = resolve(root, options.script);
  if (!existsSync(scriptPath)) {
    return {
      id: options.id,
      contracted: false,
      summary: `guard script missing: ${options.script}`,
    };
  }

  const result = exec({ scriptPath, root });
  if (result.ok) {
    return {
      id: options.id,
      contracted: true,
      summary: lastLineStartingWith(result.stdout, '✅') ?? 'contracted',
    };
  }
  return {
    id: options.id,
    contracted: false,
    summary: lastLineStartingWith(result.stderr, '🔴') ?? 'refused to contract',
  };
};

/** Runs every registered ratchet's reduction-only contraction. */
export const runContraction = (
  exec: GuardExec = defaultExec,
  root: string = ROOT,
): { outcomes: Outcome[]; skipped: number } => {
  const guards = ratchetedGuards();
  const outcomes = guards.map((guard) =>
    contractOne({ id: guard.id, script: guard.script }, exec, root),
  );
  return { outcomes, skipped: outcomes.filter((outcome) => !outcome.contracted).length };
};

const main = (): void => {
  const guards = ratchetedGuards();
  if (guards.length === 0) {
    console.log('✅ guard contraction: no ratcheted guards registered');
    return;
  }

  console.log(`🔧 guard contraction — synchronizing reductions across ${guards.length} ratchet(s)`);
  const { outcomes, skipped } = runContraction();

  for (const outcome of outcomes) {
    console.log(`   ${outcome.contracted ? '✅' : '⏭️ '} ${outcome.id}: ${outcome.summary}`);
  }

  if (skipped > 0) {
    console.log(
      `\n   ${skipped} ratchet(s) could not contract — that means recorded debt grew or the guard is red.`,
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
