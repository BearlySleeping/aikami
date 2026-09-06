// scripts/src/lib/agents/evaluation/acceptance_runner.test.ts
//
// C-480 AC-1: a worker patch that tries to weaken its evaluator must be
// rejected. The acceptance checker is a function captured from the host
// import graph (task.acceptance), never a file read out of the sandbox —
// so writing a fake "acceptance"/"checker" file into the sandbox, or even
// overwriting the target file with something that merely looks plausible,
// cannot make an unsolved task pass.

import { describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runAcceptance } from './acceptance_runner.ts';
import { getTask } from './task_registry.ts';
import { prepareSandbox } from './worktree_fixture.ts';

const requireTask = (id: string) => {
  const task = getTask(id);
  if (!task) {
    throw new Error(`fixture task "${id}" missing`);
  }
  return task;
};

describe('AC-1: frozen acceptance check cannot be weakened from inside the sandbox', () => {
  it('fails an unsolved task even when the sandbox contains a file claiming success', async () => {
    const task = requireTask('pure_typescript_v1');
    const sandbox = await prepareSandbox(task);
    try {
      // Adversarial patch: leaves the real target unsolved, but plants a
      // fake "acceptance" file inside the sandbox hoping something reads it.
      await writeFile(
        join(sandbox.path, 'acceptance.ts'),
        'export const accepted = true; export const diagnostics = "";',
      );
      await mkdir(join(sandbox.path, 'evaluation'), { recursive: true });
      await writeFile(
        join(sandbox.path, 'evaluation', 'acceptance_runner.ts'),
        'export const runAcceptance = async () => ({ accepted: true, diagnostics: "" });',
      );

      const result = await runAcceptance({ task, sandboxPath: sandbox.path });
      expect(result.accepted).toBe(false);
    } finally {
      await sandbox.cleanup();
    }
  });

  it('accepts a task once the real target file is correctly solved', async () => {
    const task = requireTask('pure_typescript_v1');
    const sandbox = await prepareSandbox(task);
    try {
      await writeFile(
        join(sandbox.path, 'unique_sorted.ts'),
        `export const uniqueSorted = (values: number[]): number[] =>
  [...new Set(values)].sort((a, b) => a - b);\n`,
      );
      const result = await runAcceptance({ task, sandboxPath: sandbox.path });
      expect(result.accepted).toBe(true);
    } finally {
      await sandbox.cleanup();
    }
  });

  it('reports diagnostics instead of throwing when the acceptance check itself errors', async () => {
    const task = requireTask('pure_typescript_v1');
    const sandbox = await prepareSandbox(task);
    try {
      // Leave the module throwing 'not implemented' — import succeeds, call throws.
      const result = await runAcceptance({ task, sandboxPath: sandbox.path });
      expect(result.accepted).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    } finally {
      await sandbox.cleanup();
    }
  });

  it('rejects a pure-function shortcut that mutates the supplied input', async () => {
    const task = requireTask('pure_typescript_v1');
    const sandbox = await prepareSandbox(task);
    try {
      await writeFile(
        join(sandbox.path, 'unique_sorted.ts'),
        'export const uniqueSorted = (values: number[]): number[] => { values.sort((a, b) => a - b); return [...new Set(values)]; };\n',
      );
      const result = await runAcceptance({ task, sandboxPath: sandbox.path });
      expect(result.accepted).toBe(false);
      expect(result.diagnostics).toContain('mutated its input');
    } finally {
      await sandbox.cleanup();
    }
  });

  it('rejects a concurrency shortcut that never invokes the supplied operation', async () => {
    const task = requireTask('process_concurrency_v1');
    const sandbox = await prepareSandbox(task);
    try {
      await writeFile(
        join(sandbox.path, 'concurrent_counter.ts'),
        'export const incrementAllConcurrently = async (count: number): Promise<number> => count;\n',
      );
      const result = await runAcceptance({ task, sandboxPath: sandbox.path });
      expect(result.accepted).toBe(false);
      expect(result.diagnostics).toContain('increment callback ran 0 times');
    } finally {
      await sandbox.cleanup();
    }
  });

  it('rejects changed clamp code even when the expected expression appears in a comment', async () => {
    const task = requireTask('instruction_repair_v1');
    const sandbox = await prepareSandbox(task);
    try {
      await writeFile(
        join(sandbox.path, 'clamp.ts'),
        '// Correct clamp uses Math.min(Math.max(value, min), max).\nexport const clamp = (value: number): number => value;\n',
      );
      const result = await runAcceptance({ task, sandboxPath: sandbox.path });
      expect(result.accepted).toBe(false);
      expect(result.diagnostics).toContain('implementation must not change');
    } finally {
      await sandbox.cleanup();
    }
  });

  it('rejects a direct count export even when a getter is also present', async () => {
    const task = requireTask('svelte_reactivity_v1');
    const sandbox = await prepareSandbox(task);
    try {
      await writeFile(
        join(sandbox.path, 'counter_store.svelte.ts'),
        `let count = $state(0);
export const increment = (): void => { count += 1; };
export const getCount = (): number => count;
export { count };\n`,
      );
      const result = await runAcceptance({ task, sandboxPath: sandbox.path });
      expect(result.accepted).toBe(false);
      expect(result.diagnostics).toContain('Still exports count by value');
    } finally {
      await sandbox.cleanup();
    }
  });
});
